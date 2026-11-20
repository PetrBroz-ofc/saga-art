'use strict';
// Recenze šperků. Veřejně se ukazují jen schválené. Psát je smí jen přihlášená zákaznice, která šperk koupila
// (účty zatím nejsou, viz _customer.js), do té doby je přidává majitelka ručně v administraci.
// Texty se vkládají do stránek vždy jen jako text (escapované), hvězdičky a průměr se počítají tady.

const crypto = require('crypto');
const { getDb } = require('./_utils');

const STATUSES = ['pending', 'approved', 'hidden'];
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const iso = v => (v && typeof v.toDate === 'function' ? v.toDate() : v instanceof Date ? v : null)?.toISOString() || null;

const clean = (v, max, multiline = false) => {
  if (typeof v !== 'string') return '';
  const re = multiline ? /[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g : /[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g;
  return v.normalize('NFC').replace(/\r\n?/g, '\n').replace(re, ' ').trim().slice(0, max);
};

// Kontrola recenze (z administrace i od zákaznice). Vrací { data } nebo { error }.
function validate(b) {
  if (!b || typeof b !== 'object') return { error: 'Chybí data' };
  const productId = String(b.productId || '');
  if (!ID_RE.test(productId)) return { error: 'Neplatný šperk' };
  const rating = b.rating;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: 'Hodnocení: 1 až 5 hvězdiček' };
  const name = clean(b.name, 40);
  if (name.length < 2) return { error: 'Napište prosím jméno (stačí křestní a začátek příjmení)' };
  const text = clean(b.text, 1000, true);
  if (text.length < 10) return { error: 'Recenze je moc krátká (aspoň 10 znaků)' };
  const title = clean(b.title, 80);
  return { data: { productId, rating, name, title, text } };
}

const publicReview = r => ({
  id: r.id, name: r.name, rating: r.rating, title: r.title || '', text: r.text,
  date: (iso(r.createdAt) || '').slice(0, 10), verified: r.verified === true,
});

function summarize(list) {
  if (!list.length) return { count: 0, avg: 0 };
  const avg = list.reduce((s, r) => s + r.rating, 0) / list.length;
  return { count: list.length, avg: Math.round(avg * 10) / 10 };
}

async function approvedFor(productId) {
  const snap = await getDb().collection('reviews').where('productId', '==', productId).where('status', '==', 'approved').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(iso(b.createdAt)).localeCompare(String(iso(a.createdAt))));
}

// průměry pro všechny šperky najednou (karty v nabídce)
async function summaries() {
  const snap = await getDb().collection('reviews').where('status', '==', 'approved').get();
  const by = {};
  snap.docs.forEach(d => { const r = d.data(); (by[r.productId] ||= []).push(r); });
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, summarize(v)]));
}

async function create(data, extra = {}) {
  const id = crypto.randomBytes(10).toString('hex');
  const doc = { ...data, status: 'pending', verified: false, source: 'customer', createdAt: new Date(), ...extra };
  await getDb().collection('reviews').doc(id).create(doc);
  return { id, ...doc };
}

module.exports = { STATUSES, ID_RE, clean, validate, publicReview, summarize, approvedFor, summaries, create, iso };
