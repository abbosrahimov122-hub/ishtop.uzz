/**
 * Vakansiyalar jadvali va viloyatlar ro'yxati (server va seed skripti uchun umumiy).
 */

// 14 ta hudud. lat/lng — xaritadagi belgi (marker) joylashuvi (viloyat markazi).
const REGIONS = [
    { key: 'toshkent-shahri',  name: 'Toshkent shahri',      lat: 41.2995, lng: 69.2401 },
    { key: 'toshkent-viloyati', name: 'Toshkent viloyati',   lat: 41.4700, lng: 69.5800 },
    { key: 'andijon',          name: 'Andijon viloyati',     lat: 40.7821, lng: 72.3442 },
    { key: 'buxoro',           name: 'Buxoro viloyati',      lat: 39.7747, lng: 64.4286 },
    { key: 'fargona',          name: "Farg'ona viloyati",    lat: 40.3864, lng: 71.7864 },
    { key: 'jizzax',           name: 'Jizzax viloyati',      lat: 40.1158, lng: 67.8422 },
    { key: 'xorazm',           name: 'Xorazm viloyati',      lat: 41.5507, lng: 60.6307 },
    { key: 'namangan',         name: 'Namangan viloyati',    lat: 40.9983, lng: 71.6726 },
    { key: 'navoiy',           name: 'Navoiy viloyati',      lat: 40.1039, lng: 65.3739 },
    { key: 'qashqadaryo',      name: 'Qashqadaryo viloyati', lat: 38.8606, lng: 65.7890 },
    { key: 'samarqand',        name: 'Samarqand viloyati',   lat: 39.6542, lng: 66.9597 },
    { key: 'sirdaryo',         name: 'Sirdaryo viloyati',    lat: 40.4897, lng: 68.7842 },
    { key: 'surxondaryo',      name: 'Surxondaryo viloyati', lat: 37.2242, lng: 67.2783 },
    { key: 'qoraqalpogiston',  name: "Qoraqalpog'iston Respublikasi", lat: 42.4531, lng: 59.6103 }
];

function ensureSchema(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS vacancies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        employee TEXT NOT NULL,
        location TEXT NOT NULL,
        salary TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        ownerTelegramId TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        createdAt TEXT NOT NULL,
        region TEXT,
        source TEXT NOT NULL DEFAULT 'user'
      )
    `);

    // Avval yaratilgan (region/source ustunlari yo'q) jadvalni yangilash
    const cols = db.prepare('PRAGMA table_info(vacancies)').all().map(c => c.name);
    if (!cols.includes('region')) db.exec('ALTER TABLE vacancies ADD COLUMN region TEXT');
    if (!cols.includes('source')) db.exec("ALTER TABLE vacancies ADD COLUMN source TEXT NOT NULL DEFAULT 'user'");

    db.exec('CREATE INDEX IF NOT EXISTS idx_vacancies_created ON vacancies(createdAt)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_vacancies_region ON vacancies(region)');
}

module.exports = { REGIONS, ensureSchema };
