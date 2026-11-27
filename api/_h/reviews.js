const crypto = require('crypto');
const { getDb, noStore, clientIp, fail, guard, limitOrReject } = require('../_utils');
const R = require('../_reviews');
const { RULES, refresh } = require('../_rules');
const { sendMail, notice } = require('../_mail');

// Veřejné recenze (celkové, ne u jednotlivých šperků).
// GET  /api/reviews  — průměr a schválené recenze { on, summary: { count, avg }, reviews: [...] }
// POST /api/reviews  — napsat recenzi může kdokoli, volitelně s fotkami (nejdřív se nahrají přes /api/review-photo).
//                      Vždy čeká na schválení v administraci, takže spam se na web sám nikdy nedostane.
const MAX_PENDING = 200; // pojistka proti zahlcení databáze
const DONE = 'Děkuji! Recenze se na webu objeví po schválení.';

module.exports = async function handler(req, res) {
  if (!guard(req, res, ['GET', 'POST'])) return;
  try {
    await refresh();
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      if (!RULES.reviewsShow) return res.status(200).json({ on: false, summary: { count: 0, avg: 0 }, reviews: [] });
      const list = await R.approvedAll();
      return res.status(200).json({ on: true, summary: R.summarize(list), reviews: list.slice(0, 100).map(R.publicReview) });
    }

    noStore(res);
    if (!RULES.reviewsShow) return fail(res, 403, 'Recenze jsou teď vypnuté.');
    const b = req.body;
    if (b.website) return res.status(201).json({ ok: true, message: DONE }); // past na roboty (skryté pole)
    if (!(await limitOrReject(res, 'review_ip', clientIp(req), 5, 60 * 60 * 1000))) return;

    const v = R.validate({ rating: b.rating, name: b.name, title: '', text: b.text, photos: b.photos });
    if (v.error) return fail(res, 400, v.error);
    if (R.looksSpam(v.data)) return fail(res, 400, 'Do recenze prosím nepište odkazy ani internetové adresy.');

    const db = getDb();
    if (v.data.photos.length && !(await R.photosExist(v.data.photos, { onlyReview: true }))) return fail(res, 400, 'Fotka se nepodařila načíst, nahrajte ji prosím znovu.');

    const hash = crypto.createHash('sha256').update(v.data.text.toLowerCase().replace(/\s+/g, ' ')).digest('hex');
    const dup = await db.collection('reviews').where('hash', '==', hash).get();
    if (dup.size) return res.status(201).json({ ok: true, message: DONE });

    if (!(await limitOrReject(res, 'review_ip_day', clientIp(req), 10, 24 * 60 * 60 * 1000))) return;
    if (!(await limitOrReject(res, 'review_all', 'global', 60, 24 * 60 * 60 * 1000))) return;
    const pending = await db.collection('reviews').where('status', '==', 'pending').get();
    if (pending.size >= MAX_PENDING) return fail(res, 429, 'Recenzi teď nejde přijmout, zkuste to prosím později.');

    await R.create(v.data, { hash });
    if (process.env.OWNER_EMAIL) {
      await sendMail({ to: process.env.OWNER_EMAIL, ...notice('Nová recenze čeká na schválení', `Hodnocení: ${v.data.rating} z 5\nJméno: ${v.data.name}\nFotky: ${v.data.photos.length}\n\n${v.data.text}\n\nSchválit nebo skrýt ji můžete v administraci v části Recenze: https://sagaart.cz/admin`) })
        .catch(e => console.error('oznámení o recenzi selhalo:', e.message));
    }
    return res.status(201).json({ ok: true, message: DONE });
  } catch (err) {
    console.error('reviews error:', err.message);
    return fail(res, 500, 'Interní chyba serveru');
  }
};
