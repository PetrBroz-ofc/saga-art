const { getDb, sha256, fail, requireAdmin } = require('./_utils');
const { clean } = require('./_shop');
const { SELLER, seller, bank } = require('./_business');

// Faktury (jen admin).
// GET   /api/invoices               — seznam (nejnovější první)
// GET   /api/invoices?number=…      — jedna faktura (pro tisk / PDF)
// POST  /api/invoices               — vystavit fakturu (vlastní číslo, z objednávky i ruční)
// PATCH /api/invoices { number, paid } | { number, storno: true }
// Vystavená faktura se kvůli účetnictví už needituje. Chyba = storno a nová faktura.

const NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,19}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAYMENTS = {
  prevod: 'Bankovním převodem', karta: 'Platební kartou', hotove: 'V hotovosti',
  dobirka: 'Na dobírku', poukaz: 'Dárkovým poukazem',
};
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}$/;
const LIMIT = 500;

const idOf = number => sha256('invoice:' + number).slice(0, 40);
const iso = v => (v && typeof v.toDate === 'function' ? v.toDate() : v instanceof Date ? v : null)?.toISOString() || null;
const round2 = n => Math.round(n * 100) / 100;
const decimals = (n, d) => Math.abs(n * 10 ** d - Math.round(n * 10 ** d)) < 1e-6;
const validDate = s => DATE_RE.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));

function publicInvoice(d) {
  return {
    number: String(d.number || ''), issueDate: d.issueDate || '', dueDate: d.dueDate || '', taxDate: d.taxDate || '',
    payment: d.payment || '', paymentLabel: PAYMENTS[d.payment] || '', vs: d.vs || '',
    customer: d.customer || {}, items: Array.isArray(d.items) ? d.items : [], total: Number(d.total) || 0,
    note: d.note || '', orderNumber: d.orderNumber || '', paid: d.paid === true, paidAt: iso(d.paidAt),
    storno: d.storno === true, stornoAt: iso(d.stornoAt), createdAt: iso(d.createdAt),
    seller: d.seller || SELLER, bank: d.bank || {},
  };
}

function validate(b) {
  if (!b || typeof b !== 'object') return { error: 'Chybí data faktury' };
  const number = clean(b.number, 20);
  if (!NUMBER_RE.test(number)) return { error: 'Číslo faktury: 1 až 20 znaků, jen písmena, číslice a / . _ -' };
  const issueDate = clean(b.issueDate, 10), dueDate = clean(b.dueDate, 10), taxDate = clean(b.taxDate || b.issueDate, 10);
  if (!validDate(issueDate) || !validDate(dueDate) || !validDate(taxDate)) return { error: 'Zkontrolujte prosím data' };
  if (dueDate < issueDate) return { error: 'Splatnost nemůže být dřív než vystavení' };
  if (!PAYMENTS[b.payment]) return { error: 'Vyberte způsob platby' };

  const c = b.customer || {};
  const customer = {
    name: clean(c.name, 120), street: clean(c.street, 120), city: clean(c.city, 80), zip: clean(c.zip, 10),
    country: clean(c.country, 60), ico: clean(c.ico, 8), dic: clean(c.dic, 14).toUpperCase(), email: clean(c.email, 254).toLowerCase(),
  };
  if (customer.name.length < 2) return { error: 'Vyplňte prosím odběratele' };
  if (customer.ico && !/^\d{8}$/.test(customer.ico)) return { error: 'IČO má 8 číslic' };
  if (customer.dic && !/^[A-Z]{2}[0-9A-Z]{8,12}$/.test(customer.dic)) return { error: 'DIČ má tvar CZ12345678' };
  if (customer.email && !EMAIL_RE.test(customer.email)) return { error: 'Neplatný e-mail odběratele' };

  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) return { error: 'Faktura musí mít 1 až 30 položek' };
  const items = [];
  for (const it of b.items) {
    const name = clean(it?.name, 200);
    const qty = Number(it?.qty), price = Number(it?.price);
    const unit = clean(it?.unit || 'ks', 10);
    if (name.length < 1) return { error: 'Každá položka potřebuje název' };
    if (!Number.isFinite(qty) || qty <= 0 || qty > 10000 || !decimals(qty, 3)) return { error: 'Neplatné množství u „' + name + '“' };
    if (!Number.isFinite(price) || Math.abs(price) > 1e6 || !decimals(price, 2)) return { error: 'Neplatná cena u „' + name + '“' };
    items.push({ name, qty, unit, price: round2(price), sum: round2(qty * price) });
  }
  const total = round2(items.reduce((s, i) => s + i.sum, 0));
  if (total < 0) return { error: 'Celková částka nemůže být záporná' };

  const orderNumber = clean(b.orderNumber, 10);
  if (orderNumber && !/^\d{10}$/.test(orderNumber)) return { error: 'Neplatné číslo objednávky' };

  return {
    data: {
      number, issueDate, dueDate, taxDate, payment: b.payment,
      vs: number.replace(/\D/g, '').slice(-10),
      customer, items, total, currency: 'CZK',
      note: clean(b.note, 500, true), orderNumber,
      paid: b.paid === true,
    },
  };
}

export default async function handler(req, res) {
  if (!(await requireAdmin(req, res, ['GET', 'POST', 'PATCH']))) return;
  const db = getDb();
  const col = db.collection('invoices');

  try {
    if (req.method === 'GET') {
      const number = req.query?.number;
      if (number !== undefined) {
        if (typeof number !== 'string' || !NUMBER_RE.test(number)) return fail(res, 400, 'Neplatné číslo faktury');
        const snap = await col.doc(idOf(number)).get();
        if (!snap.exists) return fail(res, 404, 'Faktura neexistuje');
        return res.status(200).json(publicInvoice(snap.data()));
      }
      const snap = await col.orderBy('createdAt', 'desc').limit(LIMIT).get();
      return res.status(200).json(snap.docs.map(d => publicInvoice(d.data())));
    }

    if (req.method === 'POST') {
      const v = validate(req.body);
      if (v.error) return fail(res, 400, v.error);
      const now = new Date();
      const inv = { ...v.data, paidAt: v.data.paid ? now : null, storno: false, createdAt: now, seller: seller(), bank: bank() };
      const ref = col.doc(idOf(inv.number));

      const result = await db.runTransaction(async tx => {
        const exists = await tx.get(ref);
        if (exists.exists) return { error: [409, `Faktura číslo ${inv.number} už existuje`] };
        if (inv.orderNumber) {
          const oRef = db.collection('orders').doc(inv.orderNumber);
          const o = await tx.get(oRef);
          if (!o.exists) return { error: [404, 'Objednávka neexistuje'] };
          if (o.data().invoiceNumber) return { error: [409, `K objednávce už je faktura ${o.data().invoiceNumber}`] };
          tx.update(oRef, { invoiceNumber: inv.number, updatedAt: now });
        }
        tx.create(ref, inv);
        return { ok: true };
      });
      if (result.error) return fail(res, ...result.error);
      return res.status(201).json(publicInvoice(inv));
    }

    // PATCH
    const number = req.body?.number;
    if (typeof number !== 'string' || !NUMBER_RE.test(number)) return fail(res, 400, 'Neplatné číslo faktury');
    const ref = col.doc(idOf(number));
    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { error: [404, 'Faktura neexistuje'] };
      const cur = snap.data();
      const patch = {};
      if (req.body.storno === true) {
        if (cur.storno) return { error: [409, 'Faktura už je stornovaná'] };
        patch.storno = true; patch.stornoAt = new Date();
        // objednávka se uvolní, aby k ní šla vystavit nová faktura
        if (cur.orderNumber) {
          const oRef = db.collection('orders').doc(cur.orderNumber);
          const o = await tx.get(oRef);
          if (o.exists && o.data().invoiceNumber === cur.number) tx.update(oRef, { invoiceNumber: '', updatedAt: new Date() });
        }
      } else if (typeof req.body.paid === 'boolean') {
        if (cur.storno) return { error: [409, 'Stornovanou fakturu nejde měnit'] };
        patch.paid = req.body.paid; patch.paidAt = req.body.paid ? new Date() : null;
      } else {
        return { error: [400, 'Není co uložit'] };
      }
      tx.update(ref, patch);
      return { invoice: publicInvoice({ ...cur, ...patch }) };
    });
    if (result.error) return fail(res, ...result.error);
    return res.status(200).json(result.invoice);
  } catch (err) {
    console.error('invoices error:', err.message);
    return fail(res, 500, 'Interní chyba serveru');
  }
}
