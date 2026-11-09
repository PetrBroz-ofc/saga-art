const { getDb, fail, requireAdmin } = require('./_utils');
const { clean, afterPaid } = require('./_shop');
const { releaseForOrder } = require('./_vouchers');

// GET   /api/orders  — seznam objednávek pro admin (nejnovější první)
// PATCH /api/orders  — změna stavu, čísla zásilky nebo interní poznámky

// Kam smí admin objednávku posunout z daného stavu. Nic jiného server nepřijme.
const TRANSITIONS = {
  awaiting_transfer: ['paid', 'cancelled'],
  awaiting_payment:  ['cancelled'],
  expired:           ['cancelled'],
  payment_failed:    ['cancelled'],
  amount_mismatch:   ['paid', 'cancelled'],
  paid:              ['shipped', 'cancelled'],
  shipped:           ['paid'],          // omylem označeno jako odeslané
  cancelled:         [],
};
const NUMBER_RE = /^\d{10}$/;
const TRACKING_RE = /^[A-Za-z0-9 -]{0,40}$/;
const LIMIT = 300;

const iso = v => (v && typeof v.toDate === 'function' ? v.toDate() : v instanceof Date ? v : null)?.toISOString() || null;

// Do prohlížeče jde jen to, co admin potřebuje vidět (žádná interní Stripe ID).
function publicOrder(id, o) {
  const c = o.customer || {};
  return {
    number: id,
    status: String(o.status || ''),
    payment: String(o.payment || ''),
    shipping: String(o.shipping || ''),
    shippingPrice: Number(o.shippingPrice) || 0,
    subtotal: Number(o.subtotal) || 0,
    total: Number(o.total) || 0,
    giftWrap: o.giftWrap === true,
    giftWrapPrice: Number(o.giftWrapPrice) || 0,
    giftMessage: String(o.giftMessage || ''),
    discount: Number(o.discount) || 0,
    voucherLast4: String(o.voucher?.last4 || ''),
    vouchers: (Array.isArray(o.vouchers) ? o.vouchers : []).map(v => ({ value: Number(v.value) || 0, last4: String(v.last4 || '') })),
    invoiceNumber: String(o.invoiceNumber || ''),
    lines: (Array.isArray(o.lines) ? o.lines : []).slice(0, 20).map(l => ({
      id: String(l.id || ''), name: String(l.name || ''), price: Number(l.price) || 0, qty: Number(l.qty) || 0,
    })),
    customer: {
      jmeno: c.jmeno || '', prijmeni: c.prijmeni || '', email: c.email || '', telefon: c.telefon || '',
      ulice: c.ulice || '', mesto: c.mesto || '', psc: c.psc || '', zeme: c.zeme || '', poznamka: c.poznamka || '',
    },
    tracking: String(o.tracking || ''),
    adminNote: String(o.adminNote || ''),
    emailsSent: o.emailsSent === true,
    createdAt: iso(o.createdAt),
    paidAt: iso(o.paidAt),
    shippedAt: iso(o.shippedAt),
    cancelledAt: iso(o.cancelledAt),
  };
}

export default async function handler(req, res) {
  if (!(await requireAdmin(req, res, ['GET', 'PATCH']))) return;
  const col = getDb().collection('orders');

  try {
    if (req.method === 'GET') {
      const snap = await col.orderBy('createdAt', 'desc').limit(LIMIT).get();
      return res.status(200).json(snap.docs.map(d => publicOrder(d.id, d.data())));
    }

    // PATCH
    const { number, status } = req.body;
    if (typeof number !== 'string' || !NUMBER_RE.test(number)) return fail(res, 400, 'Neplatné číslo objednávky');

    const patch = {};
    if (req.body.tracking !== undefined) {
      const t = clean(req.body.tracking, 40);
      if (!TRACKING_RE.test(t)) return fail(res, 400, 'Číslo zásilky smí mít jen písmena, číslice a pomlčky');
      patch.tracking = t;
    }
    if (req.body.adminNote !== undefined) patch.adminNote = clean(req.body.adminNote, 1000, true);
    if (status !== undefined && typeof status !== 'string') return fail(res, 400, 'Neplatný stav');

    const ref = col.doc(number);
    const result = await getDb().runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { error: [404, 'Objednávka neexistuje'] };
      const current = snap.data().status;
      if (status && status !== current) {
        if (!(TRANSITIONS[current] || []).includes(status)) return { error: [409, 'Tuhle změnu stavu nejde udělat'] };
        patch.status = status;
        if (!snap.data()[status + 'At']) patch[status + 'At'] = new Date();
      }
      if (!Object.keys(patch).length) return { error: [400, 'Není co uložit'] };
      tx.update(ref, { ...patch, updatedAt: new Date() });
      return { order: publicOrder(number, { ...snap.data(), ...patch }) };
    });
    if (result.error) return fail(res, ...result.error);
    // následky změny stavu: zaplaceno → vystavit poukazy, zrušeno → vrátit stržený poukaz
    if (patch.status === 'paid') await afterPaid(number);
    if (patch.status === 'cancelled') await releaseForOrder(number);
    return res.status(200).json(result.order);
  } catch (err) {
    console.error('orders error:', err.message);
    return fail(res, 500, 'Interní chyba serveru');
  }
}
