/**
 * Telegram autentifikatsiyasini tekshirish.
 *
 * Ikki xil oqim mavjud, ikkalasi ham turlicha tekshiriladi:
 *
 * 1) Telegram Mini App (WebApp) — sayt Telegram ilovasi ichida ochilganda,
 *    window.Telegram.WebApp.initData satri keladi.
 *    Hujjat: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * 2) Telegram Login Widget — sayt oddiy brauzerda ochilganda, Telegram'ning
 *    rasmiy "Login with Telegram" tugmasi orqali keladi (redirect/callback).
 *    Hujjat: https://core.telegram.org/widgets/login
 *
 * Ikkala holatda ham BOT_TOKEN hech qachon frontendga chiqmaydi — bu yerda,
 * serverda, kelgan ma'lumot haqiqatan Telegram tomonidan imzolanganini
 * tasdiqlash uchun ishlatiladi.
 */

const crypto = require('crypto');

const MAX_AUTH_AGE_SEC = 24 * 60 * 60; // 24 soatdan eski so'rovlarni rad etamiz (replay himoyasi)

/**
 * Telegram Mini App'dan kelgan initData satrini tekshiradi.
 * @returns {object|null} tekshiruvdan o'tgan foydalanuvchi obyekti yoki null
 */
function verifyWebAppInitData(initData, botToken) {
    if (!initData || typeof initData !== 'string') return null;

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = [...params.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join('\n');

    // Telegram hujjatiga ko'ra: secret_key = HMAC_SHA256(bot_token, "WebAppData")
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (!timingSafeEqualHex(computedHash, hash)) return null;

    const authDate = Number(params.get('auth_date') || 0);
    if (!authDate || (Date.now() / 1000 - authDate) > MAX_AUTH_AGE_SEC) return null;

    const userJson = params.get('user');
    if (!userJson) return null;

    try {
        const user = JSON.parse(userJson);
        if (!user.id) return null;
        return user;
    } catch {
        return null;
    }
}

/**
 * Telegram Login Widget'dan kelgan query/body ma'lumotlarini tekshiradi.
 * @returns {object|null} tekshiruvdan o'tgan foydalanuvchi obyekti yoki null
 */
function verifyLoginWidgetData(data, botToken) {
    if (!data || !data.hash) return null;
    const { hash, ...rest } = data;

    const dataCheckString = Object.keys(rest)
        .filter(k => rest[k] !== undefined && rest[k] !== null && rest[k] !== '')
        .sort()
        .map(k => `${k}=${rest[k]}`)
        .join('\n');

    // Telegram hujjatiga ko'ra: secret_key = SHA256(bot_token)
    const secretKey = crypto.createHash('sha256').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (!timingSafeEqualHex(computedHash, hash)) return null;

    const authDate = Number(rest.auth_date || 0);
    if (!authDate || (Date.now() / 1000 - authDate) > MAX_AUTH_AGE_SEC) return null;

    if (!rest.id) return null;
    return rest; // { id, first_name, last_name, username, photo_url, auth_date }
}

function timingSafeEqualHex(a, b) {
    const bufA = Buffer.from(String(a), 'hex');
    const bufB = Buffer.from(String(b), 'hex');
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { verifyWebAppInitData, verifyLoginWidgetData };
