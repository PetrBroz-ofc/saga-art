const crypto = require('crypto');
const { promisify } = require('util');
const {
  getDb, sha256, safeEqual, noStore, clientIp, sleep, fail, guard, limitOrReject,
  adminDevice, readToken, trustedDevice, jwtSecret, DEVICE_COOKIE, CHALLENGE_COOKIE,
  setSessionCookie, clearSessionCookie, setDeviceCookie, clearDeviceCookie, setChallengeCookie, clearChallengeCookie,
} = require('./_utils');
const { sendEmail } = require('./_shop');

// Přihlášení do adminu:
//  1) jméno + heslo
//  2) na neznámém zařízení (nebo po 30 dnech) přijde na e-mail jednorázový kód na 10 minut
//  3) po zadání kódu je zařízení ověřené na 30 dní
//
// GET    /api/auth             – jsem přihlášená?
// GET    /api/auth?devices=1   – seznam ověřených zařízení (jen admin)
// POST   /api/auth             – {username, password} nebo {code}
// DELETE /api/auth             – odhlásit; {forget:true} zapomene i toto zařízení; {revoke:id} odebere zařízení

const scrypt = promisify(crypto.scrypt);
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const DEVICE_RE = /^[a-f0-9]{32}$/;

// ── Heslo: ADMIN_PASSWORD_HASH = "scrypt$<salt hex>$<hash hex>" (vygeneruje scripts/hash-password.js) ──
async function checkPassword(password) {
  const [algo, saltHex, hashHex] = String(process.env.ADMIN_PASSWORD_HASH || '').split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) throw new Error('ADMIN_PASSWORD_HASH není nastaven');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(String(password), Buffer.from(saltHex, 'hex'), expected.length,
    { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(actual, expected);
}
function checkUsername(username) {
  const expected = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  if (!expected) throw new Error('ADMIN_USERNAME není nastaven');
  return safeEqual(String(username).trim().toLowerCase(), expected);
}

// Kód se v databázi drží jen jako HMAC (kdo by četl databázi, kód nezjistí)
const codeHash = (cid, code) => crypto.createHmac('sha256', jwtSecret()).update(cid + ':' + code).digest('hex');

function adminEmail() {
  const e = process.env.ADMIN_EMAIL || process.env.OWNER_EMAIL;
  if (!e) throw new Error('ADMIN_EMAIL není nastaven');
  return e;
}
const maskEmail = e => {
  const [user, domain] = String(e).split('@');
  return (user[0] || '') + '•••' + (user.length > 1 ? user.slice(-1) : '') + '@' + domain;
};

// Krátký popis zařízení pro e-mail a seznam ("Chrome · Windows")
function deviceLabel(ua) {
  ua = String(ua || '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Prohlížeč';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'neznámý systém';
  return `${browser} · ${os}`;
}
const iso = v => (v?.toDate ? v.toDate().toISOString() : null);

async function failSlow(res, status, message, extra) {
  await sleep(400 + Math.random() * 400);
  noStore(res);
  return res.status(status).json({ error: message, ...extra });
}

// ── 1. krok: jméno + heslo ──
async function loginStep(req, res) {
  const ip = clientIp(req);
  if (!(await limitOrReject(res, 'login_ip', ip, 5, 15 * 60 * 1000))) return;
  if (!(await limitOrReject(res, 'login_all', 'global', 20, 60 * 60 * 1000))) return;

  const { username, password } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 100 || password.length > 200) {
    return failSlow(res, 401, 'Špatné jméno nebo heslo');
  }
  // heslo se ověřuje vždy (i při špatném jménu), aby odpověď netrvala jinak dlouho
  const passOk = await checkPassword(password);
  const userOk = checkUsername(username);
  if (!passOk || !userOk) {
    console.warn('Neúspěšné přihlášení do adminu', { ipHash: sha256(ip).slice(0, 12) });
    return failSlow(res, 401, 'Špatné jméno nebo heslo');
  }

  // Ověřené zařízení (do 30 dní) rovnou pustí dál
  const dev = readToken(req, DEVICE_COOKIE, 'device');
  if (dev && (await trustedDevice(dev.did))) {
    await getDb().collection('admin_devices').doc(dev.did).update({ lastUsedAt: new Date() });
    clearChallengeCookie(res);
    setSessionCookie(res, dev.did);
    return res.status(200).json({ ok: true });
  }

  // Jinak kód e-mailem. Nejvýš 8 e-mailů za hodinu (proti zahlcení schránky).
  if (!(await limitOrReject(res, 'login_mail', 'global', 8, 60 * 60 * 1000))) return;
  const cid = crypto.randomBytes(16).toString('hex');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const label = deviceLabel(req.headers['user-agent']);
  const now = Date.now();
  await getDb().collection('admin_challenges').doc(cid).set({
    codeHash: codeHash(cid, code), attempts: 0, label,
    ipHash: sha256(ip).slice(0, 16),
    createdAt: new Date(now), expiresAt: new Date(now + CODE_TTL_MS), expireAt: new Date(now + CODE_TTL_MS),
  });
  const email = adminEmail();
  try {
    await sendEmail(process.env.EMAILJS_TEMPLATE_LOGIN, {
      to_email: email,
      code,
      device: label,
      time: new Date(now).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' }),
      valid_minutes: '10',
    });
  } catch (e) {
    console.error('Kód pro přihlášení se nepodařilo odeslat:', e.message);
    await getDb().collection('admin_challenges').doc(cid).delete();
    return fail(res, 503, 'Kód se nepodařilo odeslat. Zkuste to prosím za chvíli.');
  }
  if (dev) clearDeviceCookie(res);
  setChallengeCookie(res, cid);
  return res.status(200).json({ needCode: true, email: maskEmail(email) });
}

// ── 2. krok: kód z e-mailu ──
async function codeStep(req, res) {
  const ip = clientIp(req);
  if (!(await limitOrReject(res, 'code_ip', ip, 10, 15 * 60 * 1000))) return;

  const code = String(req.body.code || '').replace(/\s/g, '');
  const ch = readToken(req, CHALLENGE_COOKIE, 'challenge');
  if (!ch) return failSlow(res, 401, 'Platnost kódu vypršela. Přihlaste se prosím znovu.', { restart: true });
  if (!/^\d{6}$/.test(code)) return failSlow(res, 401, 'Kód má 6 číslic.');

  const db = getDb();
  const ref = db.collection('admin_challenges').doc(ch.cid);
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { restart: true };
    const d = snap.data();
    if (d.expiresAt.toDate().getTime() < Date.now() || d.attempts >= MAX_CODE_ATTEMPTS) {
      tx.delete(ref);
      return { restart: true };
    }
    const ok = crypto.timingSafeEqual(Buffer.from(codeHash(ch.cid, code), 'hex'), Buffer.from(d.codeHash, 'hex'));
    if (!ok) {
      const left = MAX_CODE_ATTEMPTS - d.attempts - 1;
      if (left <= 0) tx.delete(ref); else tx.update(ref, { attempts: d.attempts + 1 });
      return left <= 0 ? { restart: true } : { left };
    }
    tx.delete(ref); // kód jde použít jen jednou
    return { ok: true, label: d.label };
  });

  if (result.restart) {
    clearChallengeCookie(res);
    return failSlow(res, 401, 'Kód už neplatí. Přihlaste se prosím znovu, pošleme nový.', { restart: true });
  }
  if (!result.ok) {
    console.warn('Špatný kód do adminu', { ipHash: sha256(ip).slice(0, 12) });
    return failSlow(res, 401, `Špatný kód. Zbývá ${result.left} ${result.left === 1 ? 'pokus' : 'pokusy'}.`);
  }

  const did = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  await db.collection('admin_devices').doc(did).set({
    label: result.label, createdAt: now, verifiedAt: now, lastUsedAt: now, ipHash: sha256(ip).slice(0, 16),
  });
  clearChallengeCookie(res);
  setDeviceCookie(res, did);
  setSessionCookie(res, did);
  return res.status(200).json({ ok: true });
}

// ── Seznam zařízení ──
async function listDevices(req, res, current) {
  const col = getDb().collection('admin_devices');
  const snap = await col.get();
  const limit = Date.now() - 30 * 864e5;
  const devices = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const verified = d.verifiedAt?.toDate?.().getTime() || 0;
    if (d.revoked || verified < limit) { await doc.ref.delete(); continue; } // propadlá zařízení uklidit
    devices.push({
      id: doc.id, label: d.label || 'Zařízení', current: doc.id === current,
      createdAt: iso(d.createdAt), lastUsedAt: iso(d.lastUsedAt),
      expiresAt: new Date(verified + 30 * 864e5).toISOString(),
    });
  }
  devices.sort((a, b) => (b.current - a.current) || String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)));
  return res.status(200).json({ devices });
}

export default async function handler(req, res) {
  noStore(res);
  if (!guard(req, res, ['GET', 'POST', 'DELETE'])) return;

  try {
    if (req.method === 'GET') {
      const current = await adminDevice(req);
      if (req.query?.devices) {
        if (!current) return fail(res, 401, 'Neautorizováno');
        return await listDevices(req, res, current);
      }
      return res.status(200).json({ authenticated: !!current });
    }

    if (req.method === 'DELETE') {
      const current = await adminDevice(req);
      const { revoke, forget } = req.body;
      if (revoke !== undefined) {
        if (!current) return fail(res, 401, 'Neautorizováno');
        if (typeof revoke !== 'string' || !DEVICE_RE.test(revoke)) return fail(res, 400, 'Neplatné zařízení');
        await getDb().collection('admin_devices').doc(revoke).delete();
        if (revoke !== current) return res.status(200).json({ ok: true });
      } else if (forget === true && current) {
        await getDb().collection('admin_devices').doc(current).delete();
      }
      clearSessionCookie(res);
      if (revoke !== undefined || forget === true) clearDeviceCookie(res);
      return res.status(200).json({ ok: true, loggedOut: true });
    }

    // POST
    return req.body.code !== undefined ? await codeStep(req, res) : await loginStep(req, res);
  } catch (e) {
    console.error('auth error:', e.message);
    return fail(res, 500, 'Přihlášení teď nefunguje. Zkuste to prosím později.');
  }
}
