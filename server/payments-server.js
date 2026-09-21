/**
 * IshTop — Payme & Click to'lov integratsiyasi
 *
 * Bu versiyada quyidagi xavfsizlik muammolari tuzatildi:
 *  1. Statik fayllar endi FAQAT ../public papkasidan xizmat qiladi —
 *     .env, orders.db, server kodi endi hech qachon HTTP orqali ochilmaydi
 *     (avvalgi versiyada butun loyiha papkasi tasodifan ommaga ochiq edi!)
 *  2. Xavfsizlik HTTP header'lari (helmet)
 *  3. So'rovlar sonini cheklash (rate limit) — to'lov endpoint'lariga hujum qilib
 *     bo'lmaydi
 *  4. Server ishga tushishda .env to'liqligini tekshiradi — kalit yetishmasa,
 *     server sukut bilan noto'g'ri ishlash o'rniga aniq xato berib to'xtaydi
 *  5. To'lov summasi endi FAQAT serverdagi ruxsat etilgan tariflar ro'yxati
 *     bilan solishtiriladi — brauzerdan istalgan summa yuborib bo'lmaydi
 *  6. Payme'ning barcha 5 ta majburiy metodi qo'shildi (avval 4 tasi bor edi;
 *     CheckTransaction va GetStatement yetishmayotgan edi — sertifikatsiyadan
 *     o'tmagan bo'lardi)
 *  7. 12 soatlik tranzaksiya muddati nazorati (Payme talabi)
 *  8. Barcha DB va webhook operatsiyalari try/catch bilan o'ralgan —
 *     server endi noto'g'ri so'rovdan yiqilib qolmaydi
 *
 * O'RNATISH:
 *   npm install
 *   cp .env.example .env   # va haqiqiy qiymatlarni to'ldiring
 *   npm start
 */

require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { verifyWebAppInitData, verifyLoginWidgetData } = require('./telegram-auth');
const session = require('./session');

// ==========================================
// 0) SOZLAMALARNI TEKSHIRISH — kalit yetishmasa, server DARHOL to'xtaydi.
// ==========================================
const REQUIRED_ENV = [
    'PAYME_MERCHANT_ID', 'PAYME_SECRET_KEY',
    'CLICK_MERCHANT_ID', 'CLICK_SERVICE_ID', 'CLICK_SECRET_KEY',
    'TELEGRAM_BOT_TOKEN', 'SESSION_SECRET'
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
    console.error('❌ .env faylida quyidagi o\'zgaruvchilar yetishmayapti:', missing.join(', '));
    console.error('   server/.env.example dan nusxa oling: cp .env.example .env');
    process.exit(1);
}

const PAYME_SECRET_KEY = process.env.PAYME_SECRET_KEY; // faqat serverda!
const CLICK_SECRET_KEY = process.env.CLICK_SECRET_KEY; // faqat serverda!
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; // faqat serverda!
const SESSION_SECRET = process.env.SESSION_SECRET; // faqat serverda!
const NODE_ENV = process.env.NODE_ENV || 'development';
const SESSION_COOKIE = 'ishtop_session';
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 kun

// Ruxsat etilgan VIP tariflar — narxni brauzerdan emas, FAQAT shu ro'yxatdan
// tasdiqlaymiz. Aks holda kimdir fetch('/api/orders', {amount: 1}) deb
// arzon buyurtma yaratishi mumkin edi.
const ALLOWED_PLANS = [
    { amount: 29000, days: 30 },
    { amount: 79000, days: 90 },
    { amount: 279000, days: 365 }
];
function isValidPlan(amount, days) {
    return ALLOWED_PLANS.some(p => p.amount === amount && p.days === days);
}

// ==========================================
// 1) EXPRESS SOZLAMALARI
// ==========================================
const app = express();
app.set('trust proxy', 1); // reverse proxy (Nginx/Cloudflare) orqasida to'g'ri IP/HTTPS aniqlash uchun

app.use(helmet({
    contentSecurityPolicy: false // frontend CDN skriptlari ishlatgani uchun o'chirilgan;
    // production'da domenlaringizga moslab yoqishni tavsiya qilamiz
}));

app.use(express.json({ limit: '100kb' })); // katta so'rovlarni rad etish
app.use(cookieParser());

// MUHIM: faqat ./public papkasi ochiq. Bir papka yuqorida turgan
// .env, orders.db, payments-server.js HECH QACHON HTTP orqali ko'rinmaydi.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR, { dotfiles: 'deny', index: 'index.html' }));

app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

const paymentLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Juda ko\'p so\'rov. Birozdan so\'ng qayta urinib ko\'ring.' }
});

// ==========================================
// 2) MA'LUMOTLAR BAZASI — SQLite, fayl asosida (orders.db)
// ==========================================
const db = new Database(path.join(__dirname, 'orders.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    orderId TEXT PRIMARY KEY,
    amount INTEGER NOT NULL,
    days INTEGER NOT NULL,
    userId TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    paymeTransactionId TEXT,
    clickTransId TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_payme_tx ON orders(paymeTransactionId)`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegramId TEXT PRIMARY KEY,
    firstName TEXT,
    lastName TEXT,
    username TEXT,
    photoUrl TEXT,
    createdAt TEXT NOT NULL,
    lastLoginAt TEXT NOT NULL
  )
`);

const usersDb = {
    upsert(tgUser) {
        const id = String(tgUser.id);
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO users (telegramId, firstName, lastName, username, photoUrl, createdAt, lastLoginAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(telegramId) DO UPDATE SET
                firstName = excluded.firstName,
                lastName = excluded.lastName,
                username = excluded.username,
                photoUrl = excluded.photoUrl,
                lastLoginAt = excluded.lastLoginAt
        `).run(
            id,
            tgUser.first_name || null,
            tgUser.last_name || null,
            tgUser.username || null,
            tgUser.photo_url || null,
            now,
            now
        );
        return db.prepare('SELECT * FROM users WHERE telegramId = ?').get(id);
    },
    get(telegramId) {
        return db.prepare('SELECT * FROM users WHERE telegramId = ?').get(String(telegramId));
    }
};

const ordersDb = {
    get(orderId) {
        return db.prepare('SELECT * FROM orders WHERE orderId = ?').get(orderId);
    },
    findByPaymeTransactionId(transactionId) {
        return db.prepare('SELECT * FROM orders WHERE paymeTransactionId = ?').get(transactionId);
    },
    create(orderId, { amount, days, userId }) {
        db.prepare(`
            INSERT INTO orders (orderId, amount, days, userId, status, createdAt)
            VALUES (?, ?, ?, ?, 'pending', ?)
        `).run(orderId, amount, days, userId || 'anonymous', new Date().toISOString());
    },
    setStatus(orderId, status) {
        db.prepare('UPDATE orders SET status = ?, updatedAt = ? WHERE orderId = ?')
            .run(status, new Date().toISOString(), orderId);
    },
    setStatusByPaymeTransactionId(transactionId, status) {
        db.prepare('UPDATE orders SET status = ?, updatedAt = ? WHERE paymeTransactionId = ?')
            .run(status, new Date().toISOString(), transactionId);
    },
    setPaymeTransaction(orderId, transactionId) {
        db.prepare(`
            UPDATE orders SET paymeTransactionId = ?, status = 'processing', updatedAt = ?
            WHERE orderId = ?
        `).run(transactionId, new Date().toISOString(), orderId);
    }
};

function logError(context, err) {
    console.error(`[${new Date().toISOString()}] ${context}:`, err.message);
}

function setSessionCookie(res, tgUser) {
    const token = session.sign(
        { telegramId: String(tgUser.id), firstName: tgUser.first_name, username: tgUser.username },
        SESSION_SECRET,
        SESSION_MAX_AGE_SEC
    );
    res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_MAX_AGE_SEC * 1000,
        path: '/'
    });
}

// Himoyalangan API'lar uchun middleware (kerak bo'lganda ishlatiladi)
function requireAuth(req, res, next) {
    const payload = session.verify(req.cookies[SESSION_COOKIE], SESSION_SECRET);
    if (!payload) return res.status(401).json({ error: 'Tizimga kirilmagan' });
    req.user = payload;
    next();
}

// ==========================================
// TELEGRAM AUTENTIFIKATSIYA
// ==========================================

// 1) Telegram Mini App ichida ochilganda — frontend window.Telegram.WebApp.initData
//    satrini shu yerga yuboradi, server imzoni tekshiradi.
app.post('/api/auth/telegram-webapp', paymentLimiter, (req, res) => {
    try {
        const { initData } = req.body || {};
        const tgUser = verifyWebAppInitData(initData, TELEGRAM_BOT_TOKEN);
        if (!tgUser) {
            return res.status(401).json({ error: 'Telegram ma\'lumotlari tasdiqlanmadi' });
        }

        const user = usersDb.upsert(tgUser);
        setSessionCookie(res, tgUser);
        res.json({
            ok: true,
            user: { id: user.telegramId, firstName: user.firstName, lastName: user.lastName, username: user.username, photoUrl: user.photoUrl }
        });
    } catch (err) {
        logError('POST /api/auth/telegram-webapp', err);
        res.status(500).json({ error: 'Ichki server xatosi' });
    }
});

// 2) Oddiy brauzerda — Telegram'ning rasmiy Login Widget'i (redirect rejimi)
//    foydalanuvchini shu manzilga GET so'rov bilan qaytaradi, imzo bilan.
app.get('/api/auth/telegram-callback', (req, res) => {
    try {
        const tgUser = verifyLoginWidgetData(req.query, TELEGRAM_BOT_TOKEN);
        if (!tgUser) {
            return res.status(401).send('Telegram orqali kirish tasdiqlanmadi. Qayta urinib ko\'ring.');
        }

        usersDb.upsert(tgUser);
        setSessionCookie(res, tgUser);
        res.redirect('/dashboard.html');
    } catch (err) {
        logError('GET /api/auth/telegram-callback', err);
        res.status(500).send('Ichki server xatosi');
    }
});

// 2b) Telegram Login Widget'ning JS callback rejimi (data-onauth) uchun.
//     Bu rejim popup/ilova tasdiqlangandan so'ng sahifani DARHOL, ishonchli
//     tarzda o'zgartirish imkonini beradi — Telegram Desktop ilovasi orqali
//     tasdiqlanganda ham (redirect kutilmasdan) frontend o'zi so'rov yuboradi.
app.post('/api/auth/telegram-widget', paymentLimiter, (req, res) => {
    try {
        const tgUser = verifyLoginWidgetData(req.body, TELEGRAM_BOT_TOKEN);
        if (!tgUser) {
            return res.status(401).json({ error: 'Telegram ma\'lumotlari tasdiqlanmadi' });
        }

        const user = usersDb.upsert(tgUser);
        setSessionCookie(res, tgUser);
        res.json({
            ok: true,
            user: { id: user.telegramId, firstName: user.firstName, lastName: user.lastName, username: user.username, photoUrl: user.photoUrl }
        });
    } catch (err) {
        logError('POST /api/auth/telegram-widget', err);
        res.status(500).json({ error: 'Ichki server xatosi' });
    }
});

// 3) Joriy foydalanuvchini tekshirish — himoyalangan sahifalar shu endpoint'ni
//    chaqirib, sessiya haqiqiy ekanini tasdiqlaydi.
app.get('/api/auth/me', (req, res) => {
    const payload = session.verify(req.cookies[SESSION_COOKIE], SESSION_SECRET);
    if (!payload) return res.status(401).json({ error: 'Tizimga kirilmagan' });

    const user = usersDb.get(payload.telegramId);
    if (!user) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });

    res.json({
        id: user.telegramId,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        photoUrl: user.photoUrl
    });
});

// 4) Chiqish
app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
});

// ==========================================
// 3) Buyurtma yaratish
// ==========================================
app.post('/api/orders', paymentLimiter, (req, res) => {
    try {
        const { amount, days, userId } = req.body || {};

        if (!Number.isInteger(amount) || !Number.isInteger(days)) {
            return res.status(400).json({ error: 'amount va days butun son bo\'lishi kerak' });
        }
        if (!isValidPlan(amount, days)) {
            return res.status(400).json({ error: 'Noto\'g\'ri tarif. Faqat ruxsat etilgan VIP tariflarni tanlang.' });
        }

        const orderId = 'ord_' + crypto.randomBytes(8).toString('hex');
        ordersDb.create(orderId, { amount, days, userId: String(userId || 'anonymous').slice(0, 100) });

        res.json({ orderId });
    } catch (err) {
        logError('POST /api/orders', err);
        res.status(500).json({ error: 'Ichki server xatosi' });
    }
});

app.get('/api/orders/:orderId', paymentLimiter, (req, res) => {
    try {
        const order = ordersDb.get(req.params.orderId);
        if (!order) return res.status(404).json({ error: 'Topilmadi' });
        res.json({ orderId: order.orderId, status: order.status, amount: order.amount });
    } catch (err) {
        logError('GET /api/orders/:orderId', err);
        res.status(500).json({ error: 'Ichki server xatosi' });
    }
});

// ==========================================
// 4) PAYME — Merchant API (JSON-RPC webhook)
//    Hujjat: https://developer.help.paycom.uz
// ==========================================
const PAYME_TX_TIMEOUT_MS = 12 * 60 * 60 * 1000; // Payme talabi: 12 soat

app.post('/api/payme/webhook', (req, res) => {
    try {
        const authHeader = req.headers.authorization || '';
        const expected = 'Basic ' + Buffer.from('Paycom:' + PAYME_SECRET_KEY).toString('base64');
        if (authHeader !== expected) {
            return res.status(200).json({ error: { code: -32504, message: 'Ruxsat berilmagan' } });
        }

        const { method, params, id } = req.body || {};

        switch (method) {
            case 'CheckPerformTransaction': {
                const orderId = params.account.order_id;
                const order = ordersDb.get(orderId);
                if (!order) {
                    return res.json({ id, error: { code: -31050, message: 'Buyurtma topilmadi' } });
                }
                if (order.amount * 100 !== params.amount) {
                    return res.json({ id, error: { code: -31001, message: 'Summa mos kelmadi' } });
                }
                return res.json({ id, result: { allow: true } });
            }

            case 'CreateTransaction': {
                const orderId = params.account.order_id;
                const order = ordersDb.get(orderId);
                if (!order) {
                    return res.json({ id, error: { code: -31050, message: 'Buyurtma topilmadi' } });
                }

                if (order.paymeTransactionId && order.paymeTransactionId !== params.id) {
                    return res.json({ id, error: { code: -31099, message: 'Buyurtma boshqa tranzaksiyaga bog\'langan' } });
                }

                if (!order.paymeTransactionId) {
                    const age = Date.now() - new Date(order.createdAt).getTime();
                    if (age > PAYME_TX_TIMEOUT_MS) {
                        return res.json({ id, error: { code: -31008, message: 'Buyurtma muddati tugagan' } });
                    }
                    ordersDb.setPaymeTransaction(orderId, params.id);
                }

                return res.json({
                    id,
                    result: { create_time: Date.now(), transaction: params.id, state: 1 }
                });
            }

            case 'PerformTransaction': {
                const order = ordersDb.findByPaymeTransactionId(params.id);
                if (!order) {
                    return res.json({ id, error: { code: -31003, message: 'Tranzaksiya topilmadi' } });
                }
                if (order.status !== 'paid') {
                    // TODO: bu yerda VIP obunani real faollashtiring
                    ordersDb.setStatusByPaymeTransactionId(params.id, 'paid');
                }
                return res.json({
                    id,
                    result: { transaction: params.id, perform_time: Date.now(), state: 2 }
                });
            }

            case 'CancelTransaction': {
                const order = ordersDb.findByPaymeTransactionId(params.id);
                if (!order) {
                    return res.json({ id, error: { code: -31003, message: 'Tranzaksiya topilmadi' } });
                }
                const newStatus = order.status === 'paid' ? 'refunded' : 'cancelled';
                ordersDb.setStatusByPaymeTransactionId(params.id, newStatus);
                return res.json({
                    id,
                    result: {
                        transaction: params.id,
                        cancel_time: Date.now(),
                        state: order.status === 'paid' ? -2 : -1
                    }
                });
            }

            case 'CheckTransaction': {
                const order = ordersDb.findByPaymeTransactionId(params.id);
                if (!order) {
                    return res.json({ id, error: { code: -31003, message: 'Tranzaksiya topilmadi' } });
                }
                const stateMap = { pending: 1, processing: 1, paid: 2, cancelled: -1, refunded: -2 };
                return res.json({
                    id,
                    result: {
                        create_time: new Date(order.createdAt).getTime(),
                        perform_time: order.status === 'paid' ? new Date(order.updatedAt).getTime() : 0,
                        cancel_time: (order.status === 'cancelled' || order.status === 'refunded')
                            ? new Date(order.updatedAt).getTime() : 0,
                        transaction: params.id,
                        state: stateMap[order.status] ?? 1,
                        reason: null
                    }
                });
            }

            case 'GetStatement': {
                const rows = db.prepare(`
                    SELECT * FROM orders
                    WHERE paymeTransactionId IS NOT NULL
                    AND createdAt BETWEEN datetime(? / 1000, 'unixepoch') AND datetime(? / 1000, 'unixepoch')
                `).all(params.from, params.to);

                const stateMap = { pending: 1, processing: 1, paid: 2, cancelled: -1, refunded: -2 };
                return res.json({
                    id,
                    result: {
                        transactions: rows.map(o => ({
                            id: o.paymeTransactionId,
                            time: new Date(o.createdAt).getTime(),
                            amount: o.amount * 100,
                            account: { order_id: o.orderId },
                            create_time: new Date(o.createdAt).getTime(),
                            perform_time: o.status === 'paid' ? new Date(o.updatedAt).getTime() : 0,
                            cancel_time: 0,
                            transaction: o.paymeTransactionId,
                            state: stateMap[o.status] ?? 1,
                            reason: null
                        }))
                    }
                });
            }

            default:
                return res.json({ id, error: { code: -32601, message: 'Metod topilmadi' } });
        }
    } catch (err) {
        logError('POST /api/payme/webhook', err);
        return res.status(200).json({ id: req.body?.id, error: { code: -32400, message: 'Ichki xato' } });
    }
});

// ==========================================
// 5) CLICK — Prepare & Complete webhook
//    Hujjat: https://docs.click.uz
// ==========================================
function verifyClickSignature(body, secretKey) {
    const {
        click_trans_id, service_id, merchant_trans_id,
        amount, action, sign_time, sign_string
    } = body;

    const raw = action == 0
        ? `${click_trans_id}${service_id}${secretKey}${merchant_trans_id}${amount}${action}${sign_time}`
        : `${click_trans_id}${service_id}${secretKey}${merchant_trans_id}${body.click_paydoc_id}${amount}${action}${sign_time}`;

    const expected = crypto.createHash('md5').update(raw).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(sign_string || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b); // timing-attack'dan himoya
}

app.post('/api/click/prepare', (req, res) => {
    try {
        if (!verifyClickSignature(req.body, CLICK_SECRET_KEY)) {
            return res.json({ error: -1, error_note: 'Imzo noto\'g\'ri' });
        }

        const orderId = req.body.merchant_trans_id;
        const order = ordersDb.get(orderId);
        if (!order) {
            return res.json({ error: -5, error_note: 'Buyurtma topilmadi' });
        }
        if (order.amount !== Number(req.body.amount)) {
            return res.json({ error: -2, error_note: 'Summa mos kelmadi' });
        }

        res.json({
            click_trans_id: req.body.click_trans_id,
            merchant_trans_id: orderId,
            merchant_prepare_id: orderId,
            error: 0,
            error_note: 'OK'
        });
    } catch (err) {
        logError('POST /api/click/prepare', err);
        res.json({ error: -8, error_note: 'Ichki xato' });
    }
});

app.post('/api/click/complete', (req, res) => {
    try {
        if (!verifyClickSignature(req.body, CLICK_SECRET_KEY)) {
            return res.json({ error: -1, error_note: 'Imzo noto\'g\'ri' });
        }

        const orderId = req.body.merchant_trans_id;
        const order = ordersDb.get(orderId);
        if (!order) {
            return res.json({ error: -5, error_note: 'Buyurtma topilmadi' });
        }

        if (Number(req.body.error) < 0) {
            ordersDb.setStatus(orderId, 'cancelled');
            return res.json({
                click_trans_id: req.body.click_trans_id,
                merchant_trans_id: orderId,
                merchant_confirm_id: orderId,
                error: 0,
                error_note: 'OK'
            });
        }

        // TODO: bu yerda VIP obunani real faollashtiring
        ordersDb.setStatus(orderId, 'paid');

        res.json({
            click_trans_id: req.body.click_trans_id,
            merchant_trans_id: orderId,
            merchant_confirm_id: orderId,
            error: 0,
            error_note: 'OK'
        });
    } catch (err) {
        logError('POST /api/click/complete', err);
        res.json({ error: -8, error_note: 'Ichki xato' });
    }
});

// ==========================================
// 6) Umumiy xato ushlagich
// ==========================================
app.use((err, req, res, next) => {
    logError('Ushlanmagan xato', err);
    res.status(500).json({ error: 'Ichki server xatosi' });
});

// ==========================================
// 7) Ishga tushirish va toza to'xtash
// ==========================================
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`✅ To'lov serveri ${PORT}-portda ishga tushdi (${NODE_ENV})`);
    console.log(`   Statik fayllar: ${PUBLIC_DIR}`);
});

process.on('SIGINT', () => {
    console.log('\nServer to\'xtatilmoqda...');
    server.close(() => {
        db.close();
        process.exit(0);
    });
});