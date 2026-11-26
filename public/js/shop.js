'use strict';
// Sága Art — obchod. Žádné inline handlery (kvůli přísné CSP): kliky jdou přes data-action.

// ── Escapování proti XSS — každá dynamická hodnota v innerHTML jde přes esc() ──
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const safeId = s => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '');
// Obrázky jen z https nebo z vlastní složky /img/ (žádné javascript:/data: URL)
const safeUrl = u => /^(https:\/\/[^\s"'<>]+|\/img\/[A-Za-z0-9_\/.-]+\.(jpe?g|png|webp|svg)|\/media\/[a-f0-9]{24}\.(jpg|png|webp))$/.test(String(u || '')) ? String(u) : '';
const kc = n => (Number(n) || 0).toLocaleString('cs-CZ') + ' Kč';
const $ = id => document.getElementById(id);

// Doprava — jen pro zobrazení. Ceny při objednávce počítá server (api/_shop.js).
let SHIPPING = {
  zasilkovna: { name:'Zásilkovna, výdejní místo nebo Z-BOX', price:89, country:'CZ', freeFrom:true },
  zasilkovna_adresa: { name:'Zásilkovna, doručení na adresu', price:119, country:'CZ', freeFrom:true },
  balikovna:  { name:'Česká pošta, Balíkovna',            price:109, country:'CZ' },
  posta:      { name:'Česká pošta na adresu',            price:130, country:'CZ' },
  packeta_sk: { name:'Packeta na Slovensko',                price:130, country:'SK' },
  email:      { name:'E-mailem (jen dárkový poukaz)',       price:0,   country:'*', voucherOnly:true },
};
// Dárkové zabalení — jen pro zobrazení, cenu při objednávce určuje server (api/_shop.js)
let GIFT_WRAP = { name:'Dárkové zabalení', price:59 };
// Doprava zdarma Zásilkovnou od této částky (zboží + balení po odečtení poukazu); platí server
let FREE_SHIPPING_FROM = 1490;
// Dárkové poukazy jako zvláštní položky košíku (cenu stejně ověří server)
// Pravidla z nastavení v administraci (přijdou z /api/products-public, jinak platí tyto výchozí)
let SHOP = { vouchers:{ on:true, values:[500, 1000, 1500], months:12 }, payments:{ card:false, transfer:true }, vacation:{ on:false, block:false, message:'' }, giftWrapOn:true };
const BAKED_VOUCHERS = [500, 1000, 1500]; // k těmto hodnotám jsou hotové obrázky karty, ostatní se skládají z pozadí a textu
const monthsText = n => n + (n === 1 ? ' měsíc' : n >= 2 && n <= 4 ? ' měsíce' : ' měsíců');
let VOUCHERS = [];
function buildVouchers() {
  VOUCHERS = SHOP.vouchers.on ? SHOP.vouchers.values.map(v => ({
    id:'voucher-' + v, name:'Dárkový poukaz ' + v.toLocaleString('cs-CZ') + ' Kč', price:v,
    imgs:[BAKED_VOUCHERS.includes(v) ? '/img/poukaz-' + v + '.jpg' : '/img/poukaz-base.jpg'], voucher:true, collection:'', cat:'',
    material:'Elektronický, platí ' + monthsText(SHOP.vouchers.months),
  })) : [];
}
buildVouchers();
const findItem = id => PRODUCTS.find(p => p.id === id) || VOUCHERS.find(p => p.id === id);
const HEART = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>';
const BAG = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>';

const SHIP_META = {
  zasilkovna: { desc:'Doručení na výdejní místo Zásilkovny nebo do Z-BOXu' },
  zasilkovna_adresa: { desc:'Zásilkovna vám balíček doveze až domů' },
  balikovna:  { desc:'Vyzvednutí na pobočce Balíkovny' },
  posta:      { desc:'Doručení až domů' },
  packeta_sk: { desc:'Výdejní místo nebo Z-BOX na Slovensku' },
  email:      { desc:'Kód poukazu přijde e-mailem hned po zaplacení' },
};

// Kolekce — barvy placeholderů odpovídají kamenům
// Pořadí = pořadí na webu. cover = titulní fotka (šperk na těle působí víc než stojánek).
let COLLECTIONS = {
  Charlotte: { cover:'/img/produkty/charlotte-nahrdelnik/1.jpg', desc:'Jemný amazonit, pravé říční perly a čtyřlístek pro štěstí.', ph1:'#e3f1ec', ph2:'#a7cfc1', gem:'#9cc9b9' },
  Euforie:   { cover:'/img/produkty/euforie-gold-long/1.jpg', desc:'Drobné říční perly a zlatá ocel. Šperky na každý den, které se krásně vrství.', ph1:'#fbf3e4', ph2:'#e6cf9f', gem:'' },
  'Moře':    { cover:'/img/produkty/more-kvet-nahrdelnik/1.jpg', desc:'Světle modrý akvamarín a říční perly v barvách mořské hladiny.', ph1:'#e5f0f5', ph2:'#a9c8d8', gem:'#a3c8da' },
  Duna:      { cover:'/img/produkty/duna-nahrdelnik/1.jpg', desc:'Výrazný zlatý řetízek, krémové perly a světlý amazonit se stromem života.', ph1:'#f7f0e1', ph2:'#d9c9a0', gem:'#c9dccf' },
  Pure:      { cover:'/img/produkty/pure-nahrdelnik/1.jpg', desc:'Nepravidelné říční perly s jemnými nerezovými detaily.', ph1:'#fbf1ef', ph2:'#e8c9c6', gem:'' },
  Best:      { cover:'/img/produkty/best-harmonie/1.jpg', desc:'Amazonit z Peru, říční perly a perleťové srdce.', ph1:'#e8f2ec', ph2:'#b6d3c2', gem:'#a9cdb9' },
  Pearl:     { cover:'/img/produkty/silver-pearl/1.jpg', desc:'Vrstvené perlové náhrdelníky v kombinaci se stříbřitou ocelí.', ph1:'#f4f1f1', ph2:'#d6cdcf', gem:'' },
};
const CAT_LABELS = { nahrdelniky:'Náhrdelníky', nausnice:'Náušnice', naramky:'Náramky', prstynky:'Prstýnky', soupravy:'Sety' };

let PRODUCTS = [];

// ─── RECENZE ───
let REVIEW_SUMMARY = {};
let REVIEWS_ON = false;
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const avgText = a => String(a).replace('.', ',');
const countText = n => n + ' ' + (n >= 1 && n <= 4 ? 'recenze' : 'recenzí');
// Hvězdičky na kartě šperku, po kliknutí se otevře detail rovnou na recenzích
function ratingHtml(id) {
  if (!REVIEWS_ON) return '';
  const r = REVIEW_SUMMARY[id], n = r && r.count || 0;
  const label = n ? 'Hodnocení ' + avgText(r.avg) + ' z 5, ' + countText(n) + '. Zobrazit recenze' : 'Zatím bez recenzí. Zobrazit a napsat recenzi';
  return '<button type="button" class="product-rating" data-action="openReviews" data-arg="' + id + '" aria-label="' + label + '">'
    + '<span aria-hidden="true">' + stars(n ? Math.round(r.avg) : 0) + '</span> '
    + (n ? avgText(r.avg) + ' <small>(' + countText(n) + ')</small>' : '<small>0 recenzí</small>') + '</button>';
}
function updateRatings() {
  document.querySelectorAll('#productsGrid .product-card').forEach(card => {
    const id = card.dataset.arg, name = card.querySelector('.product-name');
    if (!name) return;
    card.querySelector('.product-rating')?.remove();
    name.insertAdjacentHTML('afterend', ratingHtml(id));
  });
}
async function loadReviewSummary() {
  try {
    const res = await fetch('/api/reviews');
    if (!res.ok) return;
    const j = await res.json();
    REVIEWS_ON = !!j.on;
    REVIEW_SUMMARY = j.on && j.summary ? j.summary : {};
    updateRatings();
  } catch {}
}
function reviewFormHtml() {
  return '<div class="pd-rev-write"><button type="button" class="btn-primary pd-rev-open" data-action="showReviewForm" aria-controls="pdRevForm">Zanechat recenzi</button>'
    + '<form class="pd-rev-form" id="pdRevForm" hidden novalidate>'
    + '<fieldset class="pd-rate"><legend>Vaše hodnocení</legend><div class="pd-rate-stars">'
    + [1, 2, 3, 4, 5].map(n => '<button type="button" class="pd-star" data-action="setRating" data-arg="' + n + '" aria-label="' + n + ' z 5" aria-pressed="false">☆</button>').join('')
    + '<button type="button" class="pd-star-zero" data-action="setRating" data-arg="0" aria-pressed="false">0 hvězd</button></div></fieldset>'
    + '<label>Jméno<input type="text" name="name" maxlength="40" autocomplete="given-name" placeholder="Jana K."></label>'
    + '<label>Text recenze<textarea name="text" rows="4" maxlength="1000" placeholder="Jak se vám šperk líbí?"></textarea></label>'
    + '<input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">'
    + '<p class="pd-rev-note">Recenze se zveřejní po kontrole. Jméno a text uvidí všichni.</p>'
    + '<button type="submit" class="btn-primary">Odeslat recenzi</button>'
    + '<p class="pd-rev-msg" role="status" aria-live="polite"></p></form></div>';
}
function setRating(v, el) {
  const form = el.closest('form'); if (!form) return;
  const n = Number(v);
  form.dataset.rating = String(n);
  form.querySelectorAll('.pd-star').forEach(b => {
    const on = Number(b.dataset.arg) <= n;
    b.textContent = on ? '★' : '☆';
    b.setAttribute('aria-pressed', String(Number(b.dataset.arg) === n));
  });
  const z = form.querySelector('.pd-star-zero');
  z.classList.toggle('on', n === 0); z.setAttribute('aria-pressed', String(n === 0));
}
function showReviewForm() {
  const form = $('pdRevForm'); if (!form) return;
  form.hidden = false;
  form.parentElement.querySelector('.pd-rev-open').hidden = true;
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function sendReview(form, productId) {
  const msg = form.querySelector('.pd-rev-msg'), btn = form.querySelector('button[type="submit"]');
  const say = (t, c) => { msg.className = 'pd-rev-msg' + (c ? ' ' + c : ''); msg.textContent = t; };
  const name = form.elements.name.value.trim(), text = form.elements.text.value.trim();
  if (form.dataset.rating === undefined) return say('Vyberte prosím počet hvězdiček.', 'err');
  if (name.length < 2) return say('Napište prosím jméno.', 'err');
  if (text.length < 10) return say('Napište prosím aspoň 10 znaků.', 'err');
  btn.disabled = true; say('Odesílám…');
  try {
    const res = await fetch('/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, rating: Number(form.dataset.rating), name, text, website: form.elements.website.value }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'Odeslání se nepovedlo. Zkuste to prosím znovu.');
    form.querySelectorAll('fieldset, label, .pd-rev-note, button[type="submit"]').forEach(x => { x.hidden = true; });
    say(j.message || 'Děkuji! Recenze se objeví po schválení.', 'ok');
  } catch (err) { say(err.message, 'err'); btn.disabled = false; }
}
function scrollToReviews() { $('pdReviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
// Recenze v detailu šperku
async function loadProductReviews(id, opts = {}) {
  const box = $('pdReviews');
  if (!box) return;
  box.innerHTML = '';
  try {
    const res = await fetch('/api/reviews?product=' + encodeURIComponent(id));
    const j = await res.json();
    if (!res.ok || !j.on) return;
    if ($('pdetailOverlay').dataset.pid !== id) return; // mezitím se otevřel jiný šperk
    const list = Array.isArray(j.reviews) ? j.reviews : [];
    const n = j.summary && j.summary.count || 0;
    const top = $('pdRatingTop');
    if (top) top.innerHTML = '<button type="button" class="product-rating" data-action="scrollToReviews"><span aria-hidden="true">' + stars(n ? Math.round(j.summary.avg) : 0) + '</span> '
      + (n ? avgText(j.summary.avg) + ' <small>(' + countText(n) + ')</small>' : '<small>0 recenzí</small>') + '</button>';
    box.innerHTML = '<hr class="pdetail-divider"/><div class="pd-reviews"><h3 class="pd-rev-h">Recenze'
      + (n ? ' <span class="pd-rev-sum"><span aria-hidden="true">' + stars(Math.round(j.summary.avg)) + '</span> ' + avgText(j.summary.avg) + ' <small>(' + n + ')</small></span>' : '') + '</h3>'
      + (list.length ? list.map(r => '<article class="pd-rev"><p class="pd-rev-stars" aria-label="' + r.rating + ' z 5">' + stars(r.rating) + '</p>'
          + (r.title ? '<h4>' + esc(r.title) + '</h4>' : '') + '<p>' + esc(r.text) + '</p><small>' + esc(r.name) + (r.verified ? ' · ověřený nákup' : '') + '</small></article>').join('')
        : '<p class="pd-rev-empty">Zatím tu není žádná recenze. Buďte první.</p>')
      + reviewFormHtml()
      + '<p class="pd-rev-note">Recenzi může napsat kdokoli. Neověřuji, že autor šperk koupil, pokud u ní není „ověřený nákup“. Před zveřejněním je kontroluji kvůli spamu.</p></div>';
    $('pdRevForm').addEventListener('submit', e => { e.preventDefault(); sendReview(e.currentTarget, id); });
    if (opts.write) showReviewForm();
    if (opts.reviews || opts.write) scrollToReviews();
  } catch {}
}

// ═══════════════════════════════
// PLACEHOLDER (dokud nejsou fotky)
// ═══════════════════════════════
const HEX = /^#[0-9a-f]{3,8}$/i;
function pearlSvg(gem) {
  gem = HEX.test(gem) ? gem : '';
  let s = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M8 18 Q50 112 92 18" fill="none" stroke="#b8956a" stroke-width=".8"/>';
  for (let i = 0; i <= 8; i++) {
    const t = i / 8, x = (1-t)*(1-t)*8 + 2*(1-t)*t*50 + t*t*92, y = (1-t)*(1-t)*18 + 2*(1-t)*t*112 + t*t*18;
    const isGem = gem && i % 2 === 1;
    s += '<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+(isGem?4.2:5.4)+'" fill="'+(isGem?gem:'#f4ece6')+'" stroke="rgba(143,74,87,.18)" stroke-width=".4"/>';
  }
  return s + '<circle cx="50" cy="84" r="8" fill="#f4ece6" stroke="rgba(143,74,87,.18)" stroke-width=".4"/></svg>';
}
function phHtml(collection) {
  const c = COLLECTIONS[collection] || {};
  const ph1 = HEX.test(c.ph1) ? c.ph1 : '#f9e4e6', ph2 = HEX.test(c.ph2) ? c.ph2 : '#efc3c9';
  return '<div class="ph" style="--ph1:'+ph1+';--ph2:'+ph2+'">'+pearlSvg(c.gem)+'</div>';
}
function imgHtml(p, src) {
  src = safeUrl(src);
  return src ? '<img src="'+esc(src)+'" alt="'+esc(p.name)+'" loading="lazy" referrerpolicy="no-referrer"/>' : phHtml(p.collection);
}
const firstImg = p => (Array.isArray(p.imgs) && p.imgs[0]) || '';

// ═══════════════════════════════
// KOLEKCE + FILTR + NAČÍST DALŠÍ
// ═══════════════════════════════
const PAGE_SIZE = 8;
let filter = { cat:'vse', collection:'' };
let visibleCount = PAGE_SIZE;

function renderCollections() {
  $('collectionGrid').innerHTML = Object.entries(COLLECTIONS).map(([name, c]) => {
    const items = PRODUCTS.filter(p => p.collection === name);
    const img = c.cover || items.map(firstImg).find(Boolean);
    const n = items.length;
    if (!n) return '';
    return '<button type="button" class="cat-card" data-action="filterByCollection" data-arg="' + esc(name) + '">'
      + '<div class="cat-media">' + imgHtml({ name, collection:name }, img) + '</div>'
      + '<h3 class="cat-name">' + esc(name) + '<span class="cat-count">' + n + ' ' + (n === 1 ? 'šperk' : n < 5 ? 'šperky' : 'šperků') + '</span></h3>'
      + '<p class="cat-desc">' + esc(c.desc) + '</p></button>';
  }).join('');
}

// Kolekce a počty v navigaci (panel Kolekce, mobilní menu, panel Šperky)
function renderNavMenus() {
  const cards = Object.entries(COLLECTIONS)
    .filter(([name]) => PRODUCTS.some(p => p.collection === name))
    .map(([name, c], i) => '<button type="button" class="panel-col" style="--i:' + i + '" data-action="filterByCollection" data-arg="' + esc(name) + '">'
      + '<div class="panel-col-img">' + imgHtml({ name, collection:name }, c.cover || '') + '</div>'
      + '<span>' + esc(name) + '</span></button>').join('');
  ['navCollections', 'mobileCollections'].forEach(id => { const el = $(id); if (el) el.innerHTML = cards; });
  document.querySelectorAll('[data-count]').forEach(el => {
    const cat = el.dataset.count;
    const n = PRODUCTS.filter(p => cat === 'vse' || p.cat === cat).length;
    el.textContent = n ? String(n) : '';
  });
}

const filteredProducts = () => PRODUCTS.filter(p =>
  (filter.cat === 'vse' || p.cat === filter.cat) && (!filter.collection || p.collection === filter.collection));

function productCardHtml(p) {
  const id = safeId(p.id), fav = wishlist.includes(id);
  const photos = (Array.isArray(p.imgs) ? p.imgs : []).map(safeUrl).filter(Boolean);
  return '<div class="product-card" data-action="openProduct" data-arg="' + id + '">'
    + '<div class="product-img">' + imgHtml(p, firstImg(p))
    + (photos[1] ? '<img class="alt" src="' + esc(photos[1]) + '" alt="" loading="lazy" referrerpolicy="no-referrer"/>' : '')
    + (p.badge ? '<div class="product-badge">' + esc(p.badge) + '</div>' : '')
    + '<button class="product-wishlist' + (fav ? ' on' : '') + '" data-action="toggleWish" data-arg="' + id + '" aria-label="Uložit do oblíbených" aria-pressed="' + fav + '">' + HEART + '</button>'
    + '</div><div class="product-info">'
    + (p.collection ? '<p class="product-collection">' + esc(p.collection) + '</p>' : '')
    + '<h3 class="product-name">' + esc(p.name) + '</h3>'
    + ratingHtml(id)
    + '<p class="product-material">' + esc(p.material) + '</p>'
    + '<div class="product-bottom"><span class="product-price">' + kc(p.price) + '</span>'
    + '<button class="product-add" data-action="addToCart" data-arg="' + id + '" aria-label="Přidat ' + esc(p.name) + ' do košíku">' + BAG + '<span>Do košíku</span></button>'
    + '</div></div></div>';
}

function renderGrid() {
  const grid = $('productsGrid');
  const list = filteredProducts();
  if (!list.length) {
    grid.innerHTML = '<p class="grid-empty">Žádné šperky k zobrazení.</p>';
  } else {
    grid.innerHTML = list.slice(0, visibleCount).map(productCardHtml).join('');
  }
  updateGridControls(list);
}

// tlačítka, informace o filtru a záložky (zvlášť, ať jde „Zobrazit další“ doplnit bez překreslení celé mřížky)
function updateGridControls(list) {
  $('btnLoadMore').style.display = list.length > visibleCount ? 'inline-block' : 'none';
  $('btnCollapse').style.display = visibleCount > PAGE_SIZE && list.length > PAGE_SIZE ? 'inline-block' : 'none';

  const info = $('filterInfo');
  info.hidden = !filter.collection;
  if (filter.collection) info.innerHTML = 'Kolekce <strong>' + esc(filter.collection) + '</strong> · <button data-action="filterByCollection" data-arg="">zobrazit vše</button>';
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === filter.cat));
}

function setCategory(cat) { filter.cat = cat; visibleCount = PAGE_SIZE; renderGrid(); }
function filterByCollection(name) {
  filter = { cat:'vse', collection:name || '' }; visibleCount = PAGE_SIZE; renderGrid();
  $('produkty').scrollIntoView({ behavior:'smooth' });
}
function loadMore() {
  // přidají se jen nové kartičky, ty stávající zůstanou na místě (jinak se celá mřížka překreslí a stránka poskočí)
  const grid = $('productsGrid'), list = filteredProducts();
  const have = grid.querySelectorAll('.product-card').length;
  visibleCount += PAGE_SIZE;
  if (!have) return renderGrid();
  grid.insertAdjacentHTML('beforeend', list.slice(have, visibleCount).map(productCardHtml).join(''));
  updateGridControls(list);
}
function collapseProducts() { visibleCount = PAGE_SIZE; renderGrid(); $('produkty').scrollIntoView({ behavior:'smooth' }); }

// ── Úložiště v prohlížeči (jen košík a oblíbené — nic citlivého) ──
function load(key, def) { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

let wishlist = load('sa_wish', []).filter(x => typeof x === 'string').map(safeId);
function toggleWish(id, btn) {
  wishlist = wishlist.includes(id) ? wishlist.filter(x => x !== id) : [...wishlist, id];
  save('sa_wish', wishlist);
  const on = wishlist.includes(id);
  btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on);
}

// ═══════════════════════════════
// DETAIL PRODUKTU
// ═══════════════════════════════
let currentSlide = 0, slideCount = 1;

function openProduct(id, opts = {}) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!p) return;
  const valid = (Array.isArray(p.imgs) ? p.imgs : []).map(safeUrl).filter(Boolean);
  const imgs = valid.length ? valid : [''];
  slideCount = imgs.length; currentSlide = 0;
  const slides = $('pdetailSlides');
  slides.style.transition = 'none'; slides.style.transform = 'translateX(0)';
  slides.innerHTML = imgs.map((src, i) => '<div class="pdetail-slide"' + (src ? ' data-action="openZoom" title="Zvětšit fotku"' : '') + '>'
    + (src ? '<img src="' + esc(src) + '" alt="' + esc(p.name) + (i ? ' (fotka ' + (i+1) + ')' : '') + '" ' + (i ? 'loading="lazy" ' : '') + 'referrerpolicy="no-referrer"/>' : phHtml(p.collection))
    + '</div>').join('');
  $('pdetailDots').innerHTML = slideCount > 1
    ? imgs.map((_, i) => '<button class="pdetail-dot ' + (i===0?'active':'') + '" data-action="goToSlide" data-arg="' + i + '" aria-label="Fotka ' + (i+1) + '"></button>').join('') : '';
  $('pdetailThumbs').innerHTML = slideCount > 1
    ? imgs.map((src, i) => '<button class="pdetail-thumb ' + (i===0?'active':'') + '" data-action="goToSlide" data-arg="' + i + '" aria-label="Zobrazit fotku ' + (i+1) + '"><img src="' + esc(src) + '" alt="" loading="lazy" referrerpolicy="no-referrer"/></button>').join('') : '';
  $('pdetailCounter').textContent = slideCount > 1 ? '1 / ' + slideCount : '';
  document.querySelector('.pdetail-prev').style.display = slideCount > 1 ? 'flex' : 'none';
  document.querySelector('.pdetail-next').style.display = slideCount > 1 ? 'flex' : 'none';

  const props = Object.assign({ 'Kolekce': p.collection, 'Kategorie': CAT_LABELS[p.cat] }, p.props || {});
  const propsHtml = Object.entries(props).filter(([k, v]) => k && v)
    .map(([k, v]) => '<div class="pdetail-prop"><strong>' + esc(k) + '</strong><span>' + esc(v) + '</span></div>').join('');
  $('pdetailInfo').innerHTML =
    (p.badge ? '<div class="pdetail-badge">' + esc(p.badge) + '</div>' : '') +
    '<h2 class="pdetail-name">' + esc(p.name) + '</h2>' +
    '<p class="pdetail-material">' + esc(p.material) + '</p>' +
    '<div id="pdRatingTop"></div>' +
    '<div class="pdetail-price">' + kc(p.price) + '</div>' +
    '<p class="pdetail-desc">' + esc(p.desc) + '</p>' +
    '<hr class="pdetail-divider"/>' +
    '<div class="pdetail-props">' + propsHtml + '</div>' +
    '<div class="pdetail-buy"><span class="pdetail-buy-price">' + kc(p.price) + '</span>' +
    '<button class="pdetail-add-btn" data-action="addToCart" data-arg="' + safeId(p.id) + '">Přidat do košíku</button></div>' +
    '<p class="pdetail-page"><a href="/sperk/' + encodeURIComponent(safeId(p.id)) + '">Stránka tohoto šperku</a></p>' +
    '<div id="pdReviews"></div>';
  $('pdetailOverlay').dataset.pid = safeId(p.id);
  loadProductReviews(safeId(p.id), opts);
  $('pdetailOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closePdetail() { closeZoom(); $('pdetailOverlay').classList.remove('open'); document.body.style.overflow = ''; }
function slideGallery(dir) { currentSlide = (currentSlide + dir + slideCount) % slideCount; updateGallery(); }
// Zvětšená fotka přes celou obrazovku (klik na fotku v detailu)
function zoomSrc() { return document.querySelectorAll('#pdetailSlides .pdetail-slide img')[currentSlide]?.getAttribute('src') || ''; }
function openZoom() {
  const src = zoomSrc(); if (!src) return;
  const z = $('pzoom'); $('pzoomImg').src = src; $('pzoomImg').alt = document.querySelector('.pdetail-name')?.textContent || '';
  z.querySelectorAll('.pzoom-nav').forEach(b => { b.hidden = slideCount < 2; });
  z.hidden = false; requestAnimationFrame(() => z.classList.add('open'));
}
function closeZoom() { const z = $('pzoom'); if (!z || z.hidden) return false; z.classList.remove('open'); z.hidden = true; return true; }
function zoomSlide(dir) { slideGallery(dir); const src = zoomSrc(); if (src) $('pzoomImg').src = src; }
function goToSlide(i) { currentSlide = i; updateGallery(); }
function updateGallery() {
  const slides = $('pdetailSlides');
  slides.style.transition = 'transform .35s ease';
  slides.style.transform = 'translateX(-' + (currentSlide * 100) + '%)';
  document.querySelectorAll('.pdetail-dot').forEach((d, i) => d.classList.toggle('active', i === currentSlide));
  document.querySelectorAll('.pdetail-thumb').forEach((t, i) => {
    t.classList.toggle('active', i === currentSlide);
    if (i === currentSlide) {
      const box = t.parentElement;
      box.scrollTo({ left: t.offsetLeft - (box.clientWidth - t.offsetWidth) / 2, behavior:'smooth' });
    }
  });
  if (slideCount > 1) $('pdetailCounter').textContent = (currentSlide + 1) + ' / ' + slideCount;
}
(function setupSwipe() {
  const g = $('pdetailGallery'); let startX = 0;
  g.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive:true });
  g.addEventListener('touchend', e => {
    const diff = startX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40 && slideCount > 1) slideGallery(diff > 0 ? 1 : -1);
  });
})();

// ═══════════════════════════════════════
// KOŠÍK — ukládá se jen id + počet; názvy a ceny vždy z aktuálního katalogu
// ═══════════════════════════════════════
let cart = load('sa_cart', [])
  .filter(i => i && typeof i.id === 'string' && Number.isInteger(i.qty) && i.qty > 0)
  .map(i => ({ id:safeId(i.id), qty:Math.min(10, i.qty) }));
let selectedShipping = null, selectedPayment = null;
let giftWrap = load('sa_wrap', false) === true;
let appliedCoupon = null; // { code, type, value, minGoods } po ověření na serveru
let appliedVoucher = null; // { code, balance } po ověření na serveru

const cartLines = () => cart.map(i => ({ ...i, p: findItem(i.id) })).filter(l => l.p);
const onlyVouchers = () => cartLines().every(l => l.p.voucher);
const wrapPrice = () => (giftWrap && SHOP.giftWrapOn && !onlyVouchers() ? GIFT_WRAP.price : 0);
// z čeho smí poukaz platit: šperky a balení (ne doprava, ne jiné poukazy)
const goodsTotal = () => cartLines().filter(l => !l.p.voucher).reduce((s, l) => s + l.p.price * l.qty, 0);
// slevový kód: procenta nebo částka ze zboží (server počítá stejně)
const couponDiscount = () => {
  if (!appliedCoupon || onlyVouchers()) return 0;
  const g = goodsTotal();
  if (g < (appliedCoupon.minGoods || 0)) return 0;
  return appliedCoupon.type === 'percent' ? Math.floor(g * appliedCoupon.value / 100) : Math.min(appliedCoupon.value, g);
};
const voucherBase = () => goodsTotal() - couponDiscount() + wrapPrice();
const discount = () => (appliedVoucher ? Math.min(appliedVoucher.balance, voucherBase()) : 0);
// kolik chybí do dopravy zdarma (0 = už ji máte); limit se počítá po odečtení poukazu
const freeShipLeft = () => Math.max(0, FREE_SHIPPING_FROM - (voucherBase() - discount()));
const freeShipOn = () => FREE_SHIPPING_FROM > 0;
function freeShipHtml() {
  if (onlyVouchers() || !freeShipOn()) return '';
  const left = freeShipLeft();
  const pct = Math.min(100, Math.round((1 - left / FREE_SHIPPING_FROM) * 100));
  const text = left > 0 ? `Do dopravy zdarma vám zbývá <b>${kc(left)}</b>.` : 'Doprava Zásilkovnou je zdarma.';
  return `<div class="free-ship-text">${text}</div><div class="free-ship-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>`;
}
const getCartSubtotal = () => cartLines().reduce((s, l) => s + l.p.price * l.qty, 0);

function toggleCart() { $('cartOverlay').classList.toggle('open'); }

function addToCart(id, btn) {
  const p = findItem(id);
  if (!p) return;
  closePdetail();
  const existing = cart.find(i => i.id === id);
  if (existing) existing.qty = Math.min(10, existing.qty + 1);
  else cart.push({ id, qty:1 });
  cartChanged();
  showNotification(p.name + ' je v košíku');
  if (btn.classList.contains('product-add')) { btn.classList.add('added'); setTimeout(() => btn.classList.remove('added'), 1200); }
}
function changeQty(i, d) {
  cart[i].qty = Math.min(10, cart[i].qty + d);
  if (cart[i].qty <= 0) cart.splice(i, 1);
  cartChanged();
}
function removeFromCart(i) { cart.splice(i, 1); cartChanged(); }
function cartChanged() { save('sa_cart', cart); renderCart(); }

function renderCart() {
  // šperky, které už nejsou v nabídce, z košíku zmizí
  if (PRODUCTS.length) cart = cart.filter(i => findItem(i.id));
  const lines = cartLines();
  $('cartBadge').textContent = lines.reduce((s, l) => s + l.qty, 0);
  const footer = $('cartFooterBox');
  if (!lines.length) {
    $('cartItems').innerHTML = '<div class="cart-empty"><span>Košík je zatím prázdný</span></div>';
    footer.style.display = 'none';
    return;
  }
  footer.style.display = 'block';
  $('cartItems').innerHTML = lines.map((l, i) => `
    <div class="cart-item">
      <div class="cart-item-img">${imgHtml(l.p, firstImg(l.p))}</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${esc(l.p.name)}</div>
        <div class="cart-item-price">${kc(l.p.price)} / ks</div>
        <div class="cart-item-qty">
          <button data-action="changeQty" data-arg="${i}:-1" aria-label="Ubrat">−</button><span>${l.qty}</span><button data-action="changeQty" data-arg="${i}:1" aria-label="Přidat">+</button>
        </div>
      </div>
      <button class="cart-item-remove" data-action="removeFromCart" data-arg="${i}" aria-label="Odebrat"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
    </div>`).join('');
  $('cartSubtotal').textContent = kc(getCartSubtotal());
  const canWrap = !onlyVouchers();
  $('wrapBox').hidden = !canWrap || !SHOP.giftWrapOn;
  $('f_wrap').checked = giftWrap;
  $('wrapMsgWrap').hidden = !(canWrap && giftWrap);
  $('wrapPriceLabel').textContent = '+ ' + kc(GIFT_WRAP.price);
  // totéž ve shrnutí objednávky (krok 4)
  $('wrapReview').hidden = !canWrap || !SHOP.giftWrapOn;
  $('f_wrap2').checked = giftWrap;
  $('wrapMsgWrap2').hidden = !(canWrap && giftWrap);
  $('wrapPriceLabel2').textContent = '+ ' + kc(GIFT_WRAP.price);
  $('cartFreeShip').innerHTML = freeShipHtml();
  $('cartFreeShip').hidden = !canWrap || !freeShipOn();
  $('cartShipRow').hidden = !canWrap;
  $('cartTotalLabel').textContent = canWrap ? 'Celkem bez dopravy' : 'Celkem';
  $('cartTotal').textContent = kc(getCartSubtotal() + wrapPrice());
}
function setGiftWrap(on) {
  giftWrap = !!on; save('sa_wrap', giftWrap); renderCart();
  if (selectedShipping) renderOrderSummary('orderSummaryFinal');
}

// ─── SLEVOVÝ KÓD V POKLADNĚ ───
async function applyCoupon() {
  const code = $('f_coupon').value.trim();
  const msg = $('couponMsg');
  if (!code) { appliedCoupon = null; msg.textContent = ''; renderOrderSummary('orderSummaryFinal'); return; }
  const btn = $('btnCoupon'); btn.disabled = true;
  try {
    const r = await fetch('/api/coupon', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ code, goods: goodsTotal() }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Kód se nepodařilo ověřit');
    appliedCoupon = { code: j.code, type: j.type, value: j.value, minGoods: j.minGoods || 0 };
    msg.className = 'voucher-msg ok';
    msg.textContent = j.type === 'percent' ? `Kód platí: sleva ${j.value} % ze zboží.` : `Kód platí: sleva ${kc(j.value)} ze zboží.`;
  } catch (err) {
    appliedCoupon = null;
    msg.className = 'voucher-msg err';
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
    renderOrderSummary('orderSummaryFinal');
  }
}

// ─── DÁRKOVÝ POUKAZ V POKLADNĚ ───
async function applyVoucher() {
  const code = $('f_voucher').value.trim();
  const msg = $('voucherMsg');
  if (!code) { appliedVoucher = null; msg.textContent = ''; renderOrderSummary('orderSummaryFinal'); return; }
  const btn = $('btnVoucher'); btn.disabled = true;
  try {
    const r = await fetch('/api/voucher', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ code }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Poukaz se nepodařilo ověřit');
    appliedVoucher = { code, balance: Number(j.balance) || 0 };
    msg.className = 'voucher-msg ok';
    msg.textContent = 'Poukaz platí v hodnotě ' + kc(appliedVoucher.balance) + '. Jde využít jednou, jen na zboží (ne na dopravu), nevyčerpaná část se nevrací.';
  } catch (err) {
    appliedVoucher = null;
    msg.className = 'voucher-msg err';
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
    renderOrderSummary('orderSummaryFinal');
  }
}

// ═══════════════════════════════════════
// OBJEDNÁVKA
// ═══════════════════════════════════════
const v = id => $(id).value.trim();
// cena dopravy (Zásilkovna je od limitu zdarma, ostatní dopravci mají cenu pevnou)
const shipPriceFor = key => {
  const s = SHIPPING[key];
  if (!s) return 0;
  return s.freeFrom && freeShipOn() && freeShipLeft() === 0 ? 0 : s.price;
};
const shipPrice = () => selectedShipping ? shipPriceFor(selectedShipping) : 0;

function startCheckout() {
  if (!cartLines().length) return;
  if (SHOP.vacation.on && SHOP.vacation.block) { showNotification(SHOP.vacation.message || 'Obchod je teď zavřený.'); return; }
  toggleCart();
  $('checkoutModal').classList.add('open');
  goToStep(1);
}
function closeCheckout() { $('checkoutModal').classList.remove('open'); }

function goToStep(n) {
  document.querySelectorAll('.modal-step').forEach(s => s.classList.remove('active'));
  $('step' + n).classList.add('active');
  const numeric = typeof n === 'number';
  $('stepsHead').style.display = numeric ? '' : 'none';
  if (!numeric) return;
  [1,2,3,4].forEach(i => {
    $('dot' + i).classList.toggle('done', i < n);
    $('dot' + i).classList.toggle('active', i === n);
    const line = $('line' + i);
    if (line) line.classList.toggle('done', i < n);
  });
  document.querySelector('.modal').scrollTop = 0;
}

// Stejná pravidla jako na serveru (api/_shop.js) — tady jen pro rychlou zpětnou vazbu.
const RULES = {
  f_jmeno: x => /^[\p{L}\p{M}' .-]{1,60}$/u.test(x),
  f_prijmeni: x => /^[\p{L}\p{M}' .-]{1,60}$/u.test(x),
  f_email: x => /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}$/.test(x),
  f_telefon: x => /^\+?[0-9 ]{9,19}$/.test(x),
  f_ulice: x => x.length >= 3 && x.length <= 120,
  f_mesto: x => x.length >= 2 && x.length <= 80,
  f_psc: x => /^\d{3} ?\d{2}$/.test(x),
};
function goToStep2() {
  let ok = true;
  Object.entries(RULES).forEach(([id, rule]) => {
    const bad = !rule(v(id));
    $(id).classList.toggle('error', bad);
    if (bad) ok = false;
  });
  if (!ok) { showNotification('Zkontrolujte prosím zvýrazněná pole'); return; }
  renderShippingOptions();
  goToStep(2);
  renderOrderSummary('orderSummaryStep2');
}

function renderShippingOptions() {
  const country = v('f_zeme');
  const vOnly = onlyVouchers();
  const allowed = s => (vOnly ? !!s.voucherOnly : !s.voucherOnly && s.country === country);
  if (selectedShipping && !(SHIPPING[selectedShipping] && allowed(SHIPPING[selectedShipping]))) selectedShipping = null;
  $('shippingOptions').innerHTML = Object.entries(SHIPPING)
    .filter(([, s]) => allowed(s))
    .map(([key, s]) => {
      const m = SHIP_META[key] || { desc:'' };
      return `<div class="opt ${selectedShipping === key ? 'selected' : ''}" data-action="selectShipping" data-arg="${esc(key)}">
        <div class="opt-radio"></div>
        <div class="opt-info"><div class="opt-name">${esc(s.name)}</div><div class="opt-desc">${esc(m.desc)}</div></div>
        <div class="opt-price">${shipPriceFor(key) === 0 ? 'Zdarma' : kc(shipPriceFor(key))}</div></div>`;
    }).join('');
  $('btnStep2Next').disabled = !selectedShipping;
}
function selectShipping(key) {
  if (!SHIPPING[key]) return;
  selectedShipping = key;
  renderShippingOptions();
  renderOrderSummary('orderSummaryStep2');
}
function goToStep3() {
  if (!selectedShipping) return;
  goToStep(3);
  renderOrderSummary('orderSummaryStep3');
  // když zbývá jediná platba, rovnou ji vybereme
  const onlyPay = ['card', 'transfer'].filter(k => SHOP.payments[k] !== false);
  if (onlyPay.length === 1 && !selectedPayment && $('pay_' + onlyPay[0])) selectPayment(onlyPay[0]);
}
function selectPayment(type) {
  if (type !== 'card' && type !== 'transfer') return;
  selectedPayment = type;
  document.querySelectorAll('#step3 .opt').forEach(o => o.classList.remove('selected'));
  $('pay_' + type).classList.add('selected');
  $('btnStep3Next').disabled = false;
}
function goToStep4() {
  if (!selectedPayment) return;
  $('reviewContact').innerHTML =
    `${esc(v('f_jmeno'))} ${esc(v('f_prijmeni'))}<br>${esc(v('f_email'))} · ${esc(v('f_telefon'))}<br>${esc(v('f_ulice'))}, ${esc(v('f_psc'))} ${esc(v('f_mesto'))}, ${v('f_zeme') === 'SK' ? 'Slovensko' : 'Česká republika'}`
    + (v('f_poznamka') ? `<br><em>Poznámka: ${esc(v('f_poznamka'))}</em>` : '');
  $('reviewShipping').textContent = SHIPPING[selectedShipping].name + ' (' + (shipPrice() === 0 ? 'zdarma' : kc(shipPrice())) + ')';
  $('reviewPayment').textContent = selectedPayment === 'card' ? 'Platební karta online' : 'Bankovní převod předem';
  renderOrderSummary('orderSummaryFinal');
  goToStep(4);
}

function renderOrderSummary(containerId) {
  const items = cartLines().map(l =>
    `<div class="order-summary-item"><span>${esc(l.p.name)} × ${l.qty}</span><span>${kc(l.p.price * l.qty)}</span></div>`).join('');
  const ship = selectedShipping ? `<div class="order-summary-item"><span>Doprava</span><span>${shipPrice() === 0 ? 'zdarma' : kc(shipPrice())}</span></div>` : '';
  const wrap = wrapPrice() ? `<div class="order-summary-item"><span>${esc(GIFT_WRAP.name)}</span><span>${kc(wrapPrice())}</span></div>` : '';
  const cdisc = couponDiscount() ? `<div class="order-summary-item"><span>Slevový kód ${esc(appliedCoupon.code)}</span><span>−${kc(couponDiscount())}</span></div>` : '';
  const disc = discount() ? `<div class="order-summary-item"><span>Dárkový poukaz</span><span>−${kc(discount())}</span></div>` : '';
  if (containerId === 'orderSummaryFinal') $('couponReview').hidden = onlyVouchers();
  if (containerId === 'orderSummaryFinal' && selectedShipping) {
    $('reviewShipping').textContent = SHIPPING[selectedShipping].name + ' (' + (shipPrice() === 0 ? 'zdarma' : kc(shipPrice())) + ')';
  }
  const freeNote = onlyVouchers() ? '' : `<div class="free-ship free-ship-in">${freeShipHtml()}</div>`;
  $(containerId).innerHTML = freeNote + items + ship + wrap + cdisc + disc +
    `<div class="order-summary-total"><span>Celkem k úhradě</span><span>${kc(Math.max(0, getCartSubtotal() + shipPrice() + wrapPrice() - couponDiscount() - discount()))}</span></div>`;
}

let submitting = false;
async function confirmOrder() {
  if (submitting) return;
  const souhlas = $('f_souhlas');
  $('consentWrap').classList.toggle('error', !souhlas.checked);
  if (!souhlas.checked) { showNotification('Potvrďte prosím souhlas s obchodními podmínkami'); return; }

  submitting = true;
  const btn = $('btnConfirm');
  btn.disabled = true; btn.textContent = 'Zpracovávám…';
  if (selectedPayment === 'card') goToStep('Loading');

  try {
    // Server dostane JEN id + počty kusů. Ceny, dopravu i číslo objednávky určí sám.
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        items: cart.map(i => ({ id:i.id, qty:i.qty })),
        shipping: selectedShipping,
        payment: selectedPayment,
        website: $('f_website').value, // honeypot
        giftWrap: wrapPrice() > 0,
        giftMessage: wrapPrice() > 0 ? $('f_wrapMsg').value.trim() : '',
        voucherCode: appliedVoucher ? appliedVoucher.code : '',
        couponCode: couponDiscount() > 0 ? appliedCoupon.code : '',
        customer: {
          jmeno: v('f_jmeno'), prijmeni: v('f_prijmeni'), email: v('f_email'), telefon: v('f_telefon'),
          ulice: v('f_ulice'), mesto: v('f_mesto'), psc: v('f_psc'), zeme: v('f_zeme'), poznamka: v('f_poznamka'),
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Objednávku se nepodařilo odeslat');

    if (selectedPayment === 'card') {
      if (!/^https:\/\/checkout\.stripe\.com\//.test(data.url || '')) throw new Error('Neplatná odpověď platební brány');
      window.location.assign(data.url);
      return;
    }
    showSuccess(data);
  } catch (err) {
    showNotification(err.message);
    goToStep(4);
  } finally {
    submitting = false;
    btn.disabled = false; btn.textContent = '✓ Objednat s povinností platby';
  }
}

function showSuccess(data) {
  $('checkoutModal').classList.add('open');
  const num = String(data.orderNumber || '').replace(/\D/g, '');
  $('successOrderNum').textContent = '#' + num;
  const wl = $('successWithdraw'); if (wl && /^\d{10}$/.test(num)) wl.href = '/odstoupeni?order=' + num;
  const bankBox = $('bankBox');
  bankBox.hidden = !data.bank;
  if (data.paidByVoucher) {
    $('successText').textContent = 'Objednávku jste celou zaplatili dárkovým poukazem. Potvrzení přijde na váš e-mail a brzy se ozvu ohledně odeslání.';
  } else if (data.bank) {
    const qr = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.bank.qr || '') ? data.bank.qr : '';
    bankBox.innerHTML = `<strong>Platební údaje</strong><br>Číslo účtu: ${esc(data.bank.account)}<br>IBAN: ${esc(data.bank.iban)}<br>Variabilní symbol: ${esc(num)}<br>Částka: ${kc(data.total)}`
      + (qr ? `<div class="bank-qr"><img src="${qr}" width="180" height="180" alt="QR kód pro platbu"><span>Naskenujte QR kód v aplikaci své banky, údaje se vyplní samy.</span></div>` : '');
    $('successText').textContent = 'Šperk odešlu, jakmile platba dorazí na účet. Platební údaje najdete i v potvrzovacím e-mailu.';
  } else {
    $('successText').textContent = 'Platba proběhla v pořádku. Potvrzení přijde na váš e-mail a brzy se ozvu ohledně odeslání.';
  }
  goToStep('Success');
  cart = []; cartChanged();
  selectedShipping = null; selectedPayment = null;
  appliedVoucher = null; $('f_voucher').value = ''; $('voucherMsg').textContent = '';
  appliedCoupon = null; $('f_coupon').value = ''; $('couponMsg').textContent = '';
  setGiftWrap(false); $('f_wrapMsg').value = ''; $('f_wrapMsg2').value = '';
  document.querySelectorAll('#step3 .opt').forEach(o => o.classList.remove('selected'));
  $('btnStep3Next').disabled = true;
  $('f_souhlas').checked = false;
}

// ─── HELPERS ───
let notifTimer;
function showNotification(msg) {
  const n = $('notification');
  n.textContent = msg; n.classList.add('show');
  clearTimeout(notifTimer); notifTimer = setTimeout(() => n.classList.remove('show'), 3200);
}

function renderShipGrid() {
  $('shipGrid').innerHTML = Object.entries(SHIPPING).filter(([, s]) => !s.voucherOnly).map(([key, s]) => `
    <div class="ship-card"><div class="ship-flag">${s.country === 'SK' ? 'Slovensko' : 'Česká republika'}</div>
    <h3>${esc(s.name)}</h3><p>${esc(SHIP_META[key]?.desc || '')}</p><span class="ship-price">${kc(s.price)}${s.freeFrom && freeShipOn() ? ` <small>zdarma od ${kc(FREE_SHIPPING_FROM)}</small>` : ''}</span></div>`).join('');
}

// ═══════════════════════════════════════
// UDÁLOSTI — jeden delegovaný posluchač místo inline onclick
// ═══════════════════════════════════════
const ACTIONS = {
  toggleCart, loadMore, collapseProducts, closePdetail, closeCheckout, startCheckout,
  goToStep2, goToStep3, goToStep4, confirmOrder,
  closeCartOutside: (arg, el, e) => { if (e.target === el) toggleCart(); },
  closePdetailOutside: (arg, el, e) => { if (e.target === el) closePdetail(); },
  slideGallery: arg => slideGallery(Number(arg)),
  openZoom, closeZoom,
  zoomSlide: (arg, el, e) => { e.stopPropagation(); zoomSlide(Number(arg)); },
  goToSlide: arg => goToSlide(Number(arg)),
  goToStep: arg => goToStep(Number(arg)),
  selectPayment: arg => selectPayment(arg),
  selectShipping: arg => selectShipping(arg),
  filterByCollection: arg => filterByCollection(arg),
  openProduct: arg => openProduct(arg),
  openReviews: arg => openProduct(arg, { reviews: true }),
  showReviewForm: () => showReviewForm(),
  setRating: (arg, el) => setRating(arg, el),
  scrollToReviews: () => scrollToReviews(),
  addToCart: (arg, el) => addToCart(arg, el),
  toggleWish: (arg, el) => toggleWish(arg, el),
  changeQty: arg => { const [i, d] = arg.split(':').map(Number); changeQty(i, d); },
  removeFromCart: arg => removeFromCart(Number(arg)),
  applyVoucher, applyCoupon,
};
$('f_wrap').addEventListener('change', e => setGiftWrap(e.target.checked));
$('f_wrap2').addEventListener('change', e => setGiftWrap(e.target.checked));
// vzkaz je jeden, zadat ho jde v košíku i ve shrnutí
$('f_wrapMsg').addEventListener('input', e => { $('f_wrapMsg2').value = e.target.value; });
$('f_wrapMsg2').addEventListener('input', e => { $('f_wrapMsg').value = e.target.value; });
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn(el.dataset.arg ?? '', el, e);
});
$('filterTabs').addEventListener('click', e => {
  const t = e.target.closest('.filter-tab'); if (t) setCategory(t.dataset.cat);
});
document.querySelectorAll('[data-filter]').forEach(a => a.addEventListener('click', () => {
  filter.collection = ''; setCategory(a.dataset.filter);
}));
$('newsletterForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target, btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const r = await fetch('/api/newsletter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('nlEmail').value, website: form.elements.website?.value || '' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Přihlášení se nepovedlo, zkuste to prosím znovu.');
    form.reset();
    showNotification('Děkuji, přihlášení k odběru proběhlo.');
  } catch (err) {
    showNotification(err.message);
  } finally {
    btn.disabled = false;
  }
});
document.addEventListener('keydown', e => {
  const detailOpen = $('pdetailOverlay').classList.contains('open');
  const zoomOpen = !$('pzoom').hidden;
  if (e.key === 'Escape') { if (closeZoom()) return; closePdetail(); closeCheckout(); $('cartOverlay').classList.remove('open'); }
  if (zoomOpen && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { zoomSlide(e.key === 'ArrowRight' ? 1 : -1); return; }
  if (detailOpen && e.key === 'ArrowRight') slideGallery(1);
  if (detailOpen && e.key === 'ArrowLeft') slideGallery(-1);
});

// Návrat ze Stripe — „děkujeme“ jen když server potvrdí zaplacení
(async () => {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('order');
  if (!state) return;
  history.replaceState(null, '', location.pathname);
  if (state === 'cancel') { showNotification('Platba byla zrušena.'); return; }
  const sessionId = params.get('session_id') || '';
  if (state !== 'success' || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return;
  try {
    const res = await fetch('/api/verify-payment?session_id=' + encodeURIComponent(sessionId));
    const data = await res.json();
    if (!data.paid) { showNotification('Platbu se nepodařilo ověřit. Napište mi prosím na postmaster@sagaart.cz.'); return; }
    showSuccess({ orderNumber: data.orderNumber });
  } catch {
    showNotification('Platbu se nepodařilo ověřit. Napište mi prosím na postmaster@sagaart.cz.');
  }
})();

// ─── PRAVIDLA OBCHODU V STRÁNCE (ceny, poukazy, platby, dovolená) ───
function voucherCardHtml(v) {
  const label = 'Dárkový poukaz ' + v.toLocaleString('cs-CZ') + ' Kč';
  const card = BAKED_VOUCHERS.includes(v)
    ? `<img src="/img/poukaz-${v}.jpg" width="1200" height="667" alt="${esc(label)}">`
    : `<span class="vcard" role="img" aria-label="${esc(label)}"><i class="vc-brand">SÁGA ART</i><b class="vc-title">Dárkový poukaz</b><em class="vc-sub">Na šperk podle vlastního výběru</em><i class="vc-lbl">HODNOTA POUKAZU</i><b class="vc-val">${esc(v.toLocaleString('cs-CZ'))} <small>Kč</small></b><i class="vc-l1">Kód poukazu</i><i class="vc-l2">Platí do</i><i class="vc-foot">Uplatnění v pokladně na sagaart.cz</i></span>`;
  return `<button type="button" class="voucher-card" data-action="addToCart" data-arg="voucher-${v}">${card}<span class="voucher-add">Do košíku</span></button>`;
}
function applyRules() {
  // poukazy
  const sec = $('poukazy');
  if (sec) {
    sec.hidden = !SHOP.vouchers.on;
    const grid = sec.querySelector('.vouchers-grid');
    if (grid && SHOP.vouchers.on) grid.innerHTML = SHOP.vouchers.values.map(voucherCardHtml).join('');
  }
  // platby
  ['card', 'transfer'].forEach(k => { const el = $('pay_' + k); if (el) el.hidden = SHOP.payments[k] === false; });
  if (selectedPayment && SHOP.payments[selectedPayment] === false) selectedPayment = null;
  // čísla v textech (zůstanou v pořádku, když se změní v administraci)
  const free = FREE_SHIPPING_FROM > 0;
  const minShip = Math.min(...Object.values(SHIPPING).filter(x => !x.voucherOnly).map(x => x.price));
  document.querySelectorAll('[data-rule]').forEach(el => {
    const k = el.dataset.rule;
    if (k === 'free-from') el.textContent = FREE_SHIPPING_FROM.toLocaleString('cs-CZ');
    if (k === 'ship-min' && Number.isFinite(minShip)) el.textContent = String(minShip);
    if (k === 'v-months') el.textContent = monthsText(SHOP.vouchers.months);
  });
  document.querySelectorAll('[data-rule-block="free"]').forEach(el => { el.hidden = !free; });
  // dovolená: pruh nahoře
  const bar = $('vacationBar');
  if (bar) { bar.hidden = !SHOP.vacation.on; bar.textContent = SHOP.vacation.on ? SHOP.vacation.message : ''; }
}

// ─── NAČTENÍ KATALOGU ───
async function loadCatalog() {
  try {
    const res = await fetch('/api/products-public');
    if (!res.ok) throw new Error('API ' + res.status);
    const data = await res.json();
    PRODUCTS = Array.isArray(data.products) ? data.products : [];
    if (data.shipping && typeof data.shipping === 'object') SHIPPING = data.shipping;
    if (data.giftWrap && Number.isInteger(data.giftWrap.price)) { GIFT_WRAP = data.giftWrap; SHOP.giftWrapOn = data.giftWrap.on !== false; }
    if (Number.isInteger(data.freeShippingFrom) && data.freeShippingFrom >= 0) FREE_SHIPPING_FROM = data.freeShippingFrom;
    if (data.vouchers && Array.isArray(data.vouchers.values)) SHOP.vouchers = data.vouchers;
    if (data.payments) SHOP.payments = data.payments;
    if (data.vacation) SHOP.vacation = data.vacation;
    if (Array.isArray(data.collections) && data.collections.length) {
      const old = COLLECTIONS;
      COLLECTIONS = Object.fromEntries(data.collections.map(c => [c.name, { cover: c.cover || '', desc: c.desc || '', ph1: old[c.name]?.ph1 || '#f4f1f1', ph2: old[c.name]?.ph2 || '#d6cdcf', gem: old[c.name]?.gem || '' }]));
    }
  } catch {
    // Lokální náhled bez serveru — ukázková data (objednat z nich nejde)
    const res = await fetch('/data/products.json').catch(() => null);
    PRODUCTS = res && res.ok ? await res.json() : [];
  }
  PRODUCTS = PRODUCTS.map(p => ({ ...p, id: safeId(p.id), price: Number(p.price) || 0 }));
  buildVouchers();
  [...new Set(PRODUCTS.map(p => p.collection).filter(Boolean))].forEach(n => { if (!COLLECTIONS[n]) COLLECTIONS[n] = { cover:'', desc:'', ph1:'#f4f1f1', ph2:'#d6cdcf', gem:'' }; });
  applyRules();
  renderCollections();
  renderNavMenus();
  renderGrid();
  renderCart();
  renderShipGrid();
  loadReviewSummary();
  const wanted = new URLSearchParams(location.search).get('produkt');
  if (wanted) {
    const write = new URLSearchParams(location.search).get('recenze') === '1';
    history.replaceState(null, '', location.pathname); openProduct(safeId(wanted), { write });
  }
}

renderShipGrid();
loadCatalog();
