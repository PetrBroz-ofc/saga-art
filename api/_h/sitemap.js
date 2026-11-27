const { getDb, SITE_URL, guard, fail } = require('../_utils');

// GET /sitemap.xml — mapa stránek pro vyhledávače: úvodní stránka, informační stránky a každý šperk skladem.
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const STATIC = [['/', 'weekly', '1.0'], ['/obchodni-podminky', 'yearly', '0.3'], ['/ochrana-osobnich-udaju', 'yearly', '0.3'], ['/pece-o-sperky', 'yearly', '0.5'], ['/cookies', 'yearly', '0.2'], ['/miyuki', 'yearly', '0.5']];

module.exports = async function handler(req, res) {
  if (!guard(req, res, ['GET'])) return;
  try {
    const snap = await getDb().collection('products').where('inStock', '==', true).get();
    const urls = [
      ...STATIC.map(([p, f, pr]) => ({ loc: SITE_URL + p, f, pr })),
      ...snap.docs.filter(d => /^[A-Za-z0-9_-]{1,128}$/.test(d.id)).map(d => ({ loc: `${SITE_URL}/sperk/${encodeURIComponent(d.id)}`, f: 'monthly', pr: '0.8' })),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${esc(u.loc)}</loc><changefreq>${u.f}</changefreq><priority>${u.pr}</priority></url>`).join('\n')}\n</urlset>\n`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(xml);
  } catch (err) {
    console.error('sitemap error:', err.message);
    return fail(res, 500, 'Interní chyba serveru');
  }
};
