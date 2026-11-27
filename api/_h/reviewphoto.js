const crypto = require('crypto');
const { getDb, fail, noStore, clientIp, guard, limitOrReject } = require('../_utils');
const M = require('../_media');
const { RULES, refresh } = require('../_rules');

// POST /api/review-photo { data: <base64> } — nahraje fotku k recenzi (smí kdokoli, ale s přísnými limity).
// Prohlížeč fotku před odesláním zmenší. Server ověří, že jde o skutečný JPEG, PNG nebo WebP, a uloží ji do
// úložiště se značkou source: 'review'. Na web se dostane až s schválenou recenzí.
// Odpověď: { url: "/media/<název>.<jpg|png|webp>" }
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

module.exports = async function handler(req, res) {
  if (!guard(req, res, ['POST'])) return;
  try {
    noStore(res);
    await refresh();
    if (!RULES.reviewsShow) return fail(res, 403, 'Recenze jsou teď vypnuté.');
    if (!(await limitOrReject(res, 'review_photo_ip', clientIp(req), 12, 60 * 60 * 1000))) return;
    if (!(await limitOrReject(res, 'review_photo_day', 'global', 300, 24 * 60 * 60 * 1000))) return;
    const data = req.body?.data;
    if (typeof data !== 'string' || !data || data.length > Math.ceil(M.MAX_BYTES * 4 / 3) + 8) return fail(res, 413, 'Fotka je moc velká. Zkuste jinou.');
    if (!BASE64.test(data)) return fail(res, 400, 'Soubor se nepodařilo přečíst.');
    const buf = Buffer.from(data, 'base64');
    if (buf.length > M.MAX_BYTES) return fail(res, 413, 'Fotka je moc velká. Zkuste jinou.');
    const info = M.detectImage(buf);
    if (!info) return fail(res, 415, 'Podporované jsou jen fotky JPG, PNG a WebP.');
    const id = crypto.randomBytes(12).toString('hex');
    await getDb().collection('media').doc(id).create({ ext: info.ext, type: info.type, size: buf.length, data: buf.toString('base64'), source: 'review', createdAt: new Date() });
    return res.status(201).json({ url: `/media/${id}.${info.ext}` });
  } catch (err) {
    console.error('review photo error:', err.message);
    return fail(res, 500, 'Fotku se nepodařilo nahrát. Zkuste to prosím znovu.');
  }
};
