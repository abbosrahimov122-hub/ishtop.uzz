// Ishlatish (server papkasida): node import-json.js
// vacancies.json dagi har bir vakansiyani "node vakansiya.js add" orqali bazaga qo'shadi.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const file = path.join(__dirname, 'vacancies.json');
const items = JSON.parse(fs.readFileSync(file, 'utf8'));
let ok = 0, fail = 0;

for (const v of items) {
  const args = ['vakansiya.js', 'add'];
  for (const k of ['title','company','employee','region','location','salary','type','desc','source']) {
    if (v[k] !== undefined) args.push('--' + k, String(v[k]));
  }
  try {
    execFileSync('node', args, { cwd: __dirname, stdio: 'pipe' });
    ok++;
  } catch (e) {
    fail++;
    console.error('XATO:', v.title, '-', v.company);
  }
}
console.log(`Tayyor: ${ok} ta qo'shildi, ${fail} ta xato.`);
