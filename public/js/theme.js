'use strict';
// Sága Art: vzhled a texty z administrace (Vzhled). Načítá se v <head>, aby se barvy a písma uplatnily dřív,
// než se stránka vykreslí. Do stránky se nikdy nevkládá HTML ani skript, jen CSS proměnné a obyčejný text.
// Nastavení: GET /api/site (a kopie v localStorage, ať se nic nezablikne). Náhled v administraci:
// stránka v rámu (?preview=1) poslouchá zprávy jen od vlastní domény.

(() => {
  const root = document.documentElement;
  const PREVIEW = /(^|[?&])preview=1(&|$)/.test(location.search);
  const CACHE = 'sa_site';
  const HEX = /^#[0-9a-f]{6}$/i;
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v * t + y[i] * (1 - t))); };
  const lum = h => rgb(h).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  const VARS = ['--bg', '--paper', '--ink', '--ink-2', '--ink-3', '--accent', '--accent-dk', '--pink', '--organza', '--sea', '--sand', '--lilac',
    '--line', '--dusty-rose', '--on-accent', '--serif', '--sans', '--radius', '--fs'];

  function applyTheme(t) {
    if (!t || !t.colors) { VARS.forEach(v => root.style.removeProperty(v)); return; }
    const c = t.colors;
    if (!Object.values(c).every(v => typeof v === 'string' && HEX.test(v))) return;
    const set = (k, v) => root.style.setProperty(k, v);
    set('--bg', c.bg); set('--paper', c.paper); set('--ink', c.ink); set('--ink-2', c.ink2); set('--ink-3', mix(c.ink2, c.bg, 0.85));
    set('--accent', c.accent); set('--accent-dk', c.accentDark);
    set('--pink', c.pink); set('--organza', c.pink); set('--sea', c.sea); set('--sand', c.sea); set('--lilac', c.lilac);
    set('--line', c.line); set('--dusty-rose', mix(c.accent, c.bg, 0.35));
    // text na tlačítkách: bílý, nebo tmavý podle toho, co je na hlavní barvě čitelnější
    set('--on-accent', ratio('#ffffff', c.accentDark) >= ratio(c.ink, c.accentDark) ? '#ffffff' : c.ink);
    if (t.fonts?.heading) set('--serif', t.fonts.heading);
    if (t.fonts?.body) set('--sans', t.fonts.body);
    if (Number.isInteger(t.radius) && t.radius >= 0 && t.radius <= 28) set('--radius', t.radius + 'px');
    if (Number.isInteger(t.scale) && t.scale >= 90 && t.scale <= 115) set('--fs', String(t.scale / 100));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', c.bg);
    if (typeof t.fontsUrl === 'string' && /^https:\/\/fonts\.googleapis\.com\/css2\?/.test(t.fontsUrl)) {
      let l = document.getElementById('sa-fonts');
      if (!l) { l = document.createElement('link'); l.id = 'sa-fonts'; l.rel = 'stylesheet'; document.head.appendChild(l); }
      if (l.getAttribute('href') !== t.fontsUrl) l.setAttribute('href', t.fontsUrl);
    }
  }

  // Jednopísmenné předložky nechceme na konci řádku
  const nbsp = s => s.replace(/(^|[\s(„])([KkSsVvZzOoUuAaIi])\s+(?=\S)/g, '$1$2 ');

  function setText(el, text) {
    if (el.hasAttribute('data-cms-multiline')) {
      el.textContent = '';
      text.split('\n').forEach((line, i) => { if (i) el.appendChild(document.createElement('br')); el.appendChild(document.createTextNode(line)); });
    } else {
      el.textContent = text;
    }
  }
  const snapshot = el => (el.__cmsDef !== undefined ? el.__cmsDef : (el.__cmsDef = el.hasAttribute('data-cms-multiline')
    ? [...el.childNodes].map(n => (n.nodeName === 'BR' ? '\n' : n.textContent)).join('') : el.textContent));

  function applyContent(s) {
    const texts = (s && s.texts) || {}, links = (s && s.links) || {}, flags = (s && s.flags) || {};
    document.querySelectorAll('[data-cms]').forEach(el => {
      const key = el.getAttribute('data-cms');
      const def = snapshot(el);
      const v = typeof texts[key] === 'string' ? texts[key] : null;
      if (key === 'announce-text') { setText(el, v ? nbsp(v) : ''); return; }
      // bez úpravy se text nechá být (jsou v něm třeba čísla, která doplňuje obchod); vrací se jen po zrušení úpravy
      if (v !== null) { setText(el, nbsp(v)); el.__cmsChanged = true; }
      else if (el.__cmsChanged) { setText(el, def); el.__cmsChanged = false; }
    });
    const url = u => (typeof u === 'string' && (/^https:\/\//.test(u) || /^#[\w-]{1,60}$/.test(u)) ? u : '');
    document.querySelectorAll('[data-cms-link]').forEach(a => {
      const key = a.getAttribute('data-cms-link');
      if (a.__cmsHref === undefined) a.__cmsHref = a.getAttribute('href') || '';
      const u = url(links[key]);
      const href = u || a.__cmsHref;
      if (key === 'announce') return;
      a.setAttribute('href', href);
      const li = a.closest('li');
      const empty = !href || href === '#';
      if (li) li.hidden = empty; else a.hidden = empty;
    });
    const email = typeof links.email === 'string' && /^[^\s@<>"]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}$/.test(links.email) ? links.email : '';
    document.querySelectorAll('[data-cms-email]').forEach(a => {
      if (a.__cmsHref === undefined) { a.__cmsHref = a.getAttribute('href') || ''; a.__cmsText = a.textContent; }
      const q = a.__cmsHref.includes('?') ? a.__cmsHref.slice(a.__cmsHref.indexOf('?')) : '';
      a.setAttribute('href', email ? 'mailto:' + email + q : a.__cmsHref);
      if (a.hasAttribute('data-cms-email-text')) a.textContent = email || a.__cmsText;
    });
    // Blok Akce: ukáže se, jen když je zapnutý a je v něm aspoň nějaký text. Prázdné karty se schovají.
    const promo = document.getElementById('akce');
    if (promo) {
      const filled = el => !!el.textContent.trim();
      promo.querySelectorAll('[data-promo-card]').forEach(c => { c.hidden = ![...c.querySelectorAll('[data-cms]')].some(filled); });
      const btn = promo.querySelector('[data-cms-link="promo"]');
      if (btn && !filled(btn)) btn.hidden = true;
      promo.hidden = !(flags.promo === true && [...promo.querySelectorAll('[data-cms]')].some(filled));
    }
    const bar = document.getElementById('announce');
    if (bar) {
      const on = flags.announce === true && !!texts['announce-text'];
      bar.hidden = !on;
      const a = bar.querySelector('a');
      const u = url(links.announce);
      if (a) {
        if (u) { a.setAttribute('href', u); a.style.textDecoration = ''; } else { a.removeAttribute('href'); a.style.textDecoration = 'none'; a.style.cursor = 'default'; }
      }
    }
  }

  // ── Fotky, logo, ikona, SEO ──
  const CLD = /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]{2,60}\/image\/upload\/[^\s"'<>]{1,300}$/;
  const MEDIA = /^\/media\/[a-f0-9]{24}\.(jpg|png|webp)$/;
  const optimize = (u, t) => (typeof u === 'string' && CLD.test(u) ? u.replace('/image/upload/', '/image/upload/' + t + '/') : (typeof u === 'string' && MEDIA.test(u) ? u : ''));

  function applyImages(s) {
    const imgs = (s && s.images) || {};
    document.querySelectorAll('[data-cms-img]').forEach(el => {
      if (el.__cmsSrc === undefined) el.__cmsSrc = el.getAttribute('src') || '';
      const u = optimize(imgs[el.getAttribute('data-cms-img')], 'f_auto,q_auto,w_1400');
      const want = u || el.__cmsSrc;
      if (el.getAttribute('src') !== want) el.setAttribute('src', want);
    });
    document.querySelectorAll('[data-cms-logo]').forEach(a => {
      if (a.__cmsLogo === undefined) a.__cmsLogo = a.innerHTML;
      const u = optimize(imgs.logo, 'f_auto,q_auto,h_160');
      if (u) {
        if (!a.querySelector('img')) {
          a.textContent = '';
          const i = document.createElement('img'); i.className = 'nav-logo-img'; i.alt = 'Sága Art'; i.decoding = 'async';
          a.appendChild(i);
        }
        const i = a.querySelector('img'); if (i.getAttribute('src') !== u) i.setAttribute('src', u);
      } else if (a.querySelector('img')) a.innerHTML = a.__cmsLogo;
    });
    const fav = optimize(imgs.favicon, 'f_png,w_64,h_64,c_fill');
    let own = document.getElementById('sa-favicon');
    if (fav) {
      if (!own) {
        document.querySelectorAll('link[rel="icon"]').forEach(l => { l.__cmsRemoved = true; l.remove(); });
        own = document.createElement('link'); own.id = 'sa-favicon'; own.rel = 'icon'; document.head.appendChild(own);
      }
      if (own.getAttribute('href') !== fav) own.setAttribute('href', fav);
    }
  }

  function applySeo(s) {
    const seo = (s && s.seo) || {};
    if (document.__cmsTitle === undefined) {
      document.__cmsTitle = document.title;
      const d = document.querySelector('meta[name="description"]');
      document.__cmsDesc = d ? d.getAttribute('content') : '';
    }
    document.title = seo.title || document.__cmsTitle;
    const d = document.querySelector('meta[name="description"]');
    if (d) d.setAttribute('content', seo.description || document.__cmsDesc);
    const ogT = document.querySelector('meta[property="og:title"]'); if (ogT) ogT.setAttribute('content', seo.title || document.__cmsTitle);
    const ogD = document.querySelector('meta[property="og:description"]'); if (ogD) ogD.setAttribute('content', seo.description || document.__cmsDesc);
  }

  // ── Pořadí a viditelnost sekcí ──
  let current = null;
  let origOrder = null;
  let layoutKey = '';
  function layout() {
    const footer = document.getElementById('kontakt');
    const els = [...document.querySelectorAll('[data-section]')];
    if (!footer || !els.length) return false;
    if (!origOrder) origOrder = els.slice();
    const wanted = current && Array.isArray(current.sections) && current.sections.length ? current.sections : null;
    const byId = id => els.find(e => e.getAttribute('data-section') === id);
    const order = [];
    if (wanted) wanted.forEach(x => { const e = byId(x.id); if (e && !order.includes(e)) order.push(e); });
    origOrder.forEach(e => { if (!order.includes(e)) order.push(e); });
    const key = JSON.stringify(order.map(e => e.getAttribute('data-section')).concat(wanted ? wanted.map(x => x.show) : []));
    if (key === layoutKey) return false;
    layoutKey = key;
    order.forEach(e => footer.parentNode.insertBefore(e, footer));
    const hiddenIds = new Set();
    order.forEach(e => {
      const id = e.getAttribute('data-section');
      const show = wanted ? (wanted.find(x => x.id === id)?.show !== false) : true;
      e.hidden = !show;
      if (!show) hiddenIds.add(e.id);
    });
    // odkazy na skrytou sekci zmizí z menu
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      const id = (a.getAttribute('href') || '').slice(1);
      const li = a.closest('li');
      if (id && li && li.closest('nav, .mobile-links, .footer-col')) li.hidden = hiddenIds.has(id);
    });
    return true;
  }
  const refreshLayoutEffects = () => {
    try { window.ScrollTrigger && window.ScrollTrigger.refresh(); } catch {}
    dispatchEvent(new Event('resize'));
  };

  function apply(s, { content = true } = {}) {
    current = s;
    applyTheme(s && s.theme);
    const run = () => {
      applyContent(s); applyImages(s); applySeo(s);
      if (layout() && document.readyState === 'complete') refreshLayoutEffects();
    };
    if (content) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
      else run();
    }
  }
  // ready: splní se, až jsou na stránce uplatněné čerstvé fotky ze serveru (čeká na to úvodní animace)
  let markReady;
  const ready = new Promise(r => { markReady = r; });
  const domReady = new Promise(r => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', r, { once: true }) : r()));
  window.SaTheme = { layout, apply, ready };

  // Okamžitě poslední známé nastavení (z minula), pak čerstvé ze serveru
  if (!PREVIEW) {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch {}
    if (cached) apply(cached);
    fetch('/api/site', { headers: { Accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : null))
      .then(s => {
        if (!s) return;
        try { if (s.theme) localStorage.setItem(CACHE, JSON.stringify(s)); else localStorage.removeItem(CACHE); } catch {}
        apply(s);
      })
      .catch(() => {})
      .then(() => domReady)
      .then(markReady);
  } else {
    addEventListener('message', e => {
      if (e.origin !== location.origin || e.source !== parent) return;
      const d = e.data;
      if (d && d.type === 'sa-preview' && d.settings && typeof d.settings === 'object') apply(d.settings);
    });
    document.addEventListener('DOMContentLoaded', () => parent.postMessage({ type: 'sa-preview-ready' }, location.origin));
  }
})();
