/**
 * Telegram Mini App SDK'ni ishga tushiradi (agar sayt Telegram ichida
 * ochilgan bo'lsa) va boshqa skriptlar ishlatadigan kichik yordamchilarni
 * (window.tmaHaptic, window.isTelegramWebApp) e'lon qiladi.
 *
 * Bu fayl real Telegram autentifikatsiyasi UCHUN EMAS — u faqat UI/UX
 * (haptika, ranglar, "expand") uchun. Haqiqiy login tekshiruvi serverda,
 * initData imzosi orqali amalga oshadi (qarang: /api/auth/telegram-webapp).
 */
(function () {
    var tg = window.Telegram && window.Telegram.WebApp;
    window.isTelegramWebApp = !!(tg && tg.initData);

    if (tg) {
        try {
            tg.ready();
            tg.expand();
            if (tg.setHeaderColor) tg.setHeaderColor('#002046');
            if (tg.setBackgroundColor) tg.setBackgroundColor('#f7f9fb');
        } catch (e) {
            // Eski Telegram versiyalarida ba'zi metodlar bo'lmasligi mumkin — jim o'tkazamiz
        }
    }

    window.tmaHaptic = function (style) {
        if (!tg || !tg.HapticFeedback) return;
        try {
            if (style === 'light' || style === 'medium' || style === 'heavy' || style === 'rigid' || style === 'soft') {
                tg.HapticFeedback.impactOccurred(style);
            } else if (style === 'success' || style === 'error' || style === 'warning') {
                tg.HapticFeedback.notificationOccurred(style);
            } else {
                tg.HapticFeedback.selectionChanged();
            }
        } catch (e) { /* jim o'tkazamiz */ }
    };
})();
