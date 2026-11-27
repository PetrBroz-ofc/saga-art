'use strict';
// Recenze obchodu (celkové, ne u jednotlivých šperků). Napsat ji může kdokoli, veřejně se ukáže až po schválení v administraci (ochrana proti spamu).
// Neověřuje se, že autor šperk koupil. „Ověřený nákup“ může označit jen majitelka.
// Texty se vkládají do stránek vždy jen jako text (escapované), hvězdičky a průměr se počítají tady.

const crypto = require('crypto');
const { getDb } = require('./_utils');

const STATUSES = ['pending', 'approved', 'hidden'];
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PHOTO_RE = /^\/media\/[a-f0-9]{24}\.(?:jpg|png|webp)$/;
const MAX_PHOTOS = 3;
const iso = v => (v && typeof v.toDate === 'function' ? v.toDate() : v instanceof Date ? v : null)?.toISOString() || null;

const clean = (v, max, multiline = false) => {
  if (typeof v !== 'string') return '';
  const re = multiline ? /[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g : /[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g;
  return v.normalize('NFC').replace(/\r\n?/g, '\n').replace(re, ' ').trim().slice(0, max);
};

// Kontrola recenze (z administrace i od zákaznice). Vrací { data } nebo { error }.
// Fotky jsou jen adresy /media/<název> z vlastního úložiště (existenci ověřuje photosExist).
function validate(b) {
  if (!b || typeof b !== 'object') return { error: 'Chybí data' };
  const rating = b.rating;
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) return { error: 'Hodnocení: 0 až 5 hvězdiček' };
  const name = clean(b.name, 40);
  if (name.length < 2) return { error: 'Napište prosím jméno (stačí křestní a začátek příjmení)' };
  const text = clean(b.text, 1000, true);
  if (text.length < 10) return { error: 'Recenze je moc krátká (aspoň 10 znaků)' };
  const title = clean(b.title, 80);
  const rawPhotos = b.photos === undefined || b.photos === null ? [] : b.photos;
  if (!Array.isArray(rawPhotos) || rawPhotos.length > MAX_PHOTOS) return { error: 'Fotky: nejvýš ' + MAX_PHOTOS };
  const photos = [];
  for (const u of rawPhotos) {
    if (typeof u !== 'string' || !PHOTO_RE.test(u)) return { error: 'Fotka se nepodařila načíst, nahrajte ji prosím znovu' };
    if (!photos.includes(u)) photos.push(u);
  }
  return { data: { rating, name, title, text, photos } };
}

// Ověří, že všechny fotky opravdu leží v úložišti (a u zákaznic, že je nahrála přes formulář recenze).
async function photosExist(photos, { onlyReview = false } = {}) {
  for (const u of photos) {
    const snap = await getDb().collection('media').doc(u.slice(7, 31)).get();
    if (!snap.exists) return false;
    if (onlyReview && snap.data().source !== 'review') return false;
  }
  return true;
}

// Smaže fotky recenze z úložiště (jen ty nahrané zákaznicemi, adminské fotky mohou být použité jinde).
async function dropPhotos(photos) {
  for (const u of photos || []) {
    if (typeof u !== 'string' || !PHOTO_RE.test(u)) continue;
    const ref = getDb().collection('media').doc(u.slice(7, 31));
    const snap = await ref.get();
    if (snap.exists && snap.data().source === 'review') await ref.delete();
  }
}

const publicReview = r => ({
  id: r.id, name: r.name, rating: r.rating, title: r.title || '', text: r.text,
  date: (iso(r.createdAt) || '').slice(0, 10), verified: r.verified === true,
  photos: Array.isArray(r.photos) ? r.photos.filter(u => PHOTO_RE.test(u)) : [],
});

function summarize(list) {
  if (!list.length) return { count: 0, avg: 0 };
  const avg = list.reduce((s, r) => s + r.rating, 0) / list.length;
  return { count: list.length, avg: Math.round(avg * 10) / 10 };
}

// Všechny schválené recenze, nejnovější první.
async function approvedAll() {
  const snap = await getDb().collection('reviews').where('status', '==', 'approved').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(iso(b.createdAt)).localeCompare(String(iso(a.createdAt))));
}

async function create(data, extra = {}) {
  const id = crypto.randomBytes(10).toString('hex');
  const doc = { ...data, status: 'pending', verified: false, source: 'customer', createdAt: new Date(), ...extra };
  await getDb().collection('reviews').doc(id).create(doc);
  return { id, ...doc };
}

// Odkazy a internetové adresy do recenze nepatří, bývá to spam.
const SPAM_RE = /(https?:|www\.|\[\/?url|<\s*a\s|[a-z0-9-]{2,}\.(?:com|net|org|info|ru|cn|xyz|top|shop|online|site|biz|click|link|io|cz|sk|de|eu)\b)/i;
const looksSpam = d => [d.name, d.title, d.text].some(t => SPAM_RE.test(t || ''));

module.exports = { looksSpam, STATUSES, ID_RE, PHOTO_RE, MAX_PHOTOS, clean, validate, photosExist, dropPhotos, publicReview, summarize, approvedAll, create, iso };
