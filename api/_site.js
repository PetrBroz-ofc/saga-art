'use strict';
// Nastavení vzhledu a textů webu (barvy, písma, texty, odkazy). Ukládá se do databáze (settings/site).
// Nic z toho se nikdy nevkládá do stránky jako HTML ani skript: barvy jsou jen #rrggbb, písma jen z pevného
// seznamu, texty se na webu vkládají jako obyčejný text, odkazy jen https nebo mailto.

const { getDb } = require('./_db');

// Písma z Google Fonts (CSP je povoluje). [popisek, druh, rodina pro CSS, zápis do adresy Google Fonts]
const FONTS = {
  newsreader:  ['Newsreader', 'serif', "'Newsreader', Georgia, 'Times New Roman', serif", 'Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400'],
  cormorant:   ['Cormorant Garamond', 'serif', "'Cormorant Garamond', Georgia, serif", 'Cormorant+Garamond:ital,wght@0,400;0,500;1,400'],
  playfair:    ['Playfair Display', 'serif', "'Playfair Display', Georgia, serif", 'Playfair+Display:ital,wght@0,400;0,500;1,400'],
  lora:        ['Lora', 'serif', "'Lora', Georgia, serif", 'Lora:ital,wght@0,400;0,500;1,400'],
  ebgaramond:  ['EB Garamond', 'serif', "'EB Garamond', Georgia, serif", 'EB+Garamond:ital,wght@0,400;0,500;1,400'],
  dmserif:     ['DM Serif Display', 'serif', "'DM Serif Display', Georgia, serif", 'DM+Serif+Display:ital@0;1'],
  baskerville: ['Libre Baskerville', 'serif', "'Libre Baskerville', Georgia, serif", 'Libre+Baskerville:ital,wght@0,400;1,400'],
  fraunces:    ['Fraunces', 'serif', "'Fraunces', Georgia, serif", 'Fraunces:ital,opsz,wght@0,9..144,400;1,9..144,400'],
  marcellus:   ['Marcellus', 'serif', "'Marcellus', Georgia, serif", 'Marcellus'],
  instrument:  ['Instrument Sans', 'sans', "'Instrument Sans', system-ui, -apple-system, 'Segoe UI', sans-serif", 'Instrument+Sans:wght@400;500'],
  inter:       ['Inter', 'sans', "'Inter', system-ui, sans-serif", 'Inter:wght@400;500;600'],
  dmsans:      ['DM Sans', 'sans', "'DM Sans', system-ui, sans-serif", 'DM+Sans:wght@400;500;600'],
  manrope:     ['Manrope', 'sans', "'Manrope', system-ui, sans-serif", 'Manrope:wght@400;500;600'],
  poppins:     ['Poppins', 'sans', "'Poppins', system-ui, sans-serif", 'Poppins:wght@400;500;600'],
  montserrat:  ['Montserrat', 'sans', "'Montserrat', system-ui, sans-serif", 'Montserrat:wght@400;500;600'],
  raleway:     ['Raleway', 'sans', "'Raleway', system-ui, sans-serif", 'Raleway:wght@400;500;600'],
  worksans:    ['Work Sans', 'sans', "'Work Sans', system-ui, sans-serif", 'Work+Sans:wght@400;500;600'],
  nunito:      ['Nunito Sans', 'sans', "'Nunito Sans', system-ui, sans-serif", 'Nunito+Sans:wght@400;500;600'],
  jost:        ['Jost', 'sans', "'Jost', system-ui, sans-serif", 'Jost:wght@400;500;600'],
  lato:        ['Lato', 'sans', "'Lato', system-ui, sans-serif", 'Lato:wght@400;700'],
  opensans:    ['Open Sans', 'sans', "'Open Sans', system-ui, sans-serif", 'Open+Sans:wght@400;500;600'],
  sourcesans:  ['Source Sans 3', 'sans', "'Source Sans 3', system-ui, sans-serif", 'Source+Sans+3:wght@400;500;600'],
};

// Barvy: výchozí hodnoty odpovídají současnému vzhledu (css/shop.css)
const COLOR_KEYS = ['bg', 'paper', 'ink', 'ink2', 'accent', 'accentDark', 'pink', 'sea', 'lilac', 'line'];
const DEFAULT_THEME = {
  colors: { bg: '#f8f7fb', paper: '#fefdff', ink: '#3e3a52', ink2: '#5b566e', accent: '#83639f', accentDark: '#6a5089', pink: '#f8e9ef', sea: '#e6f2f1', lilac: '#efe9f7', line: '#e0dbe9' },
  fonts: { heading: 'newsreader', body: 'instrument' },
  radius: 3,
  scale: 100,
};
const LINK_KEYS = ['instagram', 'facebook', 'announce'];
const SECTION_IDS = ['about', 'materials', 'quote', 'collections', 'gallery', 'products', 'shipping', 'vouchers', 'custom', 'newsletter'];
const LOCKED_SECTIONS = ['products']; // bez nabídky šperků by e-shop nedával smysl
const IMG_RE = /^(https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]{2,60}\/image\/upload\/[^\s"'<>]{1,300}|\/media\/[a-f0-9]{24}\.(?:jpg|png|webp))$/;
const MAX_IMAGES = 40;
const MAX_TEXTS = 150;
const HISTORY = 10;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}$/;

const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// Odstraní řídicí a neviditelné znaky, ořízne délku.
function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  return v.normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function cleanUrl(v, { allowAnchor = false } = {}) {
  const s = cleanText(v, 300);
  if (!s) return '';
  if (allowAnchor && /^#[A-Za-z0-9_-]{1,60}$/.test(s)) return s;
  if (/\s/.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && u.hostname.includes('.') && !u.username && !u.password ? u.toString() : null;
  } catch { return null; }
}

// Zkontroluje a očistí celé nastavení. Vrací { data } nebo { error }.
function validate(b) {
  if (!b || typeof b !== 'object') return { error: 'Chybí data' };
  const t = b.theme || {};

  const colors = {};
  for (const k of COLOR_KEYS) {
    const v = t.colors?.[k];
    if (v === undefined || v === null || v === '') { colors[k] = DEFAULT_THEME.colors[k]; continue; }
    if (typeof v !== 'string' || !HEX_RE.test(v)) return { error: 'Barva musí být ve tvaru #rrggbb' };
    colors[k] = v.toLowerCase();
  }
  if (contrast(colors.ink, colors.bg) < 4.5 || contrast(colors.ink, colors.paper) < 4.5) {
    return { error: 'Text na pozadí by byl špatně čitelný. Zvolte tmavší text nebo světlejší pozadí.' };
  }
  if (contrast(colors.ink2, colors.bg) < 3) return { error: 'Jemný text na pozadí by byl špatně čitelný.' };
  if (contrast(colors.accent, colors.bg) < 2.2) return { error: 'Hlavní barva je na pozadí skoro neviditelná.' };

  const fonts = {
    heading: Object.prototype.hasOwnProperty.call(FONTS, t.fonts?.heading) ? t.fonts.heading : DEFAULT_THEME.fonts.heading,
    body: Object.prototype.hasOwnProperty.call(FONTS, t.fonts?.body) ? t.fonts.body : DEFAULT_THEME.fonts.body,
  };
  const radius = Number.isInteger(t.radius) && t.radius >= 0 && t.radius <= 28 ? t.radius : DEFAULT_THEME.radius;
  const scale = Number.isInteger(t.scale) && t.scale >= 90 && t.scale <= 115 ? t.scale : DEFAULT_THEME.scale;

  const texts = {};
  const rawTexts = b.texts && typeof b.texts === 'object' ? b.texts : {};
  for (const [k, v] of Object.entries(rawTexts)) {
    if (!KEY_RE.test(k)) return { error: 'Neplatný klíč textu' };
    const s = cleanText(v, 600);
    if (s) texts[k] = s;
  }
  if (Object.keys(texts).length > MAX_TEXTS) return { error: 'Příliš mnoho upravených textů' };

  const links = {};
  const rawLinks = b.links && typeof b.links === 'object' ? b.links : {};
  for (const k of LINK_KEYS) {
    if (!rawLinks[k]) continue;
    const u = cleanUrl(rawLinks[k], { allowAnchor: k === 'announce' });
    if (u === null) return { error: 'Odkaz musí začínat https:// (např. https://www.instagram.com/…)' };
    if (u) links[k] = u;
  }
  if (rawLinks.email) {
    const e = cleanText(rawLinks.email, 254).toLowerCase();
    if (!EMAIL_RE.test(e)) return { error: 'Neplatný kontaktní e-mail' };
    links.email = e;
  }

  const flags = { announce: b.flags?.announce === true };

  // fotky: jen nahrané přes administraci (/media) nebo z Cloudinary (jiné adresy CSP stejně nepustí)
  const images = {};
  const rawImages = b.images && typeof b.images === 'object' ? b.images : {};
  for (const [k, v] of Object.entries(rawImages)) {
    if (!v) continue;
    if (!KEY_RE.test(k)) return { error: 'Neplatný klíč fotky' };
    if (typeof v !== 'string' || !IMG_RE.test(v)) return { error: 'Fotka musí být nahraná přes administraci' };
    images[k] = v;
  }
  if (Object.keys(images).length > MAX_IMAGES) return { error: 'Příliš mnoho upravených fotek' };

  // pořadí a viditelnost sekcí
  let sections = [];
  if (Array.isArray(b.sections)) {
    const seen = new Set();
    for (const x of b.sections) {
      if (!x || !SECTION_IDS.includes(x.id)) return { error: 'Neznámá sekce' };
      if (seen.has(x.id)) continue;
      seen.add(x.id);
      sections.push({ id: x.id, show: LOCKED_SECTIONS.includes(x.id) ? true : x.show !== false });
    }
  }

  const rawSeo = b.seo && typeof b.seo === 'object' ? b.seo : {};
  const oneLine = t => cleanText(t, 200).split('\n').join(' ');
  const seo = { title: oneLine(rawSeo.title).slice(0, 70), description: oneLine(rawSeo.description) };
  if (!seo.title) delete seo.title;
  if (!seo.description) delete seo.description;

  // měření návštěvnosti: jen samotná ID v přesném tvaru (nikdy kód ani adresa)
  const tracking = {};
  const gaId = cleanText(b.tracking?.gaId, 30).toUpperCase();
  const metaPixel = cleanText(b.tracking?.metaPixel, 30);
  if (gaId) {
    if (!/^G-[A-Z0-9]{4,16}$/.test(gaId)) return { error: 'ID Google Analytics má tvar G-AB12CD34EF' };
    tracking.gaId = gaId;
  }
  if (metaPixel) {
    if (!/^\d{10,20}$/.test(metaPixel)) return { error: 'ID Meta Pixelu jsou jen číslice' };
    tracking.metaPixel = metaPixel;
  }

  return { data: { theme: { colors, fonts, radius, scale }, texts, links, flags, images, sections, seo, tracking } };
}

const fontsUrl = fonts => {
  const keys = [...new Set([fonts.heading, fonts.body])];
  return 'https://fonts.googleapis.com/css2?' + keys.map(k => 'family=' + FONTS[k][3]).join('&') + '&display=swap';
};

// Co dostane veřejný web (jen pro čtení): hotová pravidla pro písma a vše, co je upravené.
function publicView(doc) {
  if (!doc || !doc.theme) return {};
  const f = doc.theme.fonts || DEFAULT_THEME.fonts;
  return {
    theme: { colors: doc.theme.colors, radius: doc.theme.radius, scale: doc.theme.scale,
      fonts: { heading: FONTS[f.heading][2], body: FONTS[f.body][2] }, fontsUrl: fontsUrl(f) },
    texts: doc.texts || {}, links: doc.links || {}, flags: doc.flags || {},
    images: doc.images || {}, sections: doc.sections || [], seo: doc.seo || {}, tracking: doc.tracking || {},
  };
}

async function load() {
  const s = await getDb().collection('settings').doc('site').get();
  return s.exists ? s.data() : null;
}

module.exports = { SECTION_IDS, LOCKED_SECTIONS, FONTS, COLOR_KEYS, DEFAULT_THEME, HISTORY, validate, publicView, load, contrast, cleanText };
