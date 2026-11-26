const crypto = require('crypto');
const { getDb, noStore, clientIp, fail, guard, limitOrReject } = require('../_utils');
const R = require('../_reviews');
const { RULES, refresh } = require('../_rules');
const { sendMail, notice } = require('../_mail');

// Veřejné recenze.
// GET  /api/reviews                  — průměry hodnocení všech šperků { summary: { id: { count, avg } } }
// GET  /api/reviews?product=<id>     — schválené recenze jednoho šperku
// POST /api/reviews                  — napsat recenzi může kdokoli. Vždy čeká na schválení v administraci,
//                                      takže spam se na web sám nikdy nedostane.
const MAX_PENDING = 200; // pojistka proti zahlcení databáze
const DONE = 'Děkuji! Recenze se na webu objeví po schválení.';

module.exports = async function handler(req, res) {
  if (!guard(req, res, ['GET', 'POST'])) return;
  try {
    await refresh();
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      if (!RULES.reviewsShow) return res.status(200).json({ on: false, summary: {}, reviews: [] });
      const product = req.query?.product;
      if (product === undefined) return res.status(200).json({ on: true, summary: await R.summaries() });
      if (typeof product !== 'string' || !R.ID_RE.test(product)) return fail(res, 400, 'Neplatný šperk');
      const list = await R.approvedFor(product);
      return res.status(200).json({ on: true, summary: R.summarize(list), reviews: list.slice(0, 50).map(R.publicReview), canWrite: true });
    }

    noStore(res);
    if (!RULES.reviewsShow) return fail(res, 403, 'Recenze jsou teď vypnuté.');
    const b = req.body;
    if (b.website) return res.status(201).json({ ok: true, message: DONE }); // past na roboty (skryté pole)
    if (!(await limitOrReject(res, 'review_ip', clientIp(req), 5, 60 * 60 * 1000))) return;

    const v = R.validate({ productId: b.productId, rating: b.rating, name: b.name, title: '', text: b.text });
    if (v.error) return fail(res, 400, v.error);
    if (R.looksSpam(v.data)) return fail(res, 400, 'Do recenze prosím nepište odkazy ani internetové adresy.');

    const db = getDb();
    const product = await db.collection('products').doc(v.data.productId).get();
    if (!product.exists) return fail(res, 404, 'Šperk neexistuje');

    const hash = crypto.createHash('sha256').update(v.data.productId + '|' + v.data.text.toLowerCase().replace(/\s+/g, ' ')).digest('hex');
    const dup = await db.collection('reviews').where('hash', '==', hash).get();
    if (dup.size) return res.status(201).json({ ok: true, message: DONE });

    if (!(await limitOrReject(res, 'review_ip_day', clientIp(req), 10, 24 * 60 * 60 * 1000))) return;
    if (!(await limitOrReject(res, 'review_all', 'global', 60, 24 * 60 * 60 * 1000))) return;
    const pending = await db.collection('reviews').where('status', '==', 'pending').get();
    if (pending.size >= MAX_PENDING) return fail(res, 429, 'Recenzi teď nejde přijmout, zkuste to prosím později.');

    await R.create(v.data, { hash });
    if (process.env.OWNER_EMAIL) {
      await sendMail({ to: process.env.OWNER_EMAIL, ...notice('Nová recenze čeká na schválení', `Šperk: ${product.data().name}\nHodnocení: ${v.data.rating} z 5\nJméno: ${v.data.name}\n\n${v.data.text}\n\nSchválit nebo skrýt ji můžete v administraci v části Recenze: https://sagaart.cz/admin`) })
        .catch(e => console.error('oznámení o recenzi selhalo:', e.message));
    }
    return res.status(201).json({ ok: true, message: DONE });
  } catch (err) {
    console.error('reviews error:', err.message);
    return fail(res, 500, 'Interní chyba serveru');
  }
};
