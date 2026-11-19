const crypto = require('crypto');
const { getDb } = require('./_utils');
const V = require('./_vouchers');
const Mail = require('./_mail');
const Invoices = require('./_invoice');

// Ceník dopravy — JEDINÝ zdroj pravdy. Frontend si ho jen zobrazuje (GET /api/config).
const SHIPPING = {
  zasilkovna: { name: 'Zásilkovna, výdejní místo nebo Z-BOX', price: 89,  country: 'CZ', freeFrom: true },
  zasilkovna_adresa: { name: 'Zásilkovna, doručení na adresu', price: 119, country: 'CZ', freeFrom: true },
  balikovna:  { name: 'Česká pošta, Balíkovna',            price: 109, country: 'CZ' },
  posta:      { name: 'Česká pošta na adresu',            price: 130, country: 'CZ' },
  packeta_sk: { name: 'Packeta na Slovensko',                price: 130, country: 'SK' },
  email:      { name: 'E-mailem (jen dárkový poukaz)',       price: 0,   country: '*', voucherOnly: true },
};

// Dárkové zabalení na přání (navíc ke krabičce, kterou dostane každý šperk).
// CENU UPŘESNÍ MAJITELKA, zatím provizorní.
const GIFT_WRAP = { name: 'Dárkové zabalení', price: 59 };
// Doprava zdarma (jen Zásilkovna, viz freeFrom): od této částky za zboží a balení PO odečtení poukazu.
// Dopravu poukazem platit nejde, proto se limit neposuzuje v kruhu z ceny s dopravou.
const FREE_SHIPPING_FROM = 1490;
const COUNTRIES = { CZ: 'Česká republika', SK: 'Slovensko' };
const PAYMENTS = { card: 'Platební karta online', transfer: 'Bankovní převod předem', voucher: 'Dárkový poukaz' };

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_LINES = 20;
const MAX_QTY = 10;

// Odstraní řídicí znaky, normalizuje Unicode, ořízne délku.
function clean(v, max, allowNewlines = false) {
  if (typeof v !== 'string') return '';
  const re = allowNewlines ? /[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮]/g
                           : /[\u0000-\u001F\u007F​-‏‪-‮]/g;
  return v.normalize('NFC').replace(re, ' ').trim().slice(0, max);
}

// Validace zákaznických údajů — whitelist, každé pole má pravidlo.
function validateCustomer(c, shipping) {
  if (!c || typeof c !== 'object') return { error: 'Chybí kontaktní údaje' };
  const d = {
    jmeno:     clean(c.jmeno, 60),
    prijmeni:  clean(c.prijmeni, 60),
    email:     clean(c.email, 254).toLowerCase(),
    telefon:   clean(c.telefon, 20).replace(/\s+/g, ' '),
    ulice:     clean(c.ulice, 120),
    mesto:     clean(c.mesto, 80),
    psc:       clean(c.psc, 6),
    zeme:      clean(c.zeme, 2),
    poznamka:  clean(c.poznamka, 500, true),
  };
  const NAME_RE = /^[\p{L}\p{M}' .-]{1,60}$/u;
  if (!NAME_RE.test(d.jmeno) || !NAME_RE.test(d.prijmeni)) return { error: 'Neplatné jméno nebo příjmení' };
  if (!/^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}$/.test(d.email)) return { error: 'Neplatný e-mail' };
  if (!/^\+?[0-9 ]{9,19}$/.test(d.telefon)) return { error: 'Neplatné telefonní číslo' };
  if (d.ulice.length < 3 || d.mesto.length < 2) return { error: 'Neplatná adresa' };
  if (!COUNTRIES[d.zeme]) return { error: 'Doručujeme jen do ČR a na Slovensko' };
  if (!/^\d{3} ?\d{2}$/.test(d.psc)) return { error: 'Neplatné PSČ' };
  const s = SHIPPING[shipping];
  if (!s || (!s.voucherOnly && s.country !== d.zeme)) return { error: 'Neplatná doprava' };
  return { data: d };
}

// Ceny se berou VÝHRADNĚ z databáze. Smazaný / prodaný šperk koupit nejde.
async function priceCart(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_LINES) {
    return { error: 'Neplatný košík' };
  }
  const merged = new Map();
  for (const it of items) {
    const id = String(it?.id ?? '');
    const qty = Number(it?.qty);
    if (!ID_RE.test(id) || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return { error: 'Neplatná položka košíku' };
    }
    merged.set(id, Math.min(MAX_QTY, (merged.get(id) || 0) + qty));
  }

  const db = getDb();
  const lines = [];
  for (const [id, qty] of merged) {
    if (!V.isVoucherId(id)) continue;
    const value = V.voucherValue(id);
    if (!value) return { error: 'Neplatný dárkový poukaz' };
    lines.push({ id, name: V.voucherName(value), price: value, qty, voucher: true });
  }
  const ids = [...merged.keys()].filter(id => !V.isVoucherId(id));
  const snaps = ids.length ? await db.getAll(...ids.map(id => db.collection('products').doc(id))) : [];
  for (const snap of snaps) {
    const p = snap.exists ? snap.data() : null;
    const price = Number(p?.price);
    if (!p || p.inStock === false || !Number.isInteger(price) || price <= 0) {
      return { error: 'Některý šperk už není dostupný. Obnovte prosím stránku.' };
    }
    lines.push({ id: snap.id, name: String(p.name).slice(0, 200), price, qty: merged.get(snap.id) });
  }
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const goods = lines.filter(l => !l.voucher).reduce((s, l) => s + l.price * l.qty, 0);
  return { lines, subtotal, goods, onlyVouchers: goods === 0 };
}

// Číslo objednávky = variabilní symbol: RRMMDD + 4 náhodné číslice (max. 10 číslic).
function newOrderNumber() {
  const d = new Date();
  const ymd = String(d.getUTCFullYear()).slice(2)
    + String(d.getUTCMonth() + 1).padStart(2, '0')
    + String(d.getUTCDate()).padStart(2, '0');
  return ymd + String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

// Vytvoří objednávku s unikátním číslem. Když je zadaný poukaz, strhne ho ve STEJNÉ transakci
// (buď proběhne obojí, nebo nic). discountBase = z čeho smí poukaz platit (jen zboží a balení,
// ne doprava a ne jiné poukazy). Poukaz je jednorázový: čerpá se z něj, co jde, zbytek propadá.
// Doprava zdarma se posuzuje z částky za zboží a balení po slevě. Vrací { number, order } nebo { error }.
async function createOrder(data, voucherCode, discountBase) {
  const db = getDb();
  for (let attempt = 0; attempt < 8; attempt++) {
    const number = newOrderNumber();
    const ref = db.collection('orders').doc(number);
    const res = await db.runTransaction(async tx => {
      const exists = await tx.get(ref);
      if (exists.exists) return { retry: true };
      const order = { ...data, number, createdAt: new Date() };
      if (voucherCode) {
        const v = await V.reserveInTx(tx, voucherCode, discountBase, number);
        if (v.error) return { error: v.error };
        order.voucher = { docId: v.docId, last4: v.last4, amount: v.amount, consumed: v.consumed, released: false };
        order.discount = v.amount;
      }
      const discount = order.discount || 0;
      if (SHIPPING[order.shipping]?.freeFrom && discountBase - discount >= FREE_SHIPPING_FROM) order.shippingPrice = 0;
      order.total = Math.max(0, (order.subtotal || 0) + (order.shippingPrice || 0) + (order.giftWrapPrice || 0) - discount);
      if (voucherCode && order.total === 0) { order.status = 'paid'; order.payment = 'voucher'; order.paidAt = new Date(); }
      tx.create(ref, order);
      return { number, order };
    });
    if (!res.retry) return res;
  }
  throw new Error('Nepodařilo se vygenerovat číslo objednávky');
}

function bankInfo() {
  return { account: process.env.BANK_ACCOUNT || '', iban: process.env.BANK_IBAN || '' };
}

// Pošle potvrzení zákaznici a upozornění majitelce. Chyby jen loguje (bez osobních údajů).
async function sendOrderEmails(order) {
  const c = order.customer;
  const bank = bankInfo();
  const lines = [
    ...order.lines.map(l => [`${l.name} × ${l.qty}`, Mail.kc(l.price * l.qty)]),
    [`Doprava: ${SHIPPING[order.shipping].name}`, Mail.kc(order.shippingPrice)],
    ...(order.giftWrap ? [[GIFT_WRAP.name, Mail.kc(order.giftWrapPrice)]] : []),
    ...(order.discount ? [[`Dárkový poukaz …${order.voucher?.last4 || ''}`, '−' + Mail.kc(order.discount)]] : []),
  ];
  const view = {
    number: order.number,
    name: `${c.jmeno} ${c.prijmeni}`,
    email: c.email, phone: c.telefon,
    address: `${c.ulice}, ${c.psc} ${c.mesto}, ${COUNTRIES[c.zeme]}`,
    note: c.poznamka || '',
    lines, total: order.total,
    shippingLabel: SHIPPING[order.shipping].name,
    payment: order.payment, paymentLabel: PAYMENTS[order.payment],
    bank, giftMessage: order.giftWrap ? order.giftMessage || '' : '',
  };
  // Faktura k objednávce (číslo faktury = číslo objednávky) jde v příloze. Když se nepovede, e-mail odejde i bez ní.
  let attachments;
  try {
    const inv = await Invoices.ensureForOrder(order, SHIPPING[order.shipping].name, GIFT_WRAP.name);
    attachments = [{ filename: `faktura-${inv.number}.pdf`, content: await Invoices.pdf(inv) }];
    view.invoiceNumber = inv.number;
  } catch (err) {
    console.error('Faktura k objednávce', order.number, 'selhala:', err.message);
  }
  const results = await Promise.allSettled([
    Mail.sendMail({ to: c.email, attachments, ...Mail.orderCustomer(view) }),
    Mail.sendMail({ to: process.env.OWNER_EMAIL, replyTo: c.email, attachments, ...Mail.orderOwner(view) }),
  ]);
  const failed = results.filter(r => r.status === 'rejected');
  failed.forEach(r => console.error('E-mail k objednávce', order.number, 'selhal:', r.reason?.message));
  return failed.length === 0;
}

// Po zaplacení: vystaví a pošle dárkové poukazy z objednávky (bezpečné volat opakovaně).
async function afterPaid(orderNumber) {
  try {
    const res = await V.issueForOrder(orderNumber);
    if (!res || !res.email) return;
    const exp = res.expiresAt.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' });
    await Mail.sendMail({ to: res.email, ...Mail.voucherMail({ issued: res.issued, expires: exp }) });
    await getDb().collection('orders').doc(orderNumber).update({ vouchersEmailedAt: new Date() });
  } catch (err) {
    console.error('Poukazy k objednávce', orderNumber, 'selhaly:', err.message);
  }
}

module.exports = {
  SHIPPING, FREE_SHIPPING_FROM, COUNTRIES, PAYMENTS, GIFT_WRAP, ID_RE, clean, validateCustomer, priceCart,
  createOrder, sendOrderEmails, bankInfo, afterPaid,
};
