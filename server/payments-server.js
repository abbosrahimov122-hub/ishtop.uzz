/**
 * IshTop — Payme & Click to'lov integratsiyasi
 *
 * Bu versiyada quyidagi xavfsizlik muammolari tuzatildi:
 *  1. Statik fayllar endi FAQAT ../public papkasidan xizmat qiladi —
 *     .env, orders.db, server kodi endi hech qachon HTTP orqali ochilmaydi
 *     (avvalgi versiyada butun loyiha papkasi tasodifan ommaga ochiq edi!)
 *  2. Xavfsizlik HTTP header'lari (helmet)
 *  3. So'rovlar sonini cheklash (rate limit) — to'lov endpoint'lariga hujum qilib
 *     bo'lmaydi. Oddiy foydalanuvchi endpoint'lari uchun paymentLimiter,
 *     Payme/Click'dan keladigan webhook'lar uchun alohida webhookLimiter.
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
 *  9. PerformTransaction endi tranzaksiya holatini to'g'ri tekshiradi —
 *     bekor qilingan/qaytarilgan tranzaksiyani qayta "to'landi"ga
 *     o'tkazib yubormaydi
 * 10. Click'dan kelgan click_trans_id endi 'prepare' bosqichida saqlanadi
 *     (clickTransId ustuni), keyinchalik moslikni tekshirish uchun ishlatiladi
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
    { amount: 99000, days: 30 },
    { amount: 250000, days: 90 },
    { amount: 950000, days: 365 }
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

// Oddiy foydalanuvchi endpoint'lari (login, buyurtma yaratish) uchun.
const paymentLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Juda ko\'p so\'rov. Birozdan so\'ng qayta urinib ko\'ring.' }
});

// To'lov tizimlaridan (Payme/Click) keladigan webhook so'rovlari uchun.
// Ular haqiqiy IP'lardan keladi, lekin baribir DDoS/xato konfiguratsiyadan
// himoyalanish uchun yuqoriroq, lekin cheksiz bo'lmagan chegara qo'yamiz.
const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60, // daqiqasiga 60 ta so'rov — real hisob-kitobga yetarli
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: -32400, message: 'Juda ko\'p so\'rov' } }
});

// ==========================================
// 2) MA'LUMOTLAR BAZASI — SQLite, fayl asosida (orders.db)
// ==========================================
const db = new Database(path.join(__dirname, 'orders.db'));
db.pragma('journal_mode = WAL');

const { ensureVipTable, activateVip, isVip } = require('./vip');
ensureVipTable(db);

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
db.exec(`CREATE INDEX IF NOT EXISTS idx_click_tx ON orders(clickTransId)`);

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
    findByClickTransId(clickTransId) {
        return db.prepare('SELECT * FROM orders WHERE clickTransId = ?').get(String(clickTransId));
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
    },
    setClickTransId(orderId, clickTransId) {
        db.prepare(`
            UPDATE orders SET clickTransId = ?, updatedAt = ?
            WHERE orderId = ?
        `).run(String(clickTransId), new Date().toISOString(), orderId);
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
        const { amount, days } = req.body || {};

        // Buyurtma faqat tizimga kirgan foydalanuvchiga ochiladi; userId brauzerdan emas, sessiyadan olinadi
        const sess = session.verify(req.cookies[SESSION_COOKIE], SESSION_SECRET);
        if (!sess) return res.status(401).json({ error: "To'lov uchun avval tizimga kiring" });
        const userId = String(sess.telegramId);

        if (!Number.isInteger(amount) || !Number.isInteger(days)) {
            return res.status(400).json({ error: 'amount va days butun son bo\'lishi kerak' });
        }
        if (!isValidPlan(amount, days)) {
            return res.status(400).json({ error: 'Noto\'g\'ri tarif. Faqat ruxsat etilgan VIP tariflarni tanlang.' });
        }

        const orderId = 'ord_' + crypto.randomBytes(8).toString('hex');
        ordersDb.create(orderId, { amount, days, userId: String(userId || 'anonymous').slice(0, 100) });

        // To'lov havolalari serverda, serverning O'Z merchant ID'lari bilan yasaladi
        const base = `${req.protocol}://${req.get('host')}`;
        const returnUrl = `${base}/kartalar.html?order=${orderId}`;
        let paymeUrl = null, clickUrl = null;
        if (process.env.PAYME_MERCHANT_ID) {
            const paymeBase = process.env.PAYME_CHECKOUT_URL || 'https://checkout.paycom.uz';
            const p = `m=${process.env.PAYME_MERCHANT_ID};ac.order_id=${orderId};a=${amount * 100};c=${encodeURIComponent(returnUrl)}`;
            paymeUrl = `${paymeBase}/${Buffer.from(p).toString('base64')}`;
        }
        if (process.env.CLICK_MERCHANT_ID && process.env.CLICK_SERVICE_ID) {
            clickUrl = 'https://my.click.uz/services/pay?' + new URLSearchParams({
                service_id: process.env.CLICK_SERVICE_ID,
                merchant_id: process.env.CLICK_MERCHANT_ID,
                amount: String(amount),
                transaction_param: orderId,
                return_url: returnUrl
            }).toString();
        }
        res.json({ orderId, paymeUrl, clickUrl });
    } catch (err) {
        logError('POST /api/orders', err);
        res.status(500).json({ error: 'Ichki server xatosi' });
    }
});

// Foydalanuvchining VIP holati va to'langan buyurtmalari (kartalar.html shu yerdan o'qiydi)
app.get('/api/vip/me', requireAuth, (req, res) => {
    try {
        const uid = String(req.user.telegramId);
        const row = db.prepare('SELECT vipUntil FROM vip_users WHERE userId = ?').get(uid);
        const orders = db.prepare(
            "SELECT orderId, amount, days, updatedAt FROM orders WHERE userId = ? AND status = 'paid' ORDER BY updatedAt DESC LIMIT 20"
        ).all(uid);
        res.json({ vip: isVip(db, uid), vipUntil: row ? row.vipUntil : null, orders });
    } catch (err) {
        logError('GET /api/vip/me', err);
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

app.post('/api/payme/webhook', webhookLimiter, (req, res) => {
    try {
        const authHeader = req.headers.authorization || '';
        const expected = 'Basic ' + Buffer.from('Paycom:' + PAYME_SECRET_KEY).toString('base64');
        const authOk = authHeader.length === expected.length &&
            crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
        if (!authOk) {
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

                // Bekor qilingan yoki qaytarilgan tranzaksiyani qayta
                // "to'landi"ga o'tkazib yuborish mumkin emas.
                if (order.status === 'cancelled' || order.status === 'refunded') {
                    return res.json({ id, error: { code: -31008, message: 'Tranzaksiya bekor qilingan' } });
                }

                if (order.status !== 'paid') {
                    // Holat va VIP muddati bitta tranzaksiyada: biri yozilib, ikkinchisi yozilmay qolmaydi
                    db.transaction(() => {
                        ordersDb.setStatusByPaymeTransactionId(params.id, 'paid');
                        activateVip(db, order);
                    })();
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

app.post('/api/click/prepare', webhookLimiter, (req, res) => {
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

        // click_trans_id'ni saqlaymiz — 'complete' bosqichida moslikni
        // tekshirish va kelajakda tranzaksiyani qidirish uchun kerak bo'ladi.
        if (!order.clickTransId) {
            ordersDb.setClickTransId(orderId, req.body.click_trans_id);
        } else if (order.clickTransId !== String(req.body.click_trans_id)) {
            return res.json({ error: -8, error_note: 'Boshqa tranzaksiyaga bog\'langan' });
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

app.post('/api/click/complete', webhookLimiter, (req, res) => {
    try {
        if (!verifyClickSignature(req.body, CLICK_SECRET_KEY)) {
            return res.json({ error: -1, error_note: 'Imzo noto\'g\'ri' });
        }

        const orderId = req.body.merchant_trans_id;
        const order = ordersDb.get(orderId);
        if (!order) {
            return res.json({ error: -5, error_note: 'Buyurtma topilmadi' });
        }

        // click_trans_id 'prepare' bosqichida saqlangan qiymat bilan mos
        // kelishini tekshiramiz — boshqa tranzaksiyani "yakunlab" bo'lmasin.
        if (order.clickTransId && order.clickTransId !== String(req.body.click_trans_id)) {
            return res.json({ error: -8, error_note: 'Boshqa tranzaksiyaga bog\'langan' });
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

        if (order.status !== 'paid') {
            db.transaction(() => {
                ordersDb.setStatus(orderId, 'paid');
                activateVip(db, order);
            })();
        }

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
// 5.5) VAKANSIYALAR — haqiqiy ma'lumotlar bazasi (SQLite)
// ==========================================
const { REGIONS, ensureSchema } = require('./vacancies-db');
ensureSchema(db);

// Baza bo'sh bo'lsa (masalan, Render'da yangi deploy'dan keyin), haqiqiy
// vakansiyalarni server/vacancies.json dan bir marta yuklaymiz.
// Jadvalda kamida bitta yozuv bo'lsa, hech narsa qilmaydi (takrorlanmaydi).
try {
    require('./seed-from-json').seedFromJson(db);
} catch (e) {
    console.error('Vakansiyalarni boshlang\'ich yuklashda xato:', e.message);
}

const REGION_KEYS = REGIONS.map(r => r.key);
const VACANCY_TYPES = ["To'liq bandlik", "Yarim bandlik", "Masofaviy", "Gibrid"];

function rowToVacancy(r) {
    return {
        id: `VT-${r.id}`,
        title: r.title,
        company: r.company,
        employee: r.employee,
        region: r.region,
        location: r.location,
        salary: r.salary,
        type: r.type,
        desc: r.description,
        source: r.source,
        createdAt: r.createdAt
    };
}

// Hammaga ochiq: faol vakansiyalar va viloyatlar ro'yxati (eng yangisi birinchi)
app.get('/api/vacancies', (req, res) => {
    try {
        const rows = db.prepare(
            `SELECT * FROM vacancies WHERE status = 'active' ORDER BY createdAt DESC, id DESC LIMIT 1000`
        ).all();
        res.json({ items: rows.map(rowToVacancy), regions: REGIONS });
    } catch (err) {
        logError('GET /api/vacancies', err);
        res.status(500).json({ error: 'Ichki server xatosi' });
    }
});

// Faqat tizimga kirgan foydalanuvchi vakansiya qo'sha oladi
app.post('/api/vacancies', paymentLimiter, requireAuth, (req, res) => {
    try {
        const b = req.body || {};
        const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

        const title = clean(b.title, 120);
        const company = clean(b.company, 120);
        const employee = clean(b.employee, 120);
        const location = clean(b.location, 120);
        const salary = clean(b.salary, 60) || 'Kelishiladi';
        const description = clean(b.desc, 2000) || "Batafsil ma'lumot suhbat davomida beriladi.";
        const type = VACANCY_TYPES.includes(b.type) ? b.type : VACANCY_TYPES[0];

        if (!title || !company || !employee || !location) {
            return res.status(400).json({ error: "Barcha majburiy maydonlarni to'ldiring" });
        }
        if (!REGION_KEYS.includes(b.region)) {
            return res.status(400).json({ error: 'Viloyatni tanlang' });
        }

        const info = db.prepare(`
            INSERT INTO vacancies (title, company, employee, region, location, salary, type, description, ownerTelegramId, createdAt, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user')
        `).run(title, company, employee, b.region, location, salary, type, description,
            String(req.user.telegramId), new Date().toISOString());

        const row = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(info.lastInsertRowid);
        res.status(201).json(rowToVacancy(row));
    } catch (err) {
        logError('POST /api/vacancies', err);
        res.status(500).json({ error: 'Ichki server xatosi' });
    }
});

// ==========================================
// 5.5.1) NOMZODLAR — ro'yxatdan o'tish va ro'yxat
// ==========================================
const { createCandidatesStore } = require('./candidates-store');
const candidatesStore = createCandidatesStore(db);
console.log(`Nomzodlar ombori: ${candidatesStore.kind === 'postgres' ? 'PostgreSQL (doimiy)' : "SQLite (Render Free'da har deploy'da tozalanadi!)"}`);
Promise.resolve(candidatesStore.init()).catch(e => console.error('Nomzodlar omborini tayyorlashda xato:', e.message));

function rowToCandidate(r) {
    return {
        id: `NM-${r.id}`,
        fullName: r.fullName,
        phone: r.phone,
        telegramUsername: r.telegramUsername,
        region: r.region,
        desiredRole: r.desiredRole,
        experienceYears: r.experienceYears,
        about: r.about,
        createdAt: r.createdAt
    };
}

// Viloyatlar ro'yxati hammaga ochiq (ro'yxatdan o'tish formasi uchun).
// Nomzodlarning ism/telefoni FAQAT ADMIN_KEY bilan (x-admin-key sarlavhasi) beriladi.
// ADMIN_KEY sozlanmagan bo'lsa, ro'yxat hech kimga berilmaydi.
app.get('/api/candidates', async (req, res) => {
    try {
        const key = process.env.ADMIN_KEY;
        const given = String(req.headers['x-admin-key'] || '');
        let isAdmin = false;
        if (key && given) {
            const a = Buffer.from(given), b = Buffer.from(key);
            isAdmin = a.length === b.length && crypto.timingSafeEqual(a, b);
        }
        if (!isAdmin) {
            // Kalit yo'q yoki noto'g'ri: faqat viloyatlar, shaxsiy ma'lumot yo'q
            return res.json({ items: [], regions: REGIONS, locked: true });
        }
        const rows = await candidatesStore.list();
        res.json({ items: rows.map(rowToCandidate), regions: REGIONS, locked: false });
    } catch (err) {
        logError('GET /api/candidates', err);
        res.status(500).json({ error: 'Ichki server xatosi' });
    }
});

// Hammaga ochiq: o'zini nomzod sifatida ro'yxatdan o'tkazish
app.post('/api/candidates', paymentLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

        const fullName = clean(b.fullName, 120);
        const phone = clean(b.phone, 30);
        const telegramUsername = clean(b.telegramUsername, 40).replace(/^@/, '');
        const desiredRole = clean(b.desiredRole, 120);
        const about = clean(b.about, 1000);
        let experienceYears = parseInt(b.experienceYears, 10);
        if (!Number.isFinite(experienceYears) || experienceYears < 0) experienceYears = 0;
        if (experienceYears > 60) experienceYears = 60;

        if (!fullName || !phone || !desiredRole) {
            return res.status(400).json({ error: "Ism, telefon va lavozim majburiy" });
        }
        if (!REGION_KEYS.includes(b.region)) {
            return res.status(400).json({ error: 'Viloyatni tanlang' });
        }
        if (!/^[+0-9][0-9\s\-()]{6,}$/.test(phone)) {
            return res.status(400).json({ error: "Telefon raqami noto'g'ri formatda" });
        }

        const row = await candidatesStore.insert({
            fullName, phone, telegramUsername, region: b.region, desiredRole,
            experienceYears, about,
            ownerTelegramId: req.user ? String(req.user.telegramId) : null
        });
        res.status(201).json(rowToCandidate(row));
    } catch (err) {
        logError('POST /api/candidates', err);
        res.status(500).json({ error: 'Ichki server xatosi' });
    }
});

// ==========================================
// 5.6) VAKANSIYALARNI BIR YO'LA IMPORT QILISH (IMPORT_KEY bilan himoyalangan)
// ==========================================
// PowerShell'dan Invoke-RestMethod bilan chaqiriladi, --source va h.k. maydonlari
// vakansiya.js dagi kabi tekshiriladi. IMPORT_KEY muhit o'zgaruvchisi sozlanmagan
// bo'lsa, bu yo'l butunlay o'chirilgan hisoblanadi (xavfsizlik uchun).
app.post('/api/vacancies/bulk-import', paymentLimiter, (req, res) => {
    try {
        const key = process.env.IMPORT_KEY;
        if (!key) return res.status(403).json({ error: "IMPORT_KEY sozlanmagan" });
        if (req.headers['x-import-key'] !== key) return res.status(403).json({ error: "Noto'g'ri kalit" });

        const list = Array.isArray(req.body) ? req.body : req.body.items;
        if (!Array.isArray(list) || !list.length) {
            return res.status(400).json({ error: "Massiv ({items:[...]} yoki to'g'ridan-to'g'ri [...]) kerak" });
        }

        const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
        const checked = list.map((j, i) => {
            const v = {
                title: clean(j.title, 120), company: clean(j.company, 120), employee: clean(j.employee, 120),
                location: clean(j.location, 120), salary: clean(j.salary, 60) || 'Kelishiladi',
                description: clean(j.desc || j.description, 2000) || "Batafsil ma'lumot suhbat davomida beriladi.",
                region: clean(j.region, 40)
            };
            v.type = VACANCY_TYPES.includes(j.type) ? j.type :
                ({ full: "To'liq bandlik", part: 'Yarim bandlik', remote: 'Masofaviy', hybrid: 'Gibrid' }[j.type] || VACANCY_TYPES[0]);
            v.source = (clean(j.source, 20) === 'imported') ? 'imported' : 'admin';
            if (!v.title || !v.company || !v.employee || !v.location) return { i, error: "majburiy maydon bo'sh" };
            if (!REGION_KEYS.includes(v.region)) return { i, error: `noto'g'ri viloyat: ${v.region}` };
            return { i, value: v };
        });
        const bad = checked.filter(c => c.error);
        if (bad.length) return res.status(400).json({ error: "Ba'zi yozuvlar noto'g'ri", details: bad });

        const insert = db.prepare(`
            INSERT INTO vacancies (title, company, employee, region, location, salary, type, description, ownerTelegramId, createdAt, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?)
        `);
        db.exec('BEGIN');
        try {
            checked.forEach(c => insert.run(c.value.title, c.value.company, c.value.employee, c.value.region,
                c.value.location, c.value.salary, c.value.type, c.value.description, new Date().toISOString(), c.value.source));
            db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }

        res.json({ ok: true, added: checked.length });
    } catch (err) {
        logError('POST /api/vacancies/bulk-import', err);
        res.status(500).json({ error: 'Ichki server xatosi' });
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