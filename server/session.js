/**
 * Engil, bazasiz sessiya tizimi: foydalanuvchi ma'lumoti base64 qilinib,
 * SESSION_SECRET bilan HMAC-SHA256 imzolanadi va httpOnly cookie'ga qo'yiladi.
 * Server buni qayta ochganda imzoni tekshiradi — soxta/o'zgartirilgan
 * cookie darhol rad etiladi.
 */

const crypto = require('crypto');

function base64url(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payloadObj, secret, maxAgeSec = 30 * 24 * 60 * 60) {
    const payload = { ...payloadObj, exp: Math.floor(Date.now() / 1000) + maxAgeSec };
    const json = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
    const sig = base64url(crypto.createHmac('sha256', secret).update(json).digest());
    return `${json}.${sig}`;
}

function verify(token, secret) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [json, sig] = token.split('.');

    const expectedSig = base64url(crypto.createHmac('sha256', secret).update(json).digest());
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    try {
        const payload = JSON.parse(Buffer.from(json.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch {
        return null;
    }
}

module.exports = { sign, verify };
