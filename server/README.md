# IshTop — To'lov serveri (xavfsizlik yaxshilangan versiya)

## Nima o'zgardi (xavfsizlik)

1. **KRITIK TUZATISH**: Avvalgi versiyada `express.static(__dirname)` butun
   loyiha papkasini ochiq qilib qo'ygan edi — bu degani `.env` (Secret
   Key'lar), `orders.db` (barcha buyurtmalar) va server kodining o'zi
   internetdan HTTP orqali o'qilishi mumkin edi. Endi faqat `../public`
   papkasi (HTML fayllar) ochiq, server papkasi butunlay yopiq.
2. Helmet — xavfsizlik HTTP header'lari.
3. Rate limiting — `/api/orders` va webhook'larga soniyasiga cheksiz so'rov
   yuborib bo'lmaydi.
4. Server ishga tushishda `.env` to'liqligini tekshiradi (kalit yo'q bo'lsa,
   darhol to'xtaydi, jim ishlamaydi).
5. To'lov summasi endi faqat serverdagi `ALLOWED_PLANS` ro'yxati bilan
   tasdiqlanadi — brauzerdan ixtiyoriy summa yuborib bo'lmaydi.
6. Payme'ning barcha 5 majburiy metodi (`CheckTransaction`, `GetStatement`
   qo'shildi).
7. 12 soatlik tranzaksiya muddati nazorati.
8. Click imzosi endi `timingSafeEqual` bilan solishtiriladi (timing-attack
   himoyasi).
9. Barcha endpoint'lar try/catch bilan o'ralgan — server yiqilib qolmaydi.

## Papka tuzilishi

```
loyiha/
├── public/              <- FAQAT shu papka internetga ochiq
│   ├── index.html
│   ├── dashboard.html
│   ├── kartalar.html
│   └── ...
└── server/               <- bu papka HECH QACHON ochiq emas
    ├── payments-server.js
    ├── package.json
    ├── .env              <- (o'zingiz yaratasiz, Git'ga qo'shilmaydi)
    ├── .env.example
    └── orders.db          <- avtomatik yaratiladi
```

## O'rnatish

```bash
cd server
npm install
cp .env.example .env    # va haqiqiy Payme/Click qiymatlarini kiriting
npm start
```

Server ishga tushgach, saytni **shu server orqali** oching:
`http://localhost:3000/dashboard.html` (endi alohida statik server kerak
emas — payments-server.js o'zi HTML fayllarni ham beradi).

## Production'ga chiqishda yana quyidagilarga e'tibor bering

- HTTPS majburiy (Payme/Click faqat shifrlangan webhook qabul qiladi)
- `.env` faylini serverga faqat xavfsiz kanal orqali (masalan SSH) joylang,
  hech qachon email/chat orqali yubormang
- `NODE_ENV=production` qo'ying
- Sandbox kalitlaringizni Payme/Click kabinetida **Production**ga
  almashtiring
