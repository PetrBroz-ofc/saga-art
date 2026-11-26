'use strict';
// Souhlas s cookies a měřením (§ 89 odst. 3 zákona o elektronických komunikacích, GDPR).
// Dokud návštěvník výslovně nesouhlasí, nic z měření ani reklamy se nenačte.
//  - analytické: Google Analytics 4,
//  - marketingové: Meta Pixel (reklamy na Facebooku a Instagramu) a reklamní signály Googlu.
// ID nástrojů si majitelka vyplní v administraci (Vzhled → Vyhledávače). Bez nich se nenačítá nic ani po souhlasu.
// Odmítnout je stejně snadné jako přijmout, nic není předem zaškrtnuté, volbu jde kdykoli změnit v patičce.

(() => {
  if (/(^|[?&])preview=1(&|$)/.test(location.search)) return; // náhled v administraci

  const KEY = 'sa_consent';
  const VERSION = 1;                 // zvýšit, když se změní účely nebo nástroje: lidé se pak zeptají znovu
  const MAX_AGE = 365 * 864e5;       // souhlas platí rok
  const GA_RE = /^G-[A-Z0-9]{4,16}$/;
  const PIXEL_RE = /^\d{10,20}$/;
  let memory = null;                 // když prohlížeč nedovolí úložiště, platí volba do zavření stránky

  function read() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && s.v === VERSION && Date.now() - s.at < MAX_AGE) return { analytics: s.analytics === true, marketing: s.marketing === true };
    } catch {}
    return memory;
  }

  function clearCookies(re) {
    const host = location.hostname;
    const domains = ['', host, '.' + host, '.' + host.split('.').slice(-2).join('.')];
    document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(n => re.test(n))
      .forEach(n => domains.forEach(d => { document.cookie = n + '=; Max-Age=0; path=/' + (d ? '; domain=' + d : ''); }));
  }

  // ── nástroje ──
  let ids = null, gaOn = false, pixelOn = false;
  async function loadIds() {
    if (ids) return ids;
    try {
      const r = await fetch('/api/site', { headers: { Accept: 'application/json' } });
      const t = r.ok ? (await r.json()).tracking || {} : {};
      ids = { ga: GA_RE.test(t.gaId || '') ? t.gaId : '', pixel: PIXEL_RE.test(t.metaPixel || '') ? t.metaPixel : '' };
    } catch { return { ga: '', pixel: '' }; }
    return ids;
  }
  function addScript(src) {
    const s = document.createElement('script'); s.async = true; s.src = src; document.head.appendChild(s);
  }
  // Do měření se neposílají parametry z adresy (číslo objednávky, údaje o platbě)
  const cleanUrl = () => location.origin + location.pathname;
  const sensitiveUrl = () => /[?&](session_id|order|platba|payment)=/i.test(location.search);

  function startGa(c, id) {
    const state = {
      analytics_storage: c.analytics ? 'granted' : 'denied', ad_storage: c.marketing ? 'granted' : 'denied',
      ad_user_data: c.marketing ? 'granted' : 'denied', ad_personalization: c.marketing ? 'granted' : 'denied',
    };
    if (gaOn) { window.gtag('consent', 'update', state); return; }
    gaOn = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', state);
    window.gtag('js', new Date());
    window.gtag('config', id, { page_location: cleanUrl(), allow_google_signals: c.marketing });
    addScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id));
  }
  function startPixel(id) {
    if (pixelOn || sensitiveUrl()) return;
    pixelOn = true;
    const fbq = function () { if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments); else fbq.queue.push(arguments); };
    fbq.queue = []; fbq.loaded = true; fbq.version = '2.0'; fbq.push = fbq;
    window.fbq = fbq; window._fbq = fbq;
    fbq('set', 'autoConfig', false, id);   // Pixel nesmí sám číst formuláře a tlačítka
    fbq('init', id);
    fbq('track', 'PageView');
    addScript('https://connect.facebook.net/en_US/fbevents.js');
  }
  async function apply(c) {
    if (!c || (!c.analytics && !c.marketing)) return;
    const t = await loadIds();
    if (c.analytics && t.ga) startGa(c, t.ga);
    if (c.marketing && t.pixel) startPixel(t.pixel);
  }

  function save(choice) {
    const prev = read();
    memory = choice;
    try { localStorage.setItem(KEY, JSON.stringify({ v: VERSION, at: Date.now(), ...choice })); } catch {}
    // odvolání souhlasu: smazat cookies nástrojů a načíst stránku znovu, ať žádný skript neběží dál
    if (prev && ((prev.analytics && !choice.analytics) || (prev.marketing && !choice.marketing))) {
      if (!choice.analytics) clearCookies(/^_ga/);
      if (!choice.marketing) clearCookies(/^(_fb[pc]|_gcl_au)$/);
      location.reload();
      return;
    }
    apply(choice);
  }

  // ── lišta ──
  let box = null;
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  function button(cls, text, fn) {
    const b = el('button', 'cc-btn ' + cls, text); b.type = 'button'; b.addEventListener('click', fn); return b;
  }
  function row(id, title, text, checked, disabled) {
    const li = el('li', 'cc-row'), label = el('label', 'cc-label');
    label.htmlFor = id;
    label.append(el('b', '', title), el('span', '', text));
    const input = el('input', 'cc-switch'); input.type = 'checkbox'; input.id = id; input.checked = checked; input.disabled = disabled; input.setAttribute('role', 'switch');
    li.append(label, input);
    return li;
  }
  function close() {
    if (!box) return;
    box.remove(); box = null;
  }
  function open(detail) {
    close();
    const cur = read() || { analytics: false, marketing: false };
    box = el('div', 'cc');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-labelledby', 'cc-title'); box.tabIndex = -1;
    const text = el('p', 'cc-text', 'Ráda bych věděla, jak web používáte, abych ho mohla zlepšovat, a ukazovat reklamy hlavně lidem, které mé šperky mohou zajímat. K tomu potřebuji váš souhlas s analytickými a marketingovými cookies. Bez souhlasu web funguje úplně stejně a volbu můžete kdykoli změnit v patičce. ');
    const more = el('a', '', 'Více o cookies'); more.href = '/cookies'; text.append(more);
    box.append(el('h2', 'cc-title', 'Cookies a měření'), text);
    box.lastChild.previousSibling.id = 'cc-title';

    let list = null;
    const actions = el('div', 'cc-actions');
    const choose = (a, m) => { close(); save({ analytics: a, marketing: m }); };
    actions.append(button('cc-ghost', 'Odmítnout vše', () => choose(false, false)), button('cc-main', 'Přijmout vše', () => choose(true, true)));
    const showDetail = () => {
      list = el('ul', 'cc-list');
      list.append(
        row('cc-need', 'Nezbytné', 'Pamatují si obsah košíku, oblíbené šperky a vaši volbu. Bez nich web nefunguje, proto jsou vždy zapnuté.', true, true),
        row('cc-ana', 'Analytické', 'Google Analytics ukáže, kolik lidí web navštíví a co je zajímá.', cur.analytics, false),
        row('cc-mkt', 'Marketingové', 'Meta Pixel a reklamní signály Googlu pomáhají měřit a cílit reklamy.', cur.marketing, false));
      box.insertBefore(list, actions);
      settings.replaceWith(button('cc-save', 'Uložit moji volbu', () => choose(box.querySelector('#cc-ana').checked, box.querySelector('#cc-mkt').checked)));
    };
    const settings = button('cc-link', 'Nastavení', showDetail);
    actions.append(settings);
    box.append(actions);
    document.body.appendChild(box);
    if (detail) { showDetail(); box.focus(); }
  }

  document.addEventListener('click', e => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (t.closest('[data-cookie-settings]')) { e.preventDefault(); open(true); return; }
    // události pro měření (jen když nástroj běží, tedy po souhlasu)
    const send = (name, meta) => {
      if (gaOn) window.gtag('event', name, { page_location: cleanUrl() });
      if (pixelOn && meta) window.fbq('track', meta);
    };
    const a = t.closest('a[href]');
    if (t.closest('[data-action="addToCart"]')) send('add_to_cart', 'AddToCart');
    else if (a && /^mailto:/.test(a.getAttribute('href'))) send('klik_email', 'Contact');
    else if (a && /(facebook|instagram)\.com/.test(a.getAttribute('href'))) send('klik_socialni_site');
  }, { capture: true });

  const start = () => {
    const c = read();
    if (c) { apply(c); return; }
    if (location.pathname.replace(/\.html$/, '') === '/cookies') { open(false); return; }
    // počkat, až doběhne úvodní animace
    const wait = () => (document.documentElement.classList.contains('intro-fly') ? setTimeout(wait, 400) : open(false));
    setTimeout(wait, 900);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
