/**
 * Terminal orqali vakansiyalarni boshqarish (PowerShell / CMD / bash).
 * Server ishlab turgan bo'lsa ham bo'ladi: sahifani yangilasangiz e'lonlar ko'rinadi.
 *
 *   node vakansiya.js regions                       viloyat kalitlari ro'yxati
 *   node vakansiya.js list [--region samarqand]     vakansiyalar ro'yxati
 *   node vakansiya.js add --title "Buxgalter" --company "Nomi MChJ" --employee "Ali Valiyev" `
 *                         --region toshkent-shahri --location "Chilonzor tumani" `
 *                         --salary "5 000 000 UZS" --type full --desc "Tavsif"
 *   node vakansiya.js import jobs.json              ko'p vakansiyani JSON fayldan qo'shish
 *   node vakansiya.js delete VT-37                  bitta vakansiyani o'chirish
 *
 * --type: full (To'liq bandlik) | part (Yarim bandlik) | remote (Masofaviy) | hybrid (Gibrid)
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { REGIONS, ensureSchema } = require('./vacancies-db');

const TYPES = { full: "To'liq bandlik", part: 'Yarim bandlik', remote: 'Masofaviy', hybrid: 'Gibrid' };
const TYPE_NAMES = Object.values(TYPES);
const REGION_KEYS = REGIONS.map(r => r.key);

const db = new Database(path.join(__dirname, 'orders.db'));
db.pragma('journal_mode = WAL');
ensureSchema(db);

function parseFlags(args) {
    const out = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const next = args[i + 1];
            if (next === undefined || next.startsWith('--')) out[args[i].slice(2)] = true;
            else { out[args[i].slice(2)] = next; i++; }
        }
    }
    return out;
}

const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

// Bitta vakansiyani tekshiradi; xato bo'lsa matn qaytaradi
function normalize(j) {
    const v = {
        title: clean(j.title, 120), company: clean(j.company, 120), employee: clean(j.employee, 120),
        location: clean(j.location, 120), salary: clean(j.salary, 60) || 'Kelishiladi',
        description: clean(j.desc || j.description, 2000) || "Batafsil ma'lumot suhbat davomida beriladi.",
        region: clean(j.region, 40)
    };
    const t = clean(j.type, 40);
    v.type = TYPES[t] || (TYPE_NAMES.includes(t) ? t : TYPES.full);
    for (const f of ['title', 'company', 'employee', 'location']) if (!v[f]) return { error: `"${f}" maydoni bo'sh` };
    if (!REGION_KEYS.includes(v.region)) return { error: `viloyat kaliti noto'g'ri: "${v.region}" (node vakansiya.js regions)` };
    return { value: v };
}

const insert = db.prepare(`
    INSERT INTO vacancies (title, company, employee, region, location, salary, type, description, ownerTelegramId, createdAt, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'terminal', ?, 'admin')
`);
const addOne = v => insert.run(v.title, v.company, v.employee, v.region, v.location, v.salary, v.type, v.description, new Date().toISOString());

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'regions') {
    REGIONS.forEach(r => console.log(r.key.padEnd(20), r.name));

} else if (cmd === 'list') {
    const f = parseFlags(rest);
    const rows = f.region
        ? db.prepare("SELECT * FROM vacancies WHERE status='active' AND region = ? ORDER BY createdAt DESC").all(f.region)
        : db.prepare("SELECT * FROM vacancies WHERE status='active' ORDER BY createdAt DESC").all();
    rows.forEach(r => console.log(`VT-${r.id}`.padEnd(7), (r.source === 'seed' ? '[namuna] ' : '') + r.title, '|', r.company, '|', r.region || '-'));
    console.log(`Jami: ${rows.length}`);

} else if (cmd === 'add') {
    const f = parseFlags(rest);
    const n = normalize(f);
    if (n.error) { console.error('❌ ' + n.error); process.exit(1); }
    const info = addOne(n.value);
    console.log(`✅ Qo'shildi: VT-${info.lastInsertRowid} — ${n.value.title}`);

} else if (cmd === 'import') {
    const file = rest[0];
    if (!file || !fs.existsSync(file)) { console.error("❌ Fayl topilmadi. Misol: node vakansiya.js import jobs.json"); process.exit(1); }
    let list;
    try { list = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }   // PowerShell BOM'ini olib tashlaymiz
    catch (e) { console.error('❌ JSON o\'qib bo\'lmadi: ' + e.message); process.exit(1); }
    if (!Array.isArray(list)) { console.error('❌ Fayl vakansiyalar massivi ([...]) bo\'lishi kerak'); process.exit(1); }

    // Avval hammasini tekshiramiz: birontasida xato bo'lsa, hech narsa qo'shilmaydi
    const checked = list.map((j, i) => ({ i, ...normalize(j || {}) }));
    const bad = checked.filter(c => c.error);
    if (bad.length) {
        bad.forEach(c => console.error(`❌ #${c.i + 1}: ${c.error}`));
        console.error("Hech narsa qo'shilmadi. Xatolarni to'g'rilab qayta urining.");
        process.exit(1);
    }
    db.exec('BEGIN');
    try { checked.forEach(c => addOne(c.value)); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
    console.log(`✅ ${checked.length} ta vakansiya qo'shildi.`);

} else if (cmd === 'delete') {
    const id = parseInt(String(rest[0] || '').replace(/\D/g, ''), 10);
    if (!id) { console.error('❌ ID kiriting. Misol: node vakansiya.js delete VT-37'); process.exit(1); }
    const r = db.prepare('DELETE FROM vacancies WHERE id = ?').run(id);
    console.log(r.changes ? `🗑  VT-${id} o'chirildi.` : `VT-${id} topilmadi.`);

} else {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace('/**', '').replace(/^ \* ?/gm, ''));
}
db.close();
