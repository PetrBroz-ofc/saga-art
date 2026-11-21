'use strict';
// Pravidla obchodu, která si majitelka nastavuje v administraci (Obchod): ceny dopravy, doprava zdarma,
// dárkové zabalení, poukazy, způsoby platby, dovolená. Výchozí hodnoty jsou tady, upravené jsou v databázi
// (settings/shop). Objekty SHIPPING, GIFT_WRAP a RULES se po načtení nastavení upraví na místě, takže
// zbytek serveru (objednávky, e-maily, faktury) dál čte stejné proměnné.

const { getDb } = require('./_db');

const SHIPPING = {
  zasilkovna:        { name: 'Zásilkovna, výdejní místo nebo Z-BOX', price: 89,  country: 'CZ', freeFrom: true },
  zasilkovna_adresa: { name: 'Zásilkovna, doručení na adresu',      price: 119, country: 'CZ', freeFrom: true },
  balikovna:         { name: 'Česká pošta, Balíkovna',              price: 109, country: 'CZ' },
  posta:             { name: 'Česká pošta na adresu',               price: 130, country: 'CZ' },
  packeta_sk:        { name: 'Packeta na Slovensko',                price: 130, country: 'SK' },
  email:             { name: 'E-mailem (jen dárkový poukaz)',       price: 0,   country: '*', voucherOnly: true },
};
const GIFT_WRAP = { name: 'Dárkové zabalení', price: 59 };
// Kolekce na webu (pořadí, popis, titulní fotka). Kolekce, které mají šperky, ale nejsou v seznamu, se přidají na konec.
const DEFAULT_COLLECTIONS = [
  { name: 'Charlotte', desc: 'Jemný amazonit, pravé říční perly a čtyřlístek pro štěstí.', cover: '/img/produkty/charlotte-nahrdelnik/1.jpg' },
  { name: 'Euforie', desc: 'Drobné říční perly a zlatá ocel. Šperky na každý den, které se krásně vrství.', cover: '/img/produkty/euforie-gold-long/1.jpg' },
  { name: 'Moře', desc: 'Světle modrý akvamarín a říční perly v barvách mořské hladiny.', cover: '/img/produkty/more-kvet-nahrdelnik/1.jpg' },
  { name: 'Duna', desc: 'Výrazný zlatý řetízek, krémové perly a světlý amazonit se stromem života.', cover: '/img/produkty/duna-nahrdelnik/1.jpg' },
  { name: 'Pure', desc: 'Nepravidelné říční perly s jemnými nerezovými detaily.', cover: '/img/produkty/pure-nahrdelnik/1.jpg' },
  { name: 'Best', desc: 'Amazonit z Peru, říční perly a perleťové srdce.', cover: '/img/produkty/best-harmonie/1.jpg' },
  { name: 'Pearl', desc: 'Vrstvené perlové náhrdelníky v kombinaci se stříbřitou ocelí.', cover: '/img/produkty/silver-pearl/1.jpg' },
];
const RULES = {
  collections: DEFAULT_COLLECTIONS.map(c => ({ ...c, hidden: false })),
  freeFrom: 1490,                      // doprava zdarma od této částky (Zásilkovna), 0 = vypnuto
  giftWrapOn: true,
  reviewsShow: true,                    // recenze na webu (schválené)
  vouchersOn: true,
  voucherValues: [500, 1000, 1500],
  voucherMonths: 12,
  payments: { card: true, transfer: true },
  vacation: { on: false, block: false, message: '' },
};
const DEFAULTS = JSON.parse(JSON.stringify({ SHIPPING, GIFT_WRAP, RULES }));
const COVER_RE = /^(https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]{2,60}\/image\/upload\/[^\s"'<>]{1,300}|\/img\/produkty\/[a-z0-9-]+\/\d+\.jpg|\/media\/[a-f0-9]{24}\.(?:jpg|png|webp))$/;
const clean1 = (t, n) => String(t ?? '').normalize('NFC').replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

const SHIP_KEYS = ['zasilkovna', 'zasilkovna_adresa', 'balikovna', 'posta', 'packeta_sk'];
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// Zkontroluje nastavení z administrace. Vrací { data } nebo { error }.
function validate(b) {
  if (!b || typeof b !== 'object') return { error: 'Chybí data' };
  const shipping = {};
  for (const k of SHIP_KEYS) {
    const s = b.shipping?.[k] || {};
    const price = s.price === undefined ? DEFAULTS.SHIPPING[k].price : s.price;
    if (!int(price, 0, 2000)) return { error: `Cena dopravy „${DEFAULTS.SHIPPING[k].name}“ musí být celé číslo od 0 do 2 000 Kč` };
    shipping[k] = { price, on: s.on !== false };
  }
  if (!SHIP_KEYS.some(k => shipping[k].on)) return { error: 'Zapnutá musí být aspoň jedna doprava' };
  const freeFrom = b.freeFrom === undefined ? DEFAULTS.RULES.freeFrom : b.freeFrom;
  if (!int(freeFrom, 0, 100000)) return { error: 'Doprava zdarma: částka od 0 do 100 000 Kč (0 = vypnuto)' };

  const gw = b.giftWrap || {};
  const gwPrice = gw.price === undefined ? DEFAULTS.GIFT_WRAP.price : gw.price;
  if (!int(gwPrice, 0, 1000)) return { error: 'Cena dárkového zabalení: od 0 do 1 000 Kč' };

  const v = b.vouchers || {};
  let values = Array.isArray(v.values) ? v.values : DEFAULTS.RULES.voucherValues;
  if (!values.every(x => int(x, 100, 20000)) || values.length < 1 || values.length > 6) return { error: 'Hodnoty poukazů: 1 až 6 částek, každá od 100 do 20 000 Kč' };
  values = [...new Set(values)].sort((a, c) => a - c);
  const months = v.months === undefined ? DEFAULTS.RULES.voucherMonths : v.months;
  if (!int(months, 1, 36)) return { error: 'Platnost poukazu: 1 až 36 měsíců' };

  const payments = { card: b.payments?.card !== false, transfer: b.payments?.transfer !== false };
  if (!payments.card && !payments.transfer) return { error: 'Zapnutý musí být aspoň jeden způsob platby' };

  const vac = b.vacation || {};
  const message = typeof vac.message === 'string' ? vac.message.normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮]/g, ' ').trim().slice(0, 300) : '';
  const vacation = { on: vac.on === true, block: vac.block === true, message };
  if (vacation.on && !message) return { error: 'Napište zprávu pro zákazníky (např. „Zásilky odesílám od 5. 1.“)' };

  // kolekce
  let collections;
  if (Array.isArray(b.collections)) {
    collections = [];
    const seen = new Set();
    for (const c of b.collections) {
      const name = clean1(c?.name, 40);
      if (!name) return { error: 'Každá kolekce potřebuje název' };
      if (seen.has(name.toLowerCase())) return { error: `Kolekce „${name}“ je v seznamu dvakrát` };
      seen.add(name.toLowerCase());
      const cover = c.cover ? String(c.cover) : '';
      if (cover && !COVER_RE.test(cover)) return { error: 'Titulní fotka kolekce musí být nahraná přes administraci' };
      collections.push({ name, desc: clean1(c.desc, 200), cover, hidden: c.hidden === true });
    }
    if (collections.length > 30) return { error: 'Nejvýš 30 kolekcí' };
  }

  const reviewsShow = b.reviews?.show !== false;

  return { data: { ...(collections ? { collections } : {}), reviews: { show: reviewsShow }, shipping, freeFrom, giftWrap: { price: gwPrice, on: gw.on !== false }, vouchers: { values, months, on: v.on !== false }, payments, vacation } };
}

// Přenese uložené nastavení do sdílených objektů
function apply(doc) {
  for (const k of SHIP_KEYS) {
    const d = doc?.shipping?.[k];
    SHIPPING[k].price = d && Number.isInteger(d.price) ? d.price : DEFAULTS.SHIPPING[k].price;
    SHIPPING[k].off = d ? d.on === false : false;
  }
  RULES.collections = Array.isArray(doc?.collections) ? doc.collections.map(c => ({ name: c.name, desc: c.desc || '', cover: c.cover || '', hidden: c.hidden === true })) : DEFAULTS.RULES.collections.map(c => ({ ...c }));
  GIFT_WRAP.price = Number.isInteger(doc?.giftWrap?.price) ? doc.giftWrap.price : DEFAULTS.GIFT_WRAP.price;
  RULES.giftWrapOn = doc?.giftWrap ? doc.giftWrap.on !== false : true;
  RULES.reviewsShow = doc?.reviews ? doc.reviews.show !== false : true;
  RULES.freeFrom = Number.isInteger(doc?.freeFrom) ? doc.freeFrom : DEFAULTS.RULES.freeFrom;
  RULES.vouchersOn = doc?.vouchers ? doc.vouchers.on !== false : true;
  RULES.voucherValues = Array.isArray(doc?.vouchers?.values) && doc.vouchers.values.length ? doc.vouchers.values.slice() : DEFAULTS.RULES.voucherValues.slice();
  RULES.voucherMonths = Number.isInteger(doc?.vouchers?.months) ? doc.vouchers.months : DEFAULTS.RULES.voucherMonths;
  RULES.payments = { card: doc?.payments ? doc.payments.card !== false : true, transfer: doc?.payments ? doc.payments.transfer !== false : true };
  RULES.vacation = { on: doc?.vacation?.on === true, block: doc?.vacation?.block === true, message: String(doc?.vacation?.message || '') };
}

let loadedAt = 0;
async function load() {
  const s = await getDb().collection('settings').doc('shop').get();
  return s.exists ? s.data() : null;
}
// Načte nastavení z databáze (nejvýš jednou za 20 s na instanci). Když databáze selže, platí poslední známé / výchozí.
async function refresh(force = false) {
  if (!force && Date.now() - loadedAt < 20000) return;
  try { apply(await load()); loadedAt = Date.now(); } catch (err) { console.error('Pravidla obchodu se nenačetla:', err.message); }
}
const markStale = () => { loadedAt = 0; };

// Co dostane veřejný web (jen to, co se zobrazuje; vypnuté dopravy se vůbec nepošlou)
// Platba kartou se nabízí jen tehdy, když je Stripe opravdu připravený: ve Vercelu musí být STRIPE_SECRET_KEY
// a zároveň CARD_PAYMENTS=on. Do té doby jde platit jen převodem (s QR kódem), i kdyby byla karta
// v administraci zapnutá. Převod se zapne vždy, když by jinak nezbyla žádná platba.
const cardReady = () => !!process.env.STRIPE_SECRET_KEY && process.env.CARD_PAYMENTS === 'on';
function payments() {
  const card = RULES.payments.card && cardReady();
  return { card, transfer: RULES.payments.transfer || !card };
}

function publicRules() {
  const shipping = {};
  for (const [k, s] of Object.entries(SHIPPING)) if (!s.off) shipping[k] = s;
  return {
    shipping, giftWrap: { ...GIFT_WRAP, on: RULES.giftWrapOn }, freeShippingFrom: RULES.freeFrom,
    vouchers: { on: RULES.vouchersOn, values: RULES.voucherValues, months: RULES.voucherMonths },
    payments: payments(), vacation: RULES.vacation, reviews: { on: RULES.reviewsShow },
    collections: RULES.collections.filter(c => !c.hidden).map(c => ({ name: c.name, desc: c.desc, cover: c.cover })),
  };
}

module.exports = { SHIPPING, GIFT_WRAP, RULES, DEFAULTS, SHIP_KEYS, validate, apply, load, refresh, markStale, publicRules, payments, cardReady };
