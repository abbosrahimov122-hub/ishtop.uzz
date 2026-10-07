// VIP obuna: to'lov o'tganda foydalanuvchiga VIP muddati yoziladi.
// Ishlatish: ensureVipTable(db); activateVip(db, order); isVip(db, userId);

function ensureVipTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS vip_users (
    userId TEXT PRIMARY KEY,
    vipUntil TEXT NOT NULL
  )`);
}

// order: { userId, days } — to'lov o'tgan buyurtma. Qaytaradi: yangi tugash sanasi yoki null.
function activateVip(db, order) {
  if (!order || !order.userId || order.userId === 'anonymous') return null;
  const days = Number(order.days) || 30;
  const row = db.prepare('SELECT vipUntil FROM vip_users WHERE userId = ?').get(order.userId);
  const now = Date.now();
  // VIP hali tugamagan bo'lsa, yangi muddat uning ustiga qo'shiladi
  const start = row && Date.parse(row.vipUntil) > now ? Date.parse(row.vipUntil) : now;
  const until = new Date(start + days * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO vip_users (userId, vipUntil) VALUES (?, ?)
              ON CONFLICT(userId) DO UPDATE SET vipUntil = excluded.vipUntil`)
    .run(String(order.userId), until);
  return until;
}

function isVip(db, userId) {
  if (!userId) return false;
  const row = db.prepare('SELECT vipUntil FROM vip_users WHERE userId = ?').get(String(userId));
  return !!row && Date.parse(row.vipUntil) > Date.now();
}

module.exports = { ensureVipTable, activateVip, isVip };
