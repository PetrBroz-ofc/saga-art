const { getDb, guard } = require('../_utils');
const M = require('../_media');

// GET /media/<název>.<ext> — vydá nahranou fotku. Název je náhodný a nejde uhodnout, fotky se po nahrání nemění,
// proto je smí prohlížeč i CDN držet navždy.
module.exports = async function handler(req, res) {
  if (!guard(req, res, ['GET'])) return;
  const m = M.FILE_RE.exec(String(req.query?.f || ''));
  const notFound = () => { res.setHeader('Cache-Control', 'public, max-age=60'); return res.status(404).end(); };
  if (!m) return notFound();
  try {
    const etag = `"${m[1]}"`;
    if (req.headers['if-none-match'] === etag) { res.setHeader('ETag', etag); return res.status(304).end(); }
    const snap = await getDb().collection('media').doc(m[1]).get();
    if (!snap.exists) return notFound();
    const d = snap.data();
    if (d.ext !== m[2] || typeof d.data !== 'string') return notFound();
    res.setHeader('Content-Type', M.TYPES[d.ext]);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', etag);
    res.setHeader('Content-Disposition', 'inline');
    return res.status(200).send(Buffer.from(d.data, 'base64'));
  } catch (err) {
    console.error('media error:', err.message);
    return res.status(500).end();
  }
};
