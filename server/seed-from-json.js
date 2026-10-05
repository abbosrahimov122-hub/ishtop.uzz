// Baza bo'sh bo'lsa, vacancies.json dagi vakansiyalarni bazaga yuklaydi.
// Server ishga tushganda bir marta chaqiriladi: seedFromJson(db)
const fs = require('fs');
const path = require('path');

function seedFromJson(db) {
  try {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM vacancies').get();
    if (n > 0) return 0;
    const file = path.join(__dirname, 'vacancies.json');
    if (!fs.existsSync(file)) return 0;
    const items = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ins = db.prepare(`INSERT INTO vacancies
      (title, company, employee, location, salary, type, description, ownerTelegramId, status, createdAt, region, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`);
    const base = Date.now();
    let count = 0;
    items.forEach((v, i) => {
      // oxirgi vakansiya eng yangi bo'lib chiqishi uchun vaqtni oshirib boramiz
      const createdAt = new Date(base + i).toISOString();
      ins.run(v.title, v.company, v.employee || '', v.location || '', v.salary || '',
              v.type || 'full', v.desc || '', 'imported', createdAt, v.region || null, v.source || 'imported');
      count++;
    });
    console.log(`vacancies.json dan ${count} ta vakansiya yuklandi.`);
    return count;
  } catch (e) {
    console.error('seedFromJson xatosi:', e.message);
    return 0;
  }
}

module.exports = { seedFromJson };
