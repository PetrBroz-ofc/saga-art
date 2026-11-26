const { getDb, fail, requireAdmin } = require('../_utils');
const S = require('../_site');

// Nastavení vzhledu a textů webu (jen admin).
// GET  /api/site-settings            — aktuální nastavení, nabídka písem, historie
// PUT  /api/site-settings            — uložit a zveřejnit { theme, texts, links, flags }
// POST /api/site-settings { restore: n } — vrátit starší verzi z historie
// POST /api/site-settings { reset: true } — vrátit původní vzhled (aktuální se uloží do historie)

const iso = v => (v && typeof v.toDate === 'function' ? v.toDate() : v instanceof Date ? v : null)?.toISOString() || null;
const snapshotOf = d => ({ theme: d.theme || null, texts: d.texts || {}, links: d.links || {}, flags: d.flags || {}, images: d.images || {}, sections: d.sections || [], seo: d.seo || {}, tracking: d.tracking || {} });

function adminView(doc) {
  return {
    settings: doc && doc.theme ? snapshotOf(doc) : null,
    updatedAt: iso(doc?.updatedAt),
    history: (Array.isArray(doc?.history) ? doc.history : []).map((h, i) => ({ i, at: iso(h.at) })).reverse(),
    options: {
      fonts: Object.entries(S.FONTS).map(([key, f]) => ({ key, label: f[0], kind: f[1], css: f[2], gf: f[3] })),
      defaults: S.DEFAULT_THEME,
      sections: S.SECTION_IDS, lockedSections: S.LOCKED_SECTIONS,
    },
  };
}

module.exports = async function handler(req, res) {
  if (!(await requireAdmin(req, res, ['GET', 'PUT', 'POST']))) return;
  const ref = getDb().collection('settings').doc('site');
  try {
    if (req.method === 'GET') {
      return res.status(200).json(adminView(await S.load()));
    }

    const writeNew = async (build) => {
      const out = await getDb().runTransaction(async tx => {
        const snap = await tx.get(ref);
        const cur = snap.exists ? snap.data() : null;
        const history = Array.isArray(cur?.history) ? cur.history.slice() : [];
        if (cur?.theme) history.push({ at: cur.updatedAt || new Date(), data: snapshotOf(cur) });
        const next = build(cur, history);
        if (next.error) return next;
        const doc = { ...next.doc, history: history.slice(-S.HISTORY), updatedAt: new Date() };
        tx.set(ref, doc);
        return { doc };
      });
      if (out.error) return fail(res, 400, out.error);
      return res.status(200).json(adminView(out.doc));
    };

    if (req.method === 'PUT') {
      const v = S.validate(req.body);
      if (v.error) return fail(res, 400, v.error);
      return writeNew(() => ({ doc: v.data }));
    }

    // POST
    if (req.body?.reset === true) {
      return writeNew(() => ({ doc: { theme: null, texts: {}, links: {}, flags: {}, images: {}, sections: [], seo: {}, tracking: {} } }));
    }
    const n = req.body?.restore;
    if (Number.isInteger(n)) {
      return writeNew((cur, history) => {
        const h = Array.isArray(cur?.history) ? cur.history[n] : null;
        if (!h?.data) return { error: 'Tahle verze už není k dispozici' };
        const v = S.validate(h.data);
        if (v.error) return { error: v.error };
        return { doc: v.data };
      });
    }
    return fail(res, 400, 'Není co udělat');
  } catch (err) {
    console.error('site error:', err.message);
    return fail(res, 500, 'Interní chyba serveru');
  }
};
