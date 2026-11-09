const crypto = require('crypto');
const { getDb, sha256, jwtSecret } = require('./_utils');

// ── Dárkové poukazy ──
// Kód: 12 znaků z 31 snadno čitelných znaků (bez 0/O, 1/I/L), tj. asi 59 bitů náhody.
// V databázi je dokument pod OTISKEM kódu (sha256), takže kdo by viděl databázi, kód nezjistí.
// Celý kód je navíc zašifrovaný (AES-256-GCM) u objednávky, aby šel e-mail poslat znovu.

const VOUCHER_VALUES = [500, 1000, 1500, 2000];
const VALID_MONTHS = 12;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 znaků, každý jen jednou
const VOUCHER_ID_RE = /^voucher-(\d{3,5})$/;

const isVoucherId = id => VOUCHER_ID_RE.test(String(id));
function voucherValue(id) {
  const m = VOUCHER_ID_RE.exec(String(id));
  const v = m ? Number(m[1]) : 0;
  return VOUCHER_VALUES.includes(v) ? v : 0;
}
const voucherName = v => `Dárkový poukaz ${v.toLocaleString('cs-CZ')} Kč`;

function newCode() {
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s.match(/.{4}/g).join('-');
}
// Normalizace toho, co zákazník napíše (malá písmena, mezery, pomlčky)
function normCode(c) {
  const s = String(c || '').toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{12}$/.test(s) ? s : '';
}
const docId = norm => sha256('sagaart-voucher:' + norm).slice(0, 48);
const ref = norm => getDb().collection('vouchers').doc(docId(norm));

// Šifrování kódu pro případné znovuposlání e-mailu
const encKey = () => crypto.createHash('sha256').update('voucher-enc:' + jwtSecret()).digest();
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}
function decrypt(blob) {
  const [iv, tag, data] = String(blob).split('.').map(s => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

const toDate = v => (v && typeof v.toDate === 'function' ? v.toDate() : v instanceof Date ? v : null);

// Stav poukazu bez úprav (pro kontrolu v pokladně)
async function checkVoucher(code) {
  const norm = normCode(code);
  if (!norm) return { error: 'Kód poukazu má 12 znaků' };
  const snap = await ref(norm).get();
  return describe(snap);
}
function describe(snap) {
  if (!snap.exists) return { error: 'Tento kód neznám. Zkontrolujte ho prosím.' };
  const v = snap.data();
  const exp = toDate(v.expiresAt);
  if (v.disabled) return { error: 'Tento poukaz už neplatí.' };
  if (!exp || exp < new Date()) return { error: 'Platnost poukazu vypršela.' };
  if (!(v.balance > 0)) return { error: 'Poukaz je už vyčerpaný.' };
  return { ok: true, balance: v.balance, expiresAt: exp.toISOString() };
}

// V transakci objednávky: strhne z poukazu nejvýš maxAmount. Vrací { amount, docId, last4 } nebo { error }.
async function reserveInTx(tx, code, maxAmount, orderNumber) {
  const norm = normCode(code);
  if (!norm) return { error: 'Kód poukazu má 12 znaků' };
  const r = ref(norm);
  const snap = await tx.get(r);
  const st = describe(snap);
  if (st.error) return st;
  const amount = Math.min(st.balance, Math.max(0, maxAmount));
  if (amount <= 0) return { error: 'Poukazem nejde platit jiný poukaz.' };
  tx.update(r, {
    balance: st.balance - amount,
    uses: [...(snap.data().uses || []), { order: orderNumber, amount, at: new Date() }].slice(-50),
  });
  return { amount, docId: r.id, last4: norm.slice(-4) };
}

// Zrušená / propadlá objednávka: vrátí strženou částku zpět na poukaz (jen jednou).
async function releaseForOrder(orderNumber) {
  const db = getDb();
  const oRef = db.collection('orders').doc(orderNumber);
  await db.runTransaction(async tx => {
    const o = await tx.get(oRef);
    const v = o.exists ? o.data().voucher : null;
    if (!v || v.released || !(v.amount > 0)) return;
    const vRef = db.collection('vouchers').doc(v.docId);
    const vs = await tx.get(vRef);
    if (vs.exists) tx.update(vRef, { balance: (vs.data().balance || 0) + v.amount });
    tx.update(oRef, { 'voucher.released': true });
  });
}

// Zaplacená objednávka s poukazy: vytvoří kódy (jen jednou) a vrátí je pro e-mail.
async function issueForOrder(orderNumber) {
  const db = getDb();
  const oRef = db.collection('orders').doc(orderNumber);
  return db.runTransaction(async tx => {
    const snap = await tx.get(oRef);
    if (!snap.exists) return null;
    const o = snap.data();
    if (o.status !== 'paid' || o.vouchersIssued) return null;
    const values = [];
    (o.lines || []).forEach(l => { const v = voucherValue(l.id); for (let i = 0; i < (l.qty || 0) && v; i++) values.push(v); });
    if (!values.length) return null;

    const now = new Date();
    const expiresAt = new Date(now); expiresAt.setMonth(expiresAt.getMonth() + VALID_MONTHS);
    const issued = values.map(value => {
      const code = newCode();
      const norm = normCode(code);
      tx.create(ref(norm), {
        value, balance: value, orderNumber, createdAt: now, expiresAt,
        last4: norm.slice(-4), uses: [], disabled: false,
      });
      return { code, value, last4: norm.slice(-4) };
    });
    tx.update(oRef, {
      vouchersIssued: true,
      vouchers: issued.map(i => ({ value: i.value, last4: i.last4, enc: encrypt(i.code) })),
      voucherExpiresAt: expiresAt,
    });
    return { issued, expiresAt, email: o.customer?.email, name: o.customer?.jmeno };
  });
}

module.exports = {
  VOUCHER_VALUES, VALID_MONTHS, isVoucherId, voucherValue, voucherName, normCode,
  checkVoucher, reserveInTx, releaseForOrder, issueForOrder, decrypt,
};
