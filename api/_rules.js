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
const RULES = {
  freeFrom: 1490,                      // doprava zdarma od této částky (Zásilkovna), 0 = vypnuto
  giftWrapOn: true,
  vouchersOn: true,
  voucherValues: [500, 1000, 1500],
  voucherMonths: 12,
  payments: { card: true, transfer: true },
  vacation: { on: false, block: false, message: '' },
};
const DEFAULTS = JSON.parse(JSON.stringify({ SHIPPING, GIFT_WRAP, RULES }));

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

  return { data: { shipping, freeFrom, giftWrap: { price: gwPrice, on: gw.on !== false }, vouchers: { values, months, on: v.on !== false }, payments, vacation } };
}

// Přenese uložené nastavení do sdílených objektů
function apply(doc) {
  for (const k of SHIP_KEYS) {
    const d = doc?.shipping?.[k];
    SHIPPING[k].price = d && Number.isInteger(d.price) ? d.price : DEFAULTS.SHIPPING[k].price;
    SHIPPING[k].off = d ? d.on === false : false;
  }
  GIFT_WRAP.price = Number.isInteger(doc?.giftWrap?.price) ? doc.giftWrap.price : DEFAULTS.GIFT_WRAP.price;
  RULES.giftWrapOn = doc?.giftWrap ? doc.giftWrap.on !== false : true;
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
function publicRules() {
  const shipping = {};
  for (const [k, s] of Object.entries(SHIPPING)) if (!s.off) shipping[k] = s;
  return {
    shipping, giftWrap: { ...GIFT_WRAP, on: RULES.giftWrapOn }, freeShippingFrom: RULES.freeFrom,
    vouchers: { on: RULES.vouchersOn, values: RULES.voucherValues, months: RULES.voucherMonths },
    payments: RULES.payments, vacation: RULES.vacation,
  };
}

module.exports = { SHIPPING, GIFT_WRAP, RULES, DEFAULTS, SHIP_KEYS, validate, apply, load, refresh, markStale, publicRules };
