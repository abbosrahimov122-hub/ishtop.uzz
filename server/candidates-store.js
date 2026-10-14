/**
 * Nomzodlarni saqlash: ikki xil omborxona, bitta interfeys.
 *
 *  - DATABASE_URL berilgan bo'lsa  -> tashqi PostgreSQL (deploy'lardan keyin ham saqlanadi)
 *  - berilmagan bo'lsa             -> mahalliy SQLite (Render Free'da har deploy'da tozalanadi)
 *
 * Ikkalasi ham bir xil shakldagi obyektlar qaytaradi:
 *   { id, fullName, phone, telegramUsername, region, desiredRole,
 *     experienceYears, about, ownerTelegramId, status, createdAt (ISO satr) }
 */
const { ensureCandidatesSchema } = require('./candidates-db');

function sqliteStore(db) {
    ensureCandidatesSchema(db);
    db.exec(`CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT, vacancyId TEXT NOT NULL, vacancyTitle TEXT, company TEXT,
        fullName TEXT NOT NULL, phone TEXT NOT NULL, message TEXT, applicantId TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'kutilmoqda', createdAt TEXT NOT NULL)`);
    return {
        kind: 'sqlite',
        async init() { },
        async list() {
            return db.prepare(
                `SELECT * FROM candidates WHERE status != 'removed' ORDER BY createdAt DESC, id DESC LIMIT 1000`
            ).all();
        },
        async insert(c) {
            const info = db.prepare(`
                INSERT INTO candidates (fullName, phone, telegramUsername, region, desiredRole, experienceYears, about, ownerTelegramId, createdAt, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(c.fullName, c.phone, c.telegramUsername || null, c.region, c.desiredRole,
                c.experienceYears, c.about || null, c.ownerTelegramId || null, new Date().toISOString(), c.source || null);
            return db.prepare('SELECT * FROM candidates WHERE id = ?').get(info.lastInsertRowid);
        },
        async setStatus(id, status) {
            db.prepare('UPDATE candidates SET status = ? WHERE id = ?').run(status, id);
            return db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) || null;
        },
        async appInsert(a) {
            const info = db.prepare(`INSERT INTO applications (vacancyId, vacancyTitle, company, fullName, phone, message, applicantId, createdAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(a.vacancyId, a.vacancyTitle || null, a.company || null,
                a.fullName, a.phone, a.message || null, a.applicantId, new Date().toISOString());
            return db.prepare('SELECT * FROM applications WHERE id = ?').get(info.lastInsertRowid);
        },
        async appList() { return db.prepare('SELECT * FROM applications ORDER BY createdAt DESC, id DESC LIMIT 500').all(); },
        async appMine(uid) { return db.prepare('SELECT * FROM applications WHERE applicantId = ? ORDER BY createdAt DESC, id DESC LIMIT 100').all(uid); },
        async appSetStatus(id, status) {
            db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(status, id);
            return db.prepare('SELECT * FROM applications WHERE id = ?').get(id) || null;
        }
    };
}

const PG_COLUMNS = `
    id,
    full_name         AS "fullName",
    phone,
    telegram_username AS "telegramUsername",
    region,
    desired_role      AS "desiredRole",
    experience_years  AS "experienceYears",
    about,
    owner_telegram_id AS "ownerTelegramId",
    status,
    created_at        AS "createdAt",
    source`;


const APP_COLUMNS = `id, vacancy_id AS "vacancyId", vacancy_title AS "vacancyTitle", company, full_name AS "fullName",
    phone, message, applicant_id AS "applicantId", status, created_at AS "createdAt"`;

function normalize(r) {
    if (!r) return r;
    return { ...r, createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt) };
}

function postgresStore(pool) {
    const ready = pool.query(`
        CREATE TABLE IF NOT EXISTS candidates (
            id SERIAL PRIMARY KEY,
            full_name TEXT NOT NULL,
            phone TEXT NOT NULL,
            telegram_username TEXT,
            region TEXT NOT NULL,
            desired_role TEXT NOT NULL,
            experience_years INTEGER NOT NULL DEFAULT 0,
            about TEXT,
            owner_telegram_id TEXT,
            status TEXT NOT NULL DEFAULT 'yangi',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            source TEXT
        );
        ALTER TABLE candidates ADD COLUMN IF NOT EXISTS source TEXT;
        CREATE INDEX IF NOT EXISTS idx_candidates_created ON candidates (created_at);
        CREATE INDEX IF NOT EXISTS idx_candidates_region ON candidates (region);
        CREATE TABLE IF NOT EXISTS applications (
            id SERIAL PRIMARY KEY, vacancy_id TEXT NOT NULL, vacancy_title TEXT, company TEXT,
            full_name TEXT NOT NULL, phone TEXT NOT NULL, message TEXT, applicant_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'kutilmoqda', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    `);
    return {
        kind: 'postgres',
        init: () => ready,
        async list() {
            await ready;
            const { rows } = await pool.query(
                `SELECT ${PG_COLUMNS} FROM candidates WHERE status <> 'removed' ORDER BY created_at DESC, id DESC LIMIT 1000`
            );
            return rows.map(normalize);
        },
        async insert(c) {
            await ready;
            const { rows } = await pool.query(
                `INSERT INTO candidates (full_name, phone, telegram_username, region, desired_role, experience_years, about, owner_telegram_id, source)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING ${PG_COLUMNS}`,
                [c.fullName, c.phone, c.telegramUsername || null, c.region, c.desiredRole,
                c.experienceYears, c.about || null, c.ownerTelegramId || null, c.source || null]
            );
            return normalize(rows[0]);
        },
        async setStatus(id, status) {
            await ready;
            const { rows } = await pool.query(`UPDATE candidates SET status = $2 WHERE id = $1 RETURNING ${PG_COLUMNS}`, [id, status]);
            return rows[0] ? normalize(rows[0]) : null;
        },
        async appInsert(a) {
            await ready;
            const { rows } = await pool.query(
                `INSERT INTO applications (vacancy_id, vacancy_title, company, full_name, phone, message, applicant_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${APP_COLUMNS}`,
                [a.vacancyId, a.vacancyTitle || null, a.company || null, a.fullName, a.phone, a.message || null, a.applicantId]);
            return normalize(rows[0]);
        },
        async appList() {
            await ready;
            const { rows } = await pool.query(`SELECT ${APP_COLUMNS} FROM applications ORDER BY created_at DESC, id DESC LIMIT 500`);
            return rows.map(normalize);
        },
        async appMine(uid) {
            await ready;
            const { rows } = await pool.query(`SELECT ${APP_COLUMNS} FROM applications WHERE applicant_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`, [uid]);
            return rows.map(normalize);
        },
        async appSetStatus(id, status) {
            await ready;
            const { rows } = await pool.query(`UPDATE applications SET status = $2 WHERE id = $1 RETURNING ${APP_COLUMNS}`, [id, status]);
            return rows[0] ? normalize(rows[0]) : null;
        }
    };
}

function createCandidatesStore(sqliteDb, env = process.env, poolFactory) {
    const url = env.DATABASE_URL;
    if (!url) return sqliteStore(sqliteDb);

    let pool;
    if (poolFactory) {
        pool = poolFactory(url);
    } else {
        const { Pool } = require('pg');
        const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
        // Neon/Supabase kabi tashqi xizmatlar SSL talab qiladi
        pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
        pool.on('error', e => console.error('Postgres pool xatosi:', e.message));
    }
    return postgresStore(pool);
}

module.exports = { createCandidatesStore };