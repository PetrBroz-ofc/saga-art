'use strict';
// Sága Art — obchod. Žádné inline handlery (kvůli přísné CSP): kliky jdou přes data-action.

// ── Escapování proti XSS — každá dynamická hodnota v innerHTML jde přes esc() ──
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const safeId = s => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '');
// Obrázky jen z https nebo z vlastní složky /img/ (žádné javascript:/data: URL)
const safeUrl = u => /^(https:\/\/[^\s"'<>]+|\/img\/[A-Za-z0-9_\/.-]+\.(jpe?g|png|webp))$/.test(String(u || '')) ? String(u) : '';
const kc = n => (Number(n) || 0).toLocaleString('cs-CZ') + ' Kč';
const $ = id => document.getElementById(id);

// Doprava — jen pro zobrazení. Ceny při objednávce počítá server (api/_shop.js).
let SHIPPING = {
  zasilkovna: { name:'Zásilkovna, výdejní místo nebo Z-BOX', price:109, country:'CZ' },
  balikovna:  { name:'Česká pošta, Balíkovna',            price:109, country:'CZ' },
  posta:      { name:'Česká pošta na adresu',            price:130, country:'CZ' },
  packeta_sk: { name:'Packeta na Slovensko',                price:130, country:'SK' },
};
const HEART = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>';
const BAG = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>';

const SHIP_META = {
  zasilkovna: { desc:'Doručení na výdejní místo Zásilkovny nebo do Z-BOXu' },
  balikovna:  { desc:'Vyzvednutí na pobočce Balíkovny' },
  posta:      { desc:'Doručení až domů' },
  packeta_sk: { desc:'Výdejní místo nebo Z-BOX na Slovensku' },
};

// Kolekce — barvy placeholderů odpovídají kamenům
// Pořadí = pořadí na webu. cover = titulní fotka (šperk na těle působí víc než stojánek).
const COLLECTIONS = {
  Charlotte: { cover:'/img/produkty/charlotte-nahrdelnik/1.jpg', desc:'Jemný amazonit, pravé říční perly a čtyřlístek pro štěstí.', ph1:'#e3f1ec', ph2:'#a7cfc1', gem:'#9cc9b9' },
  Euforie:   { cover:'/img/produkty/euforie-gold-long/1.jpg', desc:'Drobné říční perly a zlatá ocel. Šperky na každý den, které se krásně vrství.', ph1:'#fbf3e4', ph2:'#e6cf9f', gem:'' },
  'Moře':    { cover:'/img/produkty/more-kvet-nahrdelnik/1.jpg', desc:'Světle modrý akvamarín a říční perly v barvách mořské hladiny.', ph1:'#e5f0f5', ph2:'#a9c8d8', gem:'#a3c8da' },
  Duna:      { cover:'/img/produkty/duna-nahrdelnik/1.jpg', desc:'Výrazný zlatý řetízek, krémové perly a světlý amazonit se stromem života.', ph1:'#f7f0e1', ph2:'#d9c9a0', gem:'#c9dccf' },
  Pure:      { cover:'/img/produkty/pure-nahrdelnik/1.jpg', desc:'Nepravidelné říční perly s jemnými nerezovými detaily.', ph1:'#fbf1ef', ph2:'#e8c9c6', gem:'' },
  Best:      { cover:'/img/produkty/best-harmonie/1.jpg', desc:'Amazonit z Peru, říční perly a perleťové srdce.', ph1:'#e8f2ec', ph2:'#b6d3c2', gem:'#a9cdb9' },
  Pearl:     { cover:'/img/produkty/silver-pearl/1.jpg', desc:'Vrstvené perlové náhrdelníky v kombinaci se stříbřitou ocelí.', ph1:'#f4f1f1', ph2:'#d6cdcf', gem:'' },
};
const CAT_LABELS = { nahrdelniky:'Náhrdelníky', nausnice:'Náušnice', naramky:'Náramky', soupravy:'Sety' };

let PRODUCTS = [];

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

function renderGrid() {
  const grid = $('productsGrid');
  const list = filteredProducts();
  if (!list.length) {
    grid.innerHTML = '<p class="grid-empty">Žádné šperky k zobrazení.</p>';
  } else {
    grid.innerHTML = list.slice(0, visibleCount).map(p => {
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
        + '<p class="product-material">' + esc(p.material) + '</p>'
        + '<div class="product-bottom"><span class="product-price">' + kc(p.price) + '</span>'
        + '<button class="product-add" data-action="addToCart" data-arg="' + id + '" aria-label="Přidat ' + esc(p.name) + ' do košíku">' + BAG + '<span>Do košíku</span></button>'
        + '</div></div></div>';
    }).join('');
  }
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
function loadMore() { visibleCount += PAGE_SIZE; renderGrid(); }
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

function openProduct(id) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!p) return;
  const valid = (Array.isArray(p.imgs) ? p.imgs : []).map(safeUrl).filter(Boolean);
  const imgs = valid.length ? valid : [''];
  slideCount = imgs.length; currentSlide = 0;
  const slides = $('pdetailSlides');
  slides.style.transition = 'none'; slides.style.transform = 'translateX(0)';
  slides.innerHTML = imgs.map((src, i) => '<div class="pdetail-slide">'
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
    '<div class="pdetail-price">' + kc(p.price) + '</div>' +
    '<p class="pdetail-desc">' + esc(p.desc) + '</p>' +
    '<hr class="pdetail-divider"/>' +
    '<div class="pdetail-props">' + propsHtml + '</div>' +
    '<button class="pdetail-add-btn" data-action="addToCart" data-arg="' + safeId(p.id) + '">Přidat do košíku</button>';
  $('pdetailOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closePdetail() { $('pdetailOverlay').classList.remove('open'); document.body.style.overflow = ''; }
function slideGallery(dir) { currentSlide = (currentSlide + dir + slideCount) % slideCount; updateGallery(); }
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

const cartLines = () => cart.map(i => ({ ...i, p: PRODUCTS.find(p => p.id === i.id) })).filter(l => l.p);
const getCartSubtotal = () => cartLines().reduce((s, l) => s + l.p.price * l.qty, 0);

function toggleCart() { $('cartOverlay').classList.toggle('open'); }

function addToCart(id, btn) {
  const p = PRODUCTS.find(x => x.id === id);
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
  if (PRODUCTS.length) cart = cart.filter(i => PRODUCTS.some(p => p.id === i.id));
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
      <button class="cart-item-remove" data-action="removeFromCart" data-arg="${i}" aria-label="Odebrat">✕</button>
    </div>`).join('');
  $('cartSubtotal').textContent = kc(getCartSubtotal());
  $('cartTotal').textContent = kc(getCartSubtotal());
}

// ═══════════════════════════════════════
// OBJEDNÁVKA
// ═══════════════════════════════════════
const v = id => $(id).value.trim();
const shipPrice = () => selectedShipping ? SHIPPING[selectedShipping].price : 0;

function startCheckout() {
  if (!cartLines().length) return;
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
  if (selectedShipping && SHIPPING[selectedShipping]?.country !== country) selectedShipping = null;
  $('shippingOptions').innerHTML = Object.entries(SHIPPING)
    .filter(([, s]) => s.country === country)
    .map(([key, s]) => {
      const m = SHIP_META[key] || { desc:'' };
      return `<div class="opt ${selectedShipping === key ? 'selected' : ''}" data-action="selectShipping" data-arg="${esc(key)}">
        <div class="opt-radio"></div>
        <div class="opt-info"><div class="opt-name">${esc(s.name)}</div><div class="opt-desc">${esc(m.desc)}</div></div>
        <div class="opt-price">${kc(s.price)}</div></div>`;
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
  $('reviewShipping').textContent = SHIPPING[selectedShipping].name + ' (' + kc(shipPrice()) + ')';
  $('reviewPayment').textContent = selectedPayment === 'card' ? 'Platební karta online' : 'Bankovní převod předem';
  renderOrderSummary('orderSummaryFinal');
  goToStep(4);
}

function renderOrderSummary(containerId) {
  const items = cartLines().map(l =>
    `<div class="order-summary-item"><span>${esc(l.p.name)} × ${l.qty}</span><span>${kc(l.p.price * l.qty)}</span></div>`).join('');
  const ship = selectedShipping ? `<div class="order-summary-item"><span>Doprava</span><span>${kc(shipPrice())}</span></div>` : '';
  $(containerId).innerHTML = items + ship +
    `<div class="order-summary-total"><span>Celkem k úhradě</span><span>${kc(getCartSubtotal() + shipPrice())}</span></div>`;
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
  const bankBox = $('bankBox');
  bankBox.hidden = !data.bank;
  if (data.bank) {
    bankBox.innerHTML = `<strong>Platební údaje</strong><br>Číslo účtu: ${esc(data.bank.account)}<br>IBAN: ${esc(data.bank.iban)}<br>Variabilní symbol: ${esc(num)}<br>Částka: ${kc(data.total)}`;
    $('successText').textContent = 'Šperk odešlu, jakmile platba dorazí na účet. Platební údaje najdete i v potvrzovacím e-mailu.';
  } else {
    $('successText').textContent = 'Platba proběhla v pořádku. Potvrzení přijde na váš e-mail a brzy se ozvu ohledně odeslání.';
  }
  goToStep('Success');
  cart = []; cartChanged();
  selectedShipping = null; selectedPayment = null;
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
  $('shipGrid').innerHTML = Object.entries(SHIPPING).map(([key, s]) => `
    <div class="ship-card"><div class="ship-flag">${s.country === 'SK' ? 'Slovensko' : 'Česká republika'}</div>
    <h3>${esc(s.name)}</h3><p>${esc(SHIP_META[key]?.desc || '')}</p><span class="ship-price">${kc(s.price)}</span></div>`).join('');
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
  goToSlide: arg => goToSlide(Number(arg)),
  goToStep: arg => goToStep(Number(arg)),
  selectPayment: arg => selectPayment(arg),
  selectShipping: arg => selectShipping(arg),
  filterByCollection: arg => filterByCollection(arg),
  openProduct: arg => openProduct(arg),
  addToCart: (arg, el) => addToCart(arg, el),
  toggleWish: (arg, el) => toggleWish(arg, el),
  changeQty: arg => { const [i, d] = arg.split(':').map(Number); changeQty(i, d); },
  removeFromCart: arg => removeFromCart(Number(arg)),
};
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
$('newsletterForm').addEventListener('submit', e => {
  e.preventDefault(); e.target.reset();
  showNotification('Děkuji, jste přihlášená k odběru.');
});
document.addEventListener('keydown', e => {
  const detailOpen = $('pdetailOverlay').classList.contains('open');
  if (e.key === 'Escape') { closePdetail(); closeCheckout(); $('cartOverlay').classList.remove('open'); }
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
    if (!data.paid) { showNotification('Platbu se nepodařilo ověřit. Napište mi prosím na info@sagaart.cz.'); return; }
    showSuccess({ orderNumber: data.orderNumber });
  } catch {
    showNotification('Platbu se nepodařilo ověřit. Napište mi prosím na info@sagaart.cz.');
  }
})();

// ─── NAČTENÍ KATALOGU ───
async function loadCatalog() {
  try {
    const res = await fetch('/api/products-public');
    if (!res.ok) throw new Error('API ' + res.status);
    const data = await res.json();
    PRODUCTS = Array.isArray(data.products) ? data.products : [];
    if (data.shipping && typeof data.shipping === 'object') SHIPPING = data.shipping;
  } catch {
    // Lokální náhled bez serveru — ukázková data (objednat z nich nejde)
    const res = await fetch('/data/products.json').catch(() => null);
    PRODUCTS = res && res.ok ? await res.json() : [];
  }
  PRODUCTS = PRODUCTS.map(p => ({ ...p, id: safeId(p.id), price: Number(p.price) || 0 }));
  renderCollections();
  renderNavMenus();
  renderGrid();
  renderCart();
  renderShipGrid();
}

renderShipGrid();
loadCatalog();
