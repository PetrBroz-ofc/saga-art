const { getDb, fail, requireAdmin } = require('../_utils');

// Odběratelé novinek (jen admin).
// GET    /api/subscribers                      — seznam (nejnovější první)
// PATCH  /api/subscribers { id, unsubscribed } — odhlásit / znovu přihlásit
// DELETE /api/subscribers { id }               — smazat (např. na žádost o výmaz)

const ID_RE = /^[a-f0-9]{40}$/;
const LIMIT = 5000;
const iso = v => (v && typeof v.toDate === 'function' ? v.toDate() : v instanceof Date ? v : null)?.toISOString() || null;

module.exports = async function handler(req, res) {
  if (!(await requireAdmin(req, res, ['GET', 'PATCH', 'DELETE']))) return;
  const col = getDb().collection('newsletter');
  try {
    if (req.method === 'GET') {
      const snap = await col.orderBy('consentAt', 'desc').limit(LIMIT).get();
      return res.status(200).json(snap.docs.map(d => {
        const x = d.data();
        return { id: d.id, email: String(x.email || ''), consentAt: iso(x.consentAt), unsubscribed: x.unsubscribed === true };
      }));
    }
    const id = req.body?.id;
    if (typeof id !== 'string' || !ID_RE.test(id)) return fail(res, 400, 'Neplatný záznam');
    const ref = col.doc(id);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, 'Odběratel neexistuje');
    if (req.method === 'DELETE') {
      await ref.delete();
      return res.status(200).json({ ok: true, id });
    }
    if (typeof req.body.unsubscribed !== 'boolean') return fail(res, 400, 'Není co uložit');
    await ref.update({ unsubscribed: req.body.unsubscribed, unsubscribedAt: req.body.unsubscribed ? new Date() : null });
    return res.status(200).json({ ok: true, id, unsubscribed: req.body.unsubscribed });
  } catch (err) {
    console.error('subscribers error:', err.message);
    return fail(res, 500, 'Interní chyba serveru');
  }
};
