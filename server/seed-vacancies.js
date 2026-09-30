/**
 * Namunaviy vakansiyalarni bazaga qo'shadi (source = 'seed').
 *
 *   node seed-vacancies.js            -> 36 ta namuna qo'shadi (allaqachon bo'lsa, tegmaydi)
 *   node seed-vacancies.js --force    -> namunalarni o'chirib, qaytadan qo'shadi
 *   node seed-vacancies.js --remove   -> faqat namunalarni o'chiradi (haqiqiy e'lonlarga tegmaydi)
 *
 * DIQQAT: bu e'lonlardagi kompaniyalar va shaxslar TO'QILGAN. Ular saytda
 * "NAMUNA" belgisi bilan ko'rinadi. Haqiqiy e'lonlar tayyor bo'lgach,
 * `--remove` bilan namunalarni o'chiring.
 */
const path = require('path');
const Database = require('better-sqlite3');
const { REGIONS, ensureSchema } = require('./vacancies-db');

const db = new Database(path.join(__dirname, 'orders.db'));
db.pragma('journal_mode = WAL');
ensureSchema(db);

const args = process.argv.slice(2);
const countSeed = () => db.prepare("SELECT COUNT(*) AS n FROM vacancies WHERE source = 'seed'").get().n;

if (args.includes('--remove') || args.includes('--force')) {
    const r = db.prepare("DELETE FROM vacancies WHERE source = 'seed'").run();
    console.log(`🗑  ${r.changes} ta namunaviy vakansiya o'chirildi.`);
    if (args.includes('--remove')) process.exit(0);
} else if (countSeed() > 0) {
    console.log(`ℹ️  Bazada allaqachon ${countSeed()} ta namuna bor. Qaytadan qo'shish uchun: node seed-vacancies.js --force`);
    process.exit(0);
}

const T = { full: "To'liq bandlik", part: 'Yarim bandlik', remote: 'Masofaviy', hybrid: 'Gibrid' };

// [region, tuman/shahar, lavozim, kompaniya, mas'ul shaxs, maosh, ish turi, tavsif]
const JOBS = [
    // ---- Toshkent shahri (7)
    ['toshkent-shahri', 'Yunusobod tumani', 'Frontend dasturchi (React)', 'Raqamli Yechim Studio', 'Sardor Ismoilov', '9 000 000 - 15 000 000 UZS', T.hybrid,
        "React va TypeScript bilan veb-ilovalar yaratish. Kamida 2 yillik tajriba, Git bilan ishlash ko'nikmasi talab qilinadi. Haftada 3 kun ofisda."],
    ['toshkent-shahri', 'Chilonzor tumani', 'Sotuvchi-maslahatchi', 'Oila Market', 'Nilufar Karimova', '3 500 000 UZS', T.full,
        "Oziq-ovqat do'konida mijozlarga xizmat ko'rsatish, mahsulotlarni javonlarga terish. Ish jadvali 2/2, tajriba shart emas."],
    ['toshkent-shahri', "Mirzo Ulug'bek tumani", 'Buxgalter', 'Ziyo Konsalting', 'Dilshod Rahimov', '5 000 000 - 7 000 000 UZS', T.full,
        "Birlamchi hujjatlar, soliq hisobotlari va ish haqi hisob-kitobi. 1C dasturini bilish va kamida 2 yil tajriba."],
    ['toshkent-shahri', 'Shayxontohur tumani', 'Kuryer (mototsikl bilan)', 'Tezkor Yetkazish', 'Bekzod Aliyev', '4 000 000 - 6 000 000 UZS', T.part,
        "Shahar bo'ylab buyurtmalarni yetkazish. O'z mototsikli yoki velosipedi bo'lgan nomzodlar afzal. Bo'sh vaqtda ishlash mumkin."],
    ['toshkent-shahri', 'Yakkasaroy tumani', 'SMM mutaxassisi', 'Brend Lab', 'Malika Yusupova', '4 500 000 - 6 500 000 UZS', T.remote,
        "Instagram va Telegram kanallarini yuritish, kontent-reja tuzish, reklama natijalarini tahlil qilish."],
    ['toshkent-shahri', 'Sergeli tumani', 'Mijozlar bilan ishlash operatori', 'Aloqa Markazi Plus', 'Gulnora Tursunova', '3 200 000 UZS', T.full,
        "Kiruvchi qo'ng'iroqlarga javob berish va murojaatlarni qayd etish. O'zbek va rus tillarini yaxshi bilish shart."],
    ['toshkent-shahri', 'Olmazor tumani', 'Mobil dasturchi (Flutter)', 'Yangi Avlod Soft', 'Jasur Nazarov', '10 000 000 - 18 000 000 UZS', T.hybrid,
        "Android va iOS uchun Flutter ilovalar. REST API bilan ishlash va state management (Bloc yoki Riverpod) tajribasi kerak."],

    // ---- Toshkent viloyati (2)
    ['toshkent-viloyati', 'Chirchiq shahri', 'Ishlab chiqarish operatori', 'Chirchiq Metall Servis', 'Akmal Xolmatov', '4 500 000 UZS', T.full,
        "Stanoklarda detallar tayyorlash, sifat nazorati. Smenali ish, ish kiyimi va tushlik beriladi."],
    ['toshkent-viloyati', 'Angren shahri', 'Elektr montajchi', 'Angren Energo Montaj', 'Farrux Ergashev', '5 000 000 - 6 500 000 UZS', T.full,
        "Elektr tarmoqlarini o'rnatish va ta'mirlash. Elektr xavfsizligi bo'yicha guruh (III va yuqori) bo'lishi shart."],

    // ---- Samarqand (4)
    ['samarqand', 'Samarqand shahri', 'Oshpaz', 'Dasturxon Restorani', 'Shahlo Abdullayeva', '4 500 000 - 7 000 000 UZS', T.full,
        "Milliy va yevropa taomlarini tayyorlash. Kamida 3 yillik tajriba, sanitariya kitobchasi bo'lishi kerak."],
    ['samarqand', 'Samarqand shahri', 'Gid-tarjimon (ingliz tili)', 'Ipak Yo\'li Sayohat', 'Timur Mahmudov', '4 000 000 - 6 000 000 UZS', T.part,
        "Xorijiy turistlarga tarixiy joylarni tanishtirish. Ingliz tilida erkin muloqot, mavsumiy ish."],
    ['samarqand', 'Urgut tumani', 'Sotuvchi', 'Zarafshon Savdo Uyi', 'Kamola Tojiyeva', '3 300 000 UZS', T.full,
        "Maishiy texnika do'konida mijozlarga maslahat berish. Savdo tajribasi afzal, o'rgatiladi."],
    ['samarqand', 'Samarqand shahri', 'Hamshira', 'Sog\'lom Hayot Klinikasi', 'Dr. Ravshan Karimov', '3 800 000 - 4 800 000 UZS', T.full,
        "Bemorlarni qabulga tayyorlash, inyeksiya va protseduralar. O'rta maxsus tibbiy ma'lumot va amaldagi sertifikat."],

    // ---- Farg'ona (3)
    ['fargona', "Marg'ilon shahri", 'Tikuvchi', 'Atlas Tekstil Fabrikasi', 'Zebo Qodirova', '3 500 000 - 5 000 000 UZS', T.full,
        "Ipak va atlas matolaridan kiyim tikish. Ish haqi bajarilgan ishga qarab hisoblanadi, tajribali tikuvchilar afzal."],
    ['fargona', "Farg'ona shahri", 'Agronom', 'Vodiy Meva Agro', 'Otabek Sodiqov', '4 500 000 UZS', T.full,
        "Bog' va issiqxonalarda o'simliklarni parvarishlash rejasi, kasallik va zararkunandalarga qarshi kurash."],
    ['fargona', "Qo'qon shahri", 'Yuk mashinasi haydovchisi', 'Vodiy Yuk Transport', 'Sherzod Ismatov', '5 500 000 UZS', T.full,
        "B va C toifali haydovchilik guvohnomasi, kamida 3 yillik tajriba. Respublika bo'ylab reyslar."],

    // ---- Andijon (3)
    ['andijon', 'Andijon shahri', 'Avtomexanik', 'Andijon Avto Servis', 'Ulug\'bek Hasanov', '4 000 000 - 7 000 000 UZS', T.full,
        "Yengil avtomobillarni diagnostika qilish va ta'mirlash. Ish haqi bajarilgan ishga bog'liq."],
    ['andijon', 'Asaka tumani', "Matematika o'qituvchisi", 'Bilim Nuri Xususiy Maktabi', 'Mahbuba Soliyeva', '4 000 000 UZS', T.full,
        "5-9 sinflarda matematika fanidan dars berish. Oliy pedagogik ma'lumot, bolalar bilan ishlash ko'nikmasi."],
    ['andijon', 'Andijon shahri', 'Ombor mudiri', 'Andijon Distribyutsiya', 'Rustam Boboyev', '5 000 000 UZS', T.full,
        "Tovarlarni qabul qilish, hisobga olish va chiqarish, inventarizatsiya. Excel yoki 1C bilan ishlay olish."],

    // ---- Namangan (3)
    ['namangan', 'Namangan shahri', 'Qandolatchi', 'Shirin Lazzat Qandolatxonasi', 'Dildora Ortiqova', '3 500 000 - 5 000 000 UZS', T.full,
        "Tort va shirinliklar tayyorlash. Tajriba afzal, ishga qiziqqan yosh mutaxassislar ham qabul qilinadi."],
    ['namangan', 'Namangan shahri', 'Sotuvchi (kiyim)', 'Sifat Kiyim Do\'koni', 'Mohira Rasulova', '3 200 000 UZS', T.full,
        "Kiyim do'konida mijozlarga xizmat ko'rsatish, vitrina va tovarlar tartibi. Muloqotga ochiq, mas'uliyatli nomzod."],
    ['namangan', 'Chust tumani', 'Qurilish ustasi (plitka)', 'Yangi Uy Qurilish', 'Nodir Qambarov', '5 000 000 - 8 000 000 UZS', T.full,
        "Kafel va plitka yotqizish, pardozlash ishlari. Kamida 2 yillik tajriba, o'z asboblari bo'lsa yaxshi."],

    // ---- Buxoro (3)
    ['buxoro', 'Buxoro shahri', 'Mehmonxona administratori', 'Ark Mehmon Uyi', 'Sevara Hamidova', '4 000 000 UZS', T.full,
        "Mehmonlarni qabul qilish va joylashtirish, bronlarni yuritish. Ingliz tili bilish shart, rus tili afzal."],
    ['buxoro', 'Buxoro shahri', 'Turizm menejeri', 'Buxoro Sayohat Markazi', 'Aziz Jo\'rayev', '5 000 000 - 7 000 000 UZS', T.hybrid,
        "Tur paketlarini shakllantirish, hamkorlar bilan ishlash, mijozlarga sotuv. Turizm sohasida tajriba."],
    ['buxoro', "G'ijduvon tumani", 'Gaz tarmog\'i texnigi', 'Buxoro Gaz Xizmati', 'Ilhom Yo\'ldoshev', '5 500 000 - 6 500 000 UZS', T.full,
        "Gaz jihozlarini tekshirish va ta'mirlash, ariza asosida chiqish. Tegishli texnik ma'lumot va ruxsatnoma kerak."],

    // ---- Xorazm (2)
    ['xorazm', 'Urganch shahri', 'Bog\'bon-agronom', 'Xorazm Meva Sanoat', 'Guljahon Matyoqubova', '4 200 000 UZS', T.full,
        "Sabzavot va meva ekinlarini parvarishlash, sug'orish rejasini yuritish. Qishloq xo'jaligi bo'yicha ma'lumot afzal."],
    ['xorazm', 'Xiva shahri', 'Turist gidi', 'Ichan Qala Gid Xizmati', 'Behzod Rahmonov', '3 800 000 - 5 500 000 UZS', T.part,
        "Ichan-Qal'a bo'ylab ekskursiyalar o'tkazish. O'zbek, rus va ingliz tillarini bilish, mavsumiy ish."],

    // ---- Qashqadaryo (2)
    ['qashqadaryo', 'Qarshi shahri', 'Sotuv menejeri', 'Qashqa Don Mahsulotlari', 'Jamshid Elmurodov', '4 500 000 - 6 500 000 UZS', T.full,
        "Un va yorma mahsulotlarini do'konlar va ulgurji xaridorlarga sotish. Mijozlar bazasi bilan ishlash, hisobot yuritish."],
    ['qashqadaryo', 'Qarshi shahri', 'Neft-gaz uskunalari operatori', 'Qashqa Energo Servis', 'Odil Normatov', '6 000 000 - 9 000 000 UZS', T.full,
        "Texnologik uskunalarni boshqarish va nazorat qilish, vaxta usulida ish. Tegishli texnik ma'lumot talab etiladi."],

    // ---- Navoiy (2)
    ['navoiy', 'Navoiy shahri', 'Payvandchi', 'Navoiy Metall Konstruksiya', 'Doniyor Sattorov', '5 500 000 - 8 000 000 UZS', T.full,
        "Metall konstruksiyalarni payvandlash, chizmalarni o'qiy olish. Attestatsiyadan o'tgan payvandchi afzal."],
    ['navoiy', 'Zarafshon shahri', "Og'ir texnika haydovchisi", 'Qizilqum Logistika', 'Bahrom Sultonov', '6 000 000 UZS', T.full,
        "Karyer va yuk tashish ishlarida ishlash. Tegishli toifadagi guvohnoma, kamida 3 yil tajriba."],

    // ---- Jizzax (1)
    ['jizzax', 'Zomin tumani', 'Dam olish maskani administratori', 'Zomin Tog\' Dam Olish Maskani', 'Nargiza Bekmurodova', '3 500 000 UZS', T.full,
        "Mehmonlarni kutib olish, xonalarni bron qilish va xizmat sifati nazorati. Mavsumiy ishga tayyor bo'lish."],

    // ---- Sirdaryo (1)
    ['sirdaryo', 'Guliston shahri', 'Zootexnik', 'Sirdaryo Chorva Fermasi', 'Xurshid Omonov', '4 500 000 UZS', T.full,
        "Chorva mollarini boqish, ratsion tuzish va mahsuldorlik hisobini yuritish. Zootexniya yoki veterinariya ma'lumoti."],

    // ---- Surxondaryo (1)
    ['surxondaryo', 'Termiz shahri', 'Meva eksporti menejeri', 'Surxon Meva Eksport', 'Anvar Xudoyberdiyev', '5 000 000 - 7 000 000 UZS', T.full,
        "Xorijiy xaridorlar bilan aloqa, yuk hujjatlarini tayyorlash, logistika. Ingliz yoki rus tilini yaxshi bilish."],

    // ---- Qoraqalpog'iston (2)
    ['qoraqalpogiston', 'Nukus shahri', "Ingliz tili o'qituvchisi", "Amudaryo O'quv Markazi", 'Gulmira Kenjayeva', '3 500 000 - 5 000 000 UZS', T.part,
        "Kattalar va o'smirlar guruhlarida ingliz tilidan dars o'tish. IELTS yoki shunga o'xshash sertifikat afzal."],
    ['qoraqalpogiston', "Mo'ynoq tumani", 'Baliq qayta ishlash texnologi', 'Orol Baliq Mahsulotlari', 'Aybek Reimov', '4 500 000 UZS', T.full,
        "Baliqni qayta ishlash va qadoqlash jarayonini nazorat qilish, sifat me'yorlariga rioya. Oziq-ovqat texnologiyasi bo'yicha ma'lumot."]
];

// Xatolikdan himoya: har bir viloyat kaliti to'g'ri ekanini tekshiramiz
const keys = new Set(REGIONS.map(r => r.key));
for (const j of JOBS) if (!keys.has(j[0])) throw new Error('Noto\'g\'ri viloyat kaliti: ' + j[0]);

const insert = db.prepare(`
    INSERT INTO vacancies (title, company, employee, location, salary, type, description, ownerTelegramId, status, createdAt, region, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'seed', 'active', ?, ?, 'seed')
`);

const now = Date.now();
db.exec('BEGIN');
try {
    JOBS.forEach((j, i) => {
        // E'lonlarni so'nggi ~3 haftaga taqsimlaymiz (eng yangisi birinchi)
        const createdAt = new Date(now - i * 13 * 60 * 60 * 1000).toISOString();
        insert.run(j[2], j[3], j[4], j[1], j[5], j[6], j[7], createdAt, j[0]);
    });
    db.exec('COMMIT');
} catch (e) {
    db.exec('ROLLBACK');
    throw e;
}
console.log(`✅ ${JOBS.length} ta namunaviy vakansiya qo'shildi (${new Set(JOBS.map(j => j[0])).size} ta hududda).`);
db.close();
