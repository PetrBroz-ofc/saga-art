const crypto = require('crypto');
const { getDb } = require('./_utils');

// Ceník dopravy — JEDINÝ zdroj pravdy. Frontend si ho jen zobrazuje (GET /api/config).
const SHIPPING = {
  zasilkovna: { name: 'Zásilkovna, výdejní místo nebo Z-BOX', price: 109, country: 'CZ' },
  balikovna:  { name: 'Česká pošta, Balíkovna',            price: 109, country: 'CZ' },
  posta:      { name: 'Česká pošta na adresu',            price: 130, country: 'CZ' },
  packeta_sk: { name: 'Packeta na Slovensko',                price: 130, country: 'SK' },
};
const COUNTRIES = { CZ: 'Česká republika', SK: 'Slovensko' };
const PAYMENTS = { card: 'Platební karta online', transfer: 'Bankovní převod předem' };

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
  if (!SHIPPING[shipping] || SHIPPING[shipping].country !== d.zeme) return { error: 'Neplatná doprava' };
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
  const ids = [...merged.keys()];
  const snaps = await db.getAll(...ids.map(id => db.collection('products').doc(id)));
  const lines = [];
  for (const snap of snaps) {
    const p = snap.exists ? snap.data() : null;
    const price = Number(p?.price);
    if (!p || p.inStock === false || !Number.isInteger(price) || price <= 0) {
      return { error: 'Některý šperk už není dostupný. Obnovte prosím stránku.' };
    }
    lines.push({ id: snap.id, name: String(p.name).slice(0, 200), price, qty: merged.get(snap.id) });
  }
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  return { lines, subtotal };
}

// Číslo objednávky = variabilní symbol: RRMMDD + 4 náhodné číslice (max. 10 číslic).
function newOrderNumber() {
  const d = new Date();
  const ymd = String(d.getUTCFullYear()).slice(2)
    + String(d.getUTCMonth() + 1).padStart(2, '0')
    + String(d.getUTCDate()).padStart(2, '0');
  return ymd + String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

// Vytvoří objednávku s unikátním číslem (create() selže, když číslo existuje).
async function createOrder(data) {
  const db = getDb();
  for (let attempt = 0; attempt < 8; attempt++) {
    const number = newOrderNumber();
    try {
      await db.collection('orders').doc(number).create({ ...data, number, createdAt: new Date() });
      return number;
    } catch (e) {
      if (e.code !== 6) throw e; // 6 = ALREADY_EXISTS
    }
  }
  throw new Error('Nepodařilo se vygenerovat číslo objednávky');
}

// ── E-maily přes EmailJS REST API — klíče jsou jen na serveru ──
async function sendEmail(templateId, params) {
  const { EMAILJS_SERVICE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY } = process.env;
  if (!EMAILJS_SERVICE_ID || !EMAILJS_PUBLIC_KEY || !EMAILJS_PRIVATE_KEY || !templateId) {
    throw new Error('EmailJS není nakonfigurován');
  }
  const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: templateId,
      user_id: EMAILJS_PUBLIC_KEY,
      accessToken: EMAILJS_PRIVATE_KEY,
      template_params: params,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('EmailJS ' + r.status);
}

function bankInfo() {
  return { account: process.env.BANK_ACCOUNT || '', iban: process.env.BANK_IBAN || '' };
}

// Pošle potvrzení zákaznici a upozornění majitelce. Chyby jen loguje (bez osobních údajů).
async function sendOrderEmails(order) {
  const c = order.customer;
  const bank = bankInfo();
  const params = {
    order_num: order.number,
    variabilni_symbol: order.number,
    order_date: new Date().toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' }),
    customer_name: c.jmeno + ' ' + c.prijmeni,
    customer_email: c.email,
    telefon: c.telefon,
    adresa: `${c.ulice}, ${c.psc} ${c.mesto}, ${COUNTRIES[c.zeme]}`,
    poznamka: c.poznamka || '—',
    items: order.lines.map(l => `${l.name} × ${l.qty} = ${l.price * l.qty} Kč`).join('\n'),
    doprava: `${SHIPPING[order.shipping].name} (${order.shippingPrice} Kč)`,
    platba: PAYMENTS[order.payment],
    total: order.total + ' Kč',
    bank_account: order.payment === 'transfer' ? bank.account : '',
    bank_iban: order.payment === 'transfer' ? bank.iban : '',
  };
  const results = await Promise.allSettled([
    sendEmail(process.env.EMAILJS_TEMPLATE_CUSTOMER, { ...params, to_email: c.email, to_name: c.jmeno }),
    sendEmail(process.env.EMAILJS_TEMPLATE_OWNER, { ...params, to_email: process.env.OWNER_EMAIL }),
  ]);
  const failed = results.filter(r => r.status === 'rejected');
  failed.forEach(r => console.error('E-mail k objednávce', order.number, 'selhal:', r.reason?.message));
  return failed.length === 0;
}

module.exports = {
  SHIPPING, COUNTRIES, PAYMENTS, ID_RE, clean, validateCustomer, priceCart,
  createOrder, sendOrderEmails, sendEmail, bankInfo,
};
