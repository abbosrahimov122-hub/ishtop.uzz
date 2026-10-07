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
                INSERT INTO candidates (fullName, phone, telegramUsername, region, desiredRole, experienceYears, about, ownerTelegramId, createdAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(c.fullName, c.phone, c.telegramUsername || null, c.region, c.desiredRole,
                c.experienceYears, c.about || null, c.ownerTelegramId || null, new Date().toISOString());
            return db.prepare('SELECT * FROM candidates WHERE id = ?').get(info.lastInsertRowid);
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
    created_at        AS "createdAt"`;

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
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_candidates_created ON candidates (created_at);
        CREATE INDEX IF NOT EXISTS idx_candidates_region ON candidates (region);
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
                `INSERT INTO candidates (full_name, phone, telegram_username, region, desired_role, experience_years, about, owner_telegram_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING ${PG_COLUMNS}`,
                [c.fullName, c.phone, c.telegramUsername || null, c.region, c.desiredRole,
                c.experienceYears, c.about || null, c.ownerTelegramId || null]
            );
            return normalize(rows[0]);
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