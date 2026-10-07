/**
 * Nomzodlar jadvali.
 */
function ensureCandidatesSchema(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fullName TEXT NOT NULL,
        phone TEXT NOT NULL,
        telegramUsername TEXT,
        region TEXT NOT NULL,
        desiredRole TEXT NOT NULL,
        experienceYears INTEGER NOT NULL DEFAULT 0,
        about TEXT,
        ownerTelegramId TEXT,
        status TEXT NOT NULL DEFAULT 'yangi',
        createdAt TEXT NOT NULL
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_candidates_created ON candidates(createdAt)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_candidates_region ON candidates(region)');
}

module.exports = { ensureCandidatesSchema };
