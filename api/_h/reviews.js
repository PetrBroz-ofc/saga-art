const { getDb, noStore, clientIp, fail, guard, limitOrReject } = require('../_utils');
const R = require('../_reviews');
const { RULES, refresh } = require('../_rules');
const { customerSession, hasBought } = require('../_customer');

// Veřejné recenze.
// GET  /api/reviews                  — průměry hodnocení všech šperků { summary: { id: { count, avg } } }
// GET  /api/reviews?product=<id>     — schválené recenze jednoho šperku
// POST /api/reviews                  — napsat recenzi: jen přihlášená zákaznice, která šperk koupila.
//                                      Zákaznické účty zatím nejsou, proto zatím vždy 401. Nová recenze čeká na schválení.
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
      return res.status(200).json({ on: true, summary: R.summarize(list), reviews: list.slice(0, 50).map(R.publicReview), canWrite: false });
    }

    noStore(res);
    const who = await customerSession(req);
    if (!who) return fail(res, 401, 'Recenzi mohou napsat jen přihlášené zákaznice, které šperk koupily. Přihlášení k účtu připravujeme.');
    if (!(await limitOrReject(res, 'review_cust', who.id || who.email, 5, 24 * 60 * 60 * 1000))) return;
    if (!(await limitOrReject(res, 'review_ip', clientIp(req), 10, 60 * 60 * 1000))) return;
    const v = R.validate({ ...req.body, name: req.body?.name || `${who.firstName || ''} ${(who.lastName || '').slice(0, 1)}.`.trim() });
    if (v.error) return fail(res, 400, v.error);
    const product = await getDb().collection('products').doc(v.data.productId).get();
    if (!product.exists) return fail(res, 404, 'Šperk neexistuje');
    if (!(await hasBought(who, v.data.productId))) return fail(res, 403, 'Recenzi může napsat jen zákaznice, která tenhle šperk koupila.');
    const dup = await getDb().collection('reviews').where('productId', '==', v.data.productId).where('customerId', '==', String(who.id || who.email)).get();
    if (dup.size) return fail(res, 409, 'K tomuhle šperku už jste recenzi napsala.');
    await R.create(v.data, { customerId: String(who.id || who.email), verified: true });
    return res.status(201).json({ ok: true, message: 'Děkuji! Recenze se objeví po schválení.' });
  } catch (err) {
    console.error('reviews error:', err.message);
    return fail(res, 500, 'Interní chyba serveru');
  }
};
