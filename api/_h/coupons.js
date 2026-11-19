const { getDb, fail, requireAdmin } = require('../_utils');
const Coupons = require('../_coupons');

// Slevové kódy (jen admin).
// GET    /api/coupons                — seznam
// POST   /api/coupons                — nový kód
// PATCH  /api/coupons { code, … }    — změna podmínek (kód se nemění)
// DELETE /api/coupons { code }       — smazání (použitý kód jde jen vypnout)

const LIMIT = 300;
const iso = v => (v && typeof v.toDate === 'function' ? v.toDate() : v instanceof Date ? v : null)?.toISOString() || null;
const pub = (id, c) => ({
  code: id, type: c.type, value: c.value, minGoods: c.minGoods || 0, validFrom: c.validFrom || '', validTo: c.validTo || '',
  maxUses: c.maxUses || 0, used: c.used || 0, enabled: c.enabled !== false, note: c.note || '', createdAt: iso(c.createdAt),
});

module.exports = async function handler(req, res) {
  if (!(await requireAdmin(req, res, ['GET', 'POST', 'PATCH', 'DELETE']))) return;
  const col = getDb().collection('coupons');
  try {
    if (req.method === 'GET') {
      const snap = await col.orderBy('createdAt', 'desc').limit(LIMIT).get();
      return res.status(200).json(snap.docs.map(d => pub(d.id, d.data())));
    }
    if (req.method === 'POST') {
      const v = Coupons.validate(req.body, { creating: true });
      if (v.error) return fail(res, 400, v.error);
      const doc = { ...v.data, used: 0, uses: [], createdAt: new Date() };
      try { await col.doc(doc.code).create(doc); }
      catch (e) { if (e.code === 6) return fail(res, 409, `Kód ${doc.code} už existuje`); throw e; }
      return res.status(201).json(pub(doc.code, doc));
    }
    const code = Coupons.normCode(req.body?.code);
    if (!Coupons.validCode(code)) return fail(res, 400, 'Neplatný kód');
    const ref = col.doc(code);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, 'Kód neexistuje');
    if (req.method === 'DELETE') {
      if ((snap.data().used || 0) > 0) return fail(res, 409, 'Kód už někdo použil, smazat ho nejde. Vypněte ho.');
      await ref.delete();
      return res.status(200).json({ ok: true, code });
    }
    const v = Coupons.validate({ ...snap.data(), ...req.body }, { creating: false });
    if (v.error) return fail(res, 400, v.error);
    await ref.update({ ...v.data, updatedAt: new Date() });
    return res.status(200).json(pub(code, { ...snap.data(), ...v.data }));
  } catch (err) {
    console.error('coupons error:', err.message);
    return fail(res, 500, 'Interní chyba serveru');
  }
};
