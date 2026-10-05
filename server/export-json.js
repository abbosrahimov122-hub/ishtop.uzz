// Ishlatish (server papkasida): node export-json.js
// orders.db dagi barcha vakansiyalarni vacancies.json ga yozadi (eski fayl o'rniga).
const fs = require('fs');
const path = require('path');

function openDb(file) {
  try { const D = require('better-sqlite3'); return new D(file, { readonly: true }); }
  catch (e) { const { DatabaseSync } = require('node:sqlite'); return new DatabaseSync(file, { readOnly: true }); }
}

const db = openDb(path.join(__dirname, 'orders.db'));
const rows = db.prepare('SELECT * FROM vacancies ORDER BY id ASC').all();
const out = rows.map(r => ({
  title: r.title, company: r.company, employee: r.employee, region: r.region,
  location: r.location, salary: r.salary, type: r.type, desc: r.description, source: r.source
}));
fs.writeFileSync(path.join(__dirname, 'vacancies.json'), JSON.stringify(out, null, 2), 'utf8');
console.log(`Tayyor: ${out.length} ta vakansiya vacancies.json ga yozildi.`);
