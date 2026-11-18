// Účty do administrace.
//  - "owner": hlavní účet ze Vercelu (ADMIN_USERNAME + ADMIN_PASSWORD_HASH + ADMIN_EMAIL). Patří vývojáři a funguje vždy.
//  - "client": účet majitelky v databázi (jméno, e-mail pro kódy, scrypt otisk hesla). Heslo si mění sama,
//    hlavní účet ho smí nastavit nebo obnovit i bez znalosti starého hesla.
const crypto = require('crypto');
const { promisify } = require('util');
const { getDb, safeEqual } = require('./_utils');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._@-]{2,39}$/;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}$/;
const MIN_PASSWORD = 14;
const MAX_PASSWORD = 200;

const norm = s => String(s).trim().toLowerCase();

// ── hlavní účet (Vercel) ──
// Heslo hlavního účtu jde zadat dvěma způsoby (stačí jeden):
//  - ADMIN_PASSWORD       = heslo napsané přímo ve Vercelu (jako Sensitive), mění se úpravou proměnné + Redeploy
//  - ADMIN_PASSWORD_HASH  = scrypt otisk ("scrypt$…", vytvoří ho npm run hash-password)
// Když jsou obě, platí ADMIN_PASSWORD.
const MIN_OWNER_PASSWORD = 10;
async function ownerPasswordOk(password) {
  const plain = process.env.ADMIN_PASSWORD;
  if (plain) {
    if (plain.length < MIN_OWNER_PASSWORD) throw new Error(`ADMIN_PASSWORD je kratší než ${MIN_OWNER_PASSWORD} znaků`);
    return safeEqual(String(password), plain); // porovnání přes SHA-256 obou stran, stejně dlouhé
  }
  const [algo, saltHex, hashHex] = String(process.env.ADMIN_PASSWORD_HASH || '').split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) throw new Error('Není nastaveno ADMIN_PASSWORD ani ADMIN_PASSWORD_HASH');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(String(password), Buffer.from(saltHex, 'hex'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}
function ownerUsernameOk(username) {
  const expected = norm(process.env.ADMIN_USERNAME || '');
  if (!expected) throw new Error('ADMIN_USERNAME není nastaven');
  return safeEqual(norm(username), expected);
}
function ownerEmail() {
  const e = process.env.ADMIN_EMAIL || process.env.OWNER_EMAIL;
  if (!e) throw new Error('ADMIN_EMAIL není nastaven');
  return e;
}

// ── účet majitelky (databáze) ──
const accountRef = () => getDb().collection('settings').doc('client_account');

async function getClientAccount() {
  const snap = await accountRef().get();
  const d = snap.exists ? snap.data() : null;
  return d && typeof d.salt === 'string' && typeof d.hash === 'string' && typeof d.username === 'string' ? d : null;
}

// Vrací účet, když jméno i heslo sedí, jinak null. Heslo se počítá vždy (i když účet není),
// aby doba odpovědi neprozradila, jestli jméno existuje.
async function clientLogin(username, password) {
  let acc = null;
  try { acc = await getClientAccount(); } catch (e) { console.error('client account read:', e.message); }
  const salt = acc ? Buffer.from(acc.salt, 'hex') : Buffer.alloc(16);
  const actual = await scrypt(String(password), salt, 64, SCRYPT);
  if (!acc) return null;
  const expected = Buffer.from(acc.hash, 'hex');
  const passOk = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  const nameOk = safeEqual(norm(username), norm(acc.username));
  return passOk && nameOk ? acc : null;
}

function validatePassword(p) {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) return `Heslo musí mít aspoň ${MIN_PASSWORD} znaků. Nejlepší je věta nebo heslo ze správce hesel.`;
  if (p.length > MAX_PASSWORD) return 'Heslo je moc dlouhé.';
  if (new Set(p).size < 6) return 'Heslo má málo různých znaků. Zvolte prosím jiné.';
  return '';
}
const validUsername = u => typeof u === 'string' && USERNAME_RE.test(u.trim());
const validEmail = e => typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e.trim());

async function setClientAccount({ username, email, password }) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  await accountRef().set({
    username: username.trim(), email: email.trim().toLowerCase(),
    salt: salt.toString('hex'), hash: hash.toString('hex'), changedAt: new Date(),
  });
}

// Odebere ověřená zařízení daného účtu (kromě jednoho). Odebrané zařízení se odhlásí okamžitě.
async function revokeDevices(who, exceptDid) {
  const col = getDb().collection('admin_devices');
  const snap = await col.get();
  for (const doc of snap.docs) {
    if ((doc.data().who === 'client' ? 'client' : 'owner') === who && doc.id !== exceptDid) await doc.ref.delete();
  }
}

module.exports = {
  MIN_PASSWORD, ownerPasswordOk, ownerUsernameOk, ownerEmail,
  getClientAccount, clientLogin, setClientAccount, revokeDevices, validatePassword, validUsername, validEmail, norm,
};
