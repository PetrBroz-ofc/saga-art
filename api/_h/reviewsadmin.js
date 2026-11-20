const { getDb, fail, requireAdmin } = require('../_utils');
const R = require('../_reviews');

// Recenze v administraci (jen admin).
// GET    /api/reviews-admin            — všechny recenze (nejnovější první)
// POST   /api/reviews-admin            — přidat recenzi ručně (rovnou schválenou), např. od zákaznice z e-mailu nebo zprávy
// PATCH  /api/reviews-admin { id, status? , text?, title?, name?, rating? } — schválit, skrýt, upravit
// DELETE /api/reviews-admin { id }     — smazat
const LIMIT = 1000;
const ID = /^[a-f0-9]{20}$/;

module.exports = async function handler(req, res) {
  if (!(await requireAdmin(req, res, ['GET', 'POST', 'PATCH', 'DELETE']))) return;
  const db = getDb();
  const col = db.collection('reviews');
  try {
    if (req.method === 'GET') {
      const [snap, prods] = await Promise.all([col.orderBy('createdAt', 'desc').limit(LIMIT).get(), db.collection('products').get()]);
      const names = Object.fromEntries(prods.docs.map(d => [d.id, d.data().name]));
      return res.status(200).json(snap.docs.map(d => {
        const r = d.data();
        return { id: d.id, productId: r.productId, product: names[r.productId] || r.productId, name: r.name, rating: r.rating, title: r.title || '', text: r.text,
          status: r.status, verified: r.verified === true, source: r.source || 'customer', createdAt: R.iso(r.createdAt) };
      }));
    }

    if (req.method === 'POST') {
      const v = R.validate(req.body);
      if (v.error) return fail(res, 400, v.error);
      const p = await db.collection('products').doc(v.data.productId).get();
      if (!p.exists) return fail(res, 404, 'Šperk neexistuje');
      const r = await R.create(v.data, { status: 'approved', source: 'manual', verified: req.body.verified === true });
      return res.status(201).json({ id: r.id, ok: true });
    }

    const id = req.body?.id;
    if (typeof id !== 'string' || !ID.test(id)) return fail(res, 400, 'Neplatná recenze');
    const ref = col.doc(id);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, 'Recenze neexistuje');
    if (req.method === 'DELETE') { await ref.delete(); return res.status(200).json({ ok: true }); }

    const cur = snap.data(), patch = {};
    if (req.body.status !== undefined) {
      if (!R.STATUSES.includes(req.body.status)) return fail(res, 400, 'Neplatný stav');
      patch.status = req.body.status;
    }
    if (['text', 'title', 'name', 'rating'].some(k => req.body[k] !== undefined)) {
      const v = R.validate({ productId: cur.productId, rating: cur.rating, name: cur.name, text: cur.text, title: cur.title, ...req.body });
      if (v.error) return fail(res, 400, v.error);
      Object.assign(patch, { rating: v.data.rating, name: v.data.name, text: v.data.text, title: v.data.title });
    }
    if (typeof req.body.verified === 'boolean') patch.verified = req.body.verified;
    if (!Object.keys(patch).length) return fail(res, 400, 'Není co uložit');
    await ref.update({ ...patch, updatedAt: new Date() });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('reviews admin error:', err.message);
    return fail(res, 500, 'Interní chyba serveru');
  }
};
