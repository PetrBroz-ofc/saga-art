const crypto = require('crypto');
const { getDb, fail, requireAdmin, limitOrReject } = require('../_utils');
const M = require('../_media');

// POST /api/upload { data: <base64> } — nahraje fotku z administrace (jen přihlášená majitelka).
// Odpověď: { url: "/media/<název>.<jpg|png|webp>" }. Fotka se uloží do databáze a vydává se z /media/.
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

module.exports = async function handler(req, res) {
  if (!(await requireAdmin(req, res, ['POST']))) return;
  try {
    if (!(await limitOrReject(res, 'media_upload', 'global', 300, 60 * 60 * 1000))) return;
    const data = req.body?.data;
    if (typeof data !== 'string' || !data || data.length > Math.ceil(M.MAX_BYTES * 4 / 3) + 8) return fail(res, 413, 'Fotka je moc velká. Zmenšete ji nebo vyberte jinou.');
    if (!BASE64.test(data)) return fail(res, 400, 'Soubor se nepodařilo přečíst.');
    const buf = Buffer.from(data, 'base64');
    if (buf.length > M.MAX_BYTES) return fail(res, 413, 'Fotka je moc velká. Zmenšete ji nebo vyberte jinou.');
    const info = M.detectImage(buf);
    if (!info) return fail(res, 415, 'Podporované jsou jen fotky JPG, PNG a WebP.');
    const id = crypto.randomBytes(12).toString('hex');
    await getDb().collection('media').doc(id).create({ ext: info.ext, type: info.type, size: buf.length, data: buf.toString('base64'), createdAt: new Date() });
    return res.status(201).json({ url: `/media/${id}.${info.ext}` });
  } catch (err) {
    console.error('upload error:', err.message);
    return fail(res, 500, 'Fotku se nepodařilo uložit. Zkuste to prosím znovu.');
  }
};
