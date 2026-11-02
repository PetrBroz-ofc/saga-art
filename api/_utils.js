const crypto = require('crypto');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const jwt = require('jsonwebtoken');

const SITE_URL = (process.env.SITE_URL || 'https://sagaart.cz').replace(/\/+$/, '');
const IS_PROD = process.env.VERCEL_ENV === 'production';

// Povolené originy: v produkci JEN vlastní doména, v preview i adresa deploymentu.
const ALLOWED_ORIGINS = new Set([SITE_URL]);
if (!IS_PROD) {
  ['VERCEL_URL', 'VERCEL_BRANCH_URL'].forEach(k => {
    if (process.env[k]) ALLOWED_ORIGINS.add('https://' + process.env[k]);
  });
  ['http://localhost:3000', 'http://127.0.0.1:3000'].forEach(o => ALLOWED_ORIGINS.add(o));
}

const SESSION_COOKIE = '__Host-sa_admin';
const SESSION_TTL_S = 2 * 60 * 60; // 2 hodiny

// ── Firestore ──
function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

// ── Obecné ──
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

// Na Vercelu nastavuje x-real-ip sama platforma — klient ji nepodvrhne.
function clientIp(req) {
  return String(req.headers['x-real-ip']
    || (req.headers['x-forwarded-for'] || '').split(',')[0]
    || req.socket?.remoteAddress || 'unknown').trim();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Jednotná odpověď na chybu — nikdy neprozradí detaily serveru.
function fail(res, status, message) {
  noStore(res);
  return res.status(status).json({ error: message });
}

// ── Ochrana requestů ──
// Povolí metodu, u zapisujících requestů vyžaduje vlastní Origin a JSON (= ochrana proti CSRF).
// Vrací true, pokud request smí pokračovat.
function guard(req, res, methods) {
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', methods.join(', '));
    res.status(204).end();
    return false;
  }
  if (!methods.includes(req.method)) {
    res.setHeader('Allow', methods.join(', '));
    fail(res, 405, 'Metoda není povolena');
    return false;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      fail(res, 403, 'Nepovolený původ požadavku');
      return false;
    }
    const ct = String(req.headers['content-type'] || '');
    if (!ct.startsWith('application/json')) {
      fail(res, 415, 'Očekávám JSON');
      return false;
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      fail(res, 400, 'Neplatná data');
      return false;
    }
  }
  return true;
}

// ── Rate limit sdílený napříč instancemi (Firestore) ──
// Fail-closed: když databáze neodpoví, request se odmítne.
async function rateLimit(bucket, key, max, windowMs) {
  const db = getDb();
  const ref = db.collection('rate_limits').doc(bucket + '_' + sha256(key).slice(0, 40));
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const d = snap.exists ? snap.data() : null;
    if (!d || d.resetAt <= now) {
      tx.set(ref, { count: 1, resetAt: now + windowMs, expireAt: new Date(now + windowMs) });
      return true;
    }
    if (d.count >= max) return false;
    tx.update(ref, { count: d.count + 1 });
    return true;
  });
}

// Pohodlný wrapper — vrací true, když se smí pokračovat; jinak už odpověděl.
async function limitOrReject(res, bucket, key, max, windowMs) {
  try {
    if (await rateLimit(bucket, key, max, windowMs)) return true;
    fail(res, 429, 'Příliš mnoho požadavků. Zkuste to prosím později.');
  } catch (e) {
    console.error('rateLimit error:', e.message);
    fail(res, 503, 'Služba je dočasně nedostupná');
  }
  return false;
}

// ── Admin session (JWT v HttpOnly cookie) ──
// Tři cookies, všechny HttpOnly; Secure; SameSite=Strict s prefixem __Host-:
//   sa_admin     – přihlášení (2 h)
//   sa_device    – ověřené zařízení (30 dní, pak je potřeba nový kód z e-mailu)
//   sa_challenge – rozpracované přihlášení čekající na kód (10 min)
const DEVICE_COOKIE = '__Host-sa_device';
const CHALLENGE_COOKIE = '__Host-sa_challenge';
const DEVICE_TTL_S = 30 * 24 * 60 * 60;
const CHALLENGE_TTL_S = 10 * 60;

function jwtSecret() {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('ADMIN_JWT_SECRET chybí nebo je kratší než 32 znaků');
  return secret;
}
const JWT_OPTS = { issuer: 'sagaart', audience: 'sagaart-admin' };
const sessionVersion = () => process.env.ADMIN_SESSION_VERSION || '1';

function signToken(typ, data, ttl) {
  return jwt.sign({ typ, sv: sessionVersion(), ...data }, jwtSecret(),
    { ...JWT_OPTS, algorithm: 'HS256', expiresIn: ttl, jwtid: crypto.randomUUID() });
}
// Vrací obsah tokenu daného typu, nebo null (špatný podpis, vypršel, jiná verze, jiný typ)
function readToken(req, name, typ) {
  const token = readCookie(req, name);
  if (!token) return null;
  try {
    const p = jwt.verify(token, jwtSecret(), { ...JWT_OPTS, algorithms: ['HS256'] });
    return p.typ === typ && p.sv === sessionVersion() ? p : null;
  } catch {
    return null;
  }
}

// Více Set-Cookie v jedné odpovědi: hlavičky se přidávají, ne přepisují
function addCookie(res, name, value, maxAge) {
  const prev = res.getHeader('Set-Cookie');
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : [];
  list.push(`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`);
  res.setHeader('Set-Cookie', list);
}

function setSessionCookie(res, deviceId) {
  addCookie(res, SESSION_COOKIE, signToken('session', { role: 'admin', did: deviceId }, SESSION_TTL_S), SESSION_TTL_S);
}
function clearSessionCookie(res) { addCookie(res, SESSION_COOKIE, '', 0); }
function setDeviceCookie(res, deviceId) {
  addCookie(res, DEVICE_COOKIE, signToken('device', { did: deviceId }, DEVICE_TTL_S), DEVICE_TTL_S);
}
function clearDeviceCookie(res) { addCookie(res, DEVICE_COOKIE, '', 0); }
function setChallengeCookie(res, challengeId) {
  addCookie(res, CHALLENGE_COOKIE, signToken('challenge', { cid: challengeId }, CHALLENGE_TTL_S), CHALLENGE_TTL_S);
}
function clearChallengeCookie(res) { addCookie(res, CHALLENGE_COOKIE, '', 0); }

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// Zařízení platí, jen když je v databázi, není odebrané a ověření není starší než 30 dní.
async function trustedDevice(deviceId) {
  if (typeof deviceId !== 'string' || !/^[a-f0-9]{32}$/.test(deviceId)) return null;
  const snap = await getDb().collection('admin_devices').doc(deviceId).get();
  if (!snap.exists) return null;
  const d = snap.data();
  const verified = d.verifiedAt?.toDate ? d.verifiedAt.toDate().getTime() : 0;
  if (d.revoked || Date.now() - verified > DEVICE_TTL_S * 1000) return null;
  return { id: deviceId, ...d };
}

// Vrací id zařízení přihlášeného admina, nebo null. Každý požadavek ověří i zařízení v databázi,
// takže odebrané zařízení se odhlásí okamžitě.
async function adminDevice(req) {
  const p = readToken(req, SESSION_COOKIE, 'session');
  if (!p || p.role !== 'admin') return null;
  try {
    return (await trustedDevice(p.did)) ? p.did : null;
  } catch (e) {
    console.error('device check error:', e.message);
    return null; // fail-closed
  }
}
const isAdmin = async req => (await adminDevice(req)) !== null;

// guard() + ověření admina. Vrací true, když smí pokračovat.
async function requireAdmin(req, res, methods) {
  noStore(res);
  if (!guard(req, res, methods)) return false;
  if (!(await isAdmin(req))) {
    fail(res, 401, 'Neautorizováno');
    return false;
  }
  return true;
}

module.exports = {
  SITE_URL, IS_PROD, getDb, sha256, safeEqual, noStore, clientIp, sleep, fail,
  guard, rateLimit, limitOrReject, isAdmin, adminDevice, requireAdmin, readToken, trustedDevice,
  DEVICE_COOKIE, CHALLENGE_COOKIE, DEVICE_TTL_S, jwtSecret,
  setSessionCookie, clearSessionCookie, setDeviceCookie, clearDeviceCookie, setChallengeCookie, clearChallengeCookie,
};
