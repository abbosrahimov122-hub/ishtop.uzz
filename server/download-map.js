/**
 * O'zbekiston viloyatlari chegaralarini (GeoJSON) yuklab, public/ papkasiga saqlaydi.
 * Shunda xarita tashqi saytlarga bog'liq bo'lmay, o'z serveringizdan ishlaydi.
 *
 *   node download-map.js
 *   node download-map.js https://boshqa-manba/fayl.geojson    (ixtiyoriy: o'z manbangiz)
 *
 * Manba: geoBoundaries (CC BY 4.0) — https://www.geoboundaries.org
 * Internet kerak (Node 18+).
 */
const fs = require('fs');
const path = require('path');

const URLS = process.argv[2] ? [process.argv[2]] : [
    'https://cdn.jsdelivr.net/gh/wmgeolab/geoBoundaries@9469f09/releaseData/gbOpen/UZB/ADM1/geoBoundaries-UZB-ADM1_simplified.geojson',
    'https://raw.githubusercontent.com/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/UZB/ADM1/geoBoundaries-UZB-ADM1_simplified.geojson'
];
const OUT = path.join(__dirname, '..', 'public', 'uzbekistan-regions.geojson');

(async () => {
    for (const url of URLS) {
        try {
            console.log('⬇️  Yuklanmoqda:', url);
            const res = await fetch(url);
            if (!res.ok) { console.log('   HTTP', res.status); continue; }
            const geo = await res.json();
            const n = Array.isArray(geo.features) ? geo.features.length : 0;
            if (n < 10) { console.log(`   Kutilmagan fayl (${n} ta xususiyat), o'tkazib yuborildi`); continue; }
            fs.mkdirSync(path.dirname(OUT), { recursive: true });
            fs.writeFileSync(OUT, JSON.stringify(geo));
            console.log(`✅ Saqlandi: ${OUT} (${n} ta hudud, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
            return;
        } catch (e) {
            console.log('   Xato:', e.message);
        }
    }
    console.error("❌ Hech bir manbadan yuklab bo'lmadi. Internet aloqasini tekshiring yoki o'z havolangizni bering.");
    process.exit(1);
})();
