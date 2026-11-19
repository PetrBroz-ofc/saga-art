'use strict';
// Slevové kódy (marketing): procenta nebo pevná částka ze ZBOŽÍ, volitelně minimální nákup, platnost od-do,
// nejvýš N použití. Kód je ve stejné objednávce kombinovatelný s dárkovým poukazem (poukaz se strhne až ze zbytku).
// Použití se zapisuje ve stejné transakci jako vznik objednávky a při zrušení / propadlé platbě se vrací.

const { getDb } = require('./_utils');

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,19}$/;
const normCode = c => String(c || '').toUpperCase().replace(/\s+/g, '');
const validCode = c => CODE_RE.test(c);
const ref = code => getDb().collection('coupons').doc(code);
const pragueDay = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
const kc = n => Number(n).toLocaleString('cs-CZ') + ' Kč';

// Kolik sleva ubere ze zboží (po případném dalším odečtení se nejde dostat pod nulu)
function amountFor(c, goods) {
  const base = Math.max(0, Number(goods) || 0);
  return c.type === 'percent' ? Math.floor(base * c.value / 100) : Math.min(c.value, base);
}

// Zjistí, jestli jde kód použít. Vrací { error } nebo { ok, c }.
function usable(c, goods) {
  if (!c || c.enabled === false) return { error: 'Tento kód neznám nebo už neplatí.' };
  const today = pragueDay();
  if (c.validFrom && today < c.validFrom) return { error: 'Tento kód ještě neplatí.' };
  if (c.validTo && today > c.validTo) return { error: 'Platnost kódu vypršela.' };
  if (c.maxUses > 0 && (c.used || 0) >= c.maxUses) return { error: 'Tento kód už je vyčerpaný.' };
  if (c.minGoods > 0 && goods < c.minGoods) return { error: `Kód platí při nákupu zboží od ${kc(c.minGoods)}.` };
  return { ok: true, c };
}

// Pro kontrolu v pokladně (bez zápisu)
async function check(code, goods) {
  const n = normCode(code);
  if (!validCode(n)) return { error: 'Tento kód neznám nebo už neplatí.' };
  const snap = await ref(n).get();
  const u = usable(snap.exists ? snap.data() : null, goods);
  if (u.error) return u;
  return { ok: true, code: n, type: u.c.type, value: u.c.value, minGoods: u.c.minGoods || 0 };
}

// V transakci objednávky: zapíše použití a vrátí slevu v Kč
async function reserveInTx(tx, code, goods, orderNumber) {
  const n = normCode(code);
  if (!validCode(n)) return { error: 'Tento kód neznám nebo už neplatí.' };
  const r = ref(n);
  const snap = await tx.get(r);
  const u = usable(snap.exists ? snap.data() : null, goods);
  if (u.error) return u;
  const amount = amountFor(u.c, goods);
  if (amount <= 0) return { error: 'Kód se na tenhle nákup nedá použít.' };
  tx.update(r, { used: (u.c.used || 0) + 1, uses: [...(u.c.uses || []), { order: orderNumber, amount, at: new Date() }].slice(-100) });
  return { amount, code: n };
}

// Zrušená / propadlá objednávka: vrátí použití kódu (jen jednou)
async function releaseForOrder(orderNumber) {
  const db = getDb();
  const oRef = db.collection('orders').doc(orderNumber);
  await db.runTransaction(async tx => {
    const o = await tx.get(oRef);
    const c = o.exists ? o.data().coupon : null;
    if (!c || c.released || !c.code) return;
    const cRef = ref(c.code);
    const cs = await tx.get(cRef);
    if (cs.exists) tx.update(cRef, { used: Math.max(0, (cs.data().used || 0) - 1) });
    tx.update(oRef, { 'coupon.released': true });
  });
}

// Kontrola údajů z administrace
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = s => DATE_RE.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
function validate(b, { creating }) {
  if (!b || typeof b !== 'object') return { error: 'Chybí data' };
  const d = {};
  if (creating) {
    d.code = normCode(b.code);
    if (!validCode(d.code)) return { error: 'Kód: 3 až 20 znaků, jen písmena bez diakritiky, číslice a pomlčka (např. JARO10)' };
  }
  if (b.type !== 'percent' && b.type !== 'amount') return { error: 'Vyberte typ slevy' };
  d.type = b.type;
  if (d.type === 'percent' && !int(b.value, 1, 90)) return { error: 'Sleva v procentech: 1 až 90' };
  if (d.type === 'amount' && !int(b.value, 10, 20000)) return { error: 'Sleva v korunách: 10 až 20 000' };
  d.value = b.value;
  d.minGoods = b.minGoods === undefined || b.minGoods === '' || b.minGoods === null ? 0 : b.minGoods;
  if (!int(d.minGoods, 0, 100000)) return { error: 'Minimální nákup: 0 až 100 000 Kč' };
  d.validFrom = b.validFrom ? String(b.validFrom) : '';
  d.validTo = b.validTo ? String(b.validTo) : '';
  if ((d.validFrom && !validDate(d.validFrom)) || (d.validTo && !validDate(d.validTo))) return { error: 'Zkontrolujte data platnosti' };
  if (d.validFrom && d.validTo && d.validTo < d.validFrom) return { error: 'Konec platnosti je dřív než začátek' };
  d.maxUses = b.maxUses === undefined || b.maxUses === '' || b.maxUses === null ? 0 : b.maxUses;
  if (!int(d.maxUses, 0, 100000)) return { error: 'Počet použití: 0 (bez omezení) až 100 000' };
  d.enabled = b.enabled !== false;
  d.note = typeof b.note === 'string' ? b.note.normalize('NFC').replace(/[\u0000-\u001F\u007F​-‏‪-‮]/g, ' ').trim().slice(0, 200) : '';
  return { data: d };
}

module.exports = { normCode, validCode, amountFor, usable, check, reserveInTx, releaseForOrder, validate };
