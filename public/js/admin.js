'use strict';
// Sága Art · administrace. Přehled, objednávky a šperky.
// Přihlášení drží HttpOnly cookie (JavaScript k ní nemá přístup, XSS ji neukradne).
// Všechno, co přijde ze serveru, jde do stránky přes esc() / safeUrl().

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const safeId = s => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '');
// Cloudinary nebo fotky uložené přímo na webu (/img/produkty/...)
const safeUrl = u => /^(https:\/\/res\.cloudinary\.com\/[^\s"'<>]+|\/img\/produkty\/[a-z0-9-]+\/\d+\.jpg)$/.test(String(u || '')) ? String(u) : '';
const $ = id => document.getElementById(id);
const icon = name => `<svg class="i"><use href="#i-${name}"/></svg>`;
const kc = n => (Number(n) || 0).toLocaleString('cs-CZ') + ' Kč';
const DAY = 864e5;

const CAT_LABELS = { nahrdelniky:'Náhrdelníky', nausnice:'Náušnice', naramky:'Náramky', soupravy:'Sety' };
const SHIPPING = { zasilkovna:'Zásilkovna', balikovna:'Balíkovna', posta:'Česká pošta', packeta_sk:'Packeta SK', email:'E-mailem (poukaz)' };
const PAY_LABELS = { card:'Kartou online', transfer:'Převodem předem', voucher:'Celé dárkovým poukazem' };
const INV_PAY = { card:'karta', transfer:'prevod', voucher:'poukaz' };
const INV_NUM_RE = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,19}$/;
const COUNTRIES = { CZ:'Česká republika', SK:'Slovensko' };
const STATUS = {
  awaiting_transfer: { label:'Čeká na převod', tone:'warn' },
  awaiting_payment:  { label:'Nedokončená platba', tone:'mute' },
  amount_mismatch:   { label:'Nesedí částka', tone:'bad' },
  paid:              { label:'K odeslání', tone:'info' },
  shipped:           { label:'Odesláno', tone:'ok' },
  cancelled:         { label:'Zrušeno', tone:'bad' },
};
const NEEDS_ACTION = ['paid', 'awaiting_transfer', 'amount_mismatch'];
const EARNED = ['paid', 'shipped'];
const MAX_IMGS = 10;
const MAX_FILE = 10 * 1024 * 1024;
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Ukázkový režim (smyšlená data) jen na localhostu a náhledových adresách Vercelu, nikdy na ostré doméně
const DEMO = /^(localhost|127\.0\.0\.1)$|\.vercel\.app$/.test(location.hostname)
  && new URLSearchParams(location.search).has('demo');

const state = {
  products: [], orders: [], ordersError: false, invoices: [], invoicesError: false, invoiceQuery: '',
  view: 'prehled', orderFilter: 'all', orderQuery: '',
  cat: '', collection: '', stock: '', productQuery: '',
  chartDays: 30,
};

// ── API ──
async function api(path, method = 'GET', body) {
  if (DEMO) return window.SA_DEMO.api(path, method, body);
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== '/api/auth') {
    toast('Přihlášení vypršelo, přihlaste se prosím znovu.', { err: true });
    showLogin();
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Chyba ' + res.status), { data });
  return data;
}

// ═══ PŘIHLÁŠENÍ ═══
// 1) jméno + heslo, 2) na novém zařízení kód z e-mailu (zařízení pak platí 30 dní)
function loginStep(step) {
  $('loginForm').hidden = step !== 'password';
  $('codeForm').hidden = step !== 'code';
  $('loginError').textContent = '';
  setTimeout(() => (step === 'code' ? $('loginCode') : $('loginUser').value ? $('loginPass') : $('loginUser')).focus(), 50);
}
function showLogin() {
  closeAllSheets();
  $('loginScreen').hidden = false;
  $('adminScreen').hidden = true;
  $('loginPass').value = '';
  $('loginCode').value = '';
  state.products = []; state.orders = [];
  loginStep('password');
}
function showAdmin() {
  $('loginScreen').hidden = true;
  $('adminScreen').hidden = false;
  $('demoBar').hidden = !DEMO;
  routeFromHash();
  loadAll();
}
function loginError(msg) {
  const err = $('loginError');
  err.classList.remove('shake');
  err.textContent = msg;
  void err.offsetWidth;
  err.classList.add('shake');
}

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('loginBtn');
  $('loginError').textContent = '';
  btn.disabled = true;
  try {
    const r = await api('/api/auth', 'POST', { username: $('loginUser').value.trim(), password: $('loginPass').value });
    $('loginPass').value = '';
    if (r.needCode) {
      $('codeEmail').textContent = r.email || 'váš e-mail';
      $('loginCode').value = '';
      loginStep('code');
    } else {
      showAdmin();
    }
  } catch (ex) {
    loginError(ex.message);
    $('loginPass').select();
  } finally {
    btn.disabled = false;
  }
});

$('codeForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('codeBtn');
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    await api('/api/auth', 'POST', { code: $('loginCode').value.trim() });
    showAdmin();
  } catch (ex) {
    $('loginCode').value = '';
    if (ex.data?.restart) { loginStep('password'); }
    loginError(ex.message);
  } finally {
    btn.disabled = false;
  }
});
// kód: jen číslice; po šesté rovnou odeslat
$('loginCode').addEventListener('input', e => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  if (e.target.value.length === 6) $('codeForm').requestSubmit();
});

async function logout(forget = false) {
  try { await api('/api/auth', 'DELETE', forget ? { forget: true } : {}); } catch {}
  showLogin();
}

// ═══ ZABEZPEČENÍ: ověřená zařízení ═══
async function openSecurity() {
  $('devicesList').innerHTML = '<div class="skel" style="height:68px"></div>';
  openSheet('securitySheet');
  try {
    const { devices } = await api('/api/auth?devices=1');
    $('devicesList').innerHTML = devices.length ? devices.map(d => `
      <div class="device">
        <span class="device-ico">${icon(/iPhone|Android/.test(d.label) ? 'phone' : 'laptop')}</span>
        <div>
          <b>${esc(d.label)} ${d.current ? '<span class="pill ok">toto zařízení</span>' : ''}</b>
          <small>naposledy ${esc(dateShort(d.lastUsedAt))} · ověřit znovu ${esc(new Date(d.expiresAt).toLocaleDateString('cs-CZ'))}</small>
        </div>
        <button class="btn btn-ghost btn-sm" data-action="revokeDevice" data-arg="${esc(safeId(d.id))}">Odebrat</button>
      </div>`).join('') : '<p class="empty-note">Žádné ověřené zařízení.</p>';
  } catch (err) {
    if (err.message !== 'unauthorized') $('devicesList').innerHTML = '<p class="empty-note">Seznam se nepodařilo načíst.</p>';
  }
}
async function revokeDevice(id) {
  if (!(await ask({ title: 'Odebrat zařízení?', text: 'Na tomhle zařízení se bude potřeba znovu přihlásit a ověřit kódem z e-mailu.', yes: 'Odebrat', danger: true }))) return;
  try {
    const r = await api('/api/auth', 'DELETE', { revoke: id });
    if (r.loggedOut) { showLogin(); toast('Toto zařízení je odebrané.'); return; }
    toast('Zařízení odebrané.');
    openSecurity();
  } catch (err) {
    if (err.message !== 'unauthorized') toast(err.message, { err: true });
  }
}

// ═══ DATA ═══
async function loadAll() {
  renderSkeletons();
  const [p, o, f] = await Promise.allSettled([api('/api/products'), api('/api/orders'), api('/api/invoices')]);
  if (p.status === 'rejected' && p.reason.message === 'unauthorized') return;
  state.products = p.status === 'fulfilled' && Array.isArray(p.value) ? p.value : [];
  state.orders = o.status === 'fulfilled' && Array.isArray(o.value) ? o.value : [];
  state.ordersError = o.status === 'rejected';
  state.invoices = f.status === 'fulfilled' && Array.isArray(f.value) ? f.value : [];
  state.invoicesError = f.status === 'rejected';
  if (p.status === 'rejected') toast('Šperky se nepodařilo načíst.', { err: true });
  renderAll();
}
async function reloadProducts() {
  try { state.products = await api('/api/products'); renderAll(); } catch {}
}

const productById = id => state.products.find(p => p.id === id);
const mainImg = p => safeUrl(Array.isArray(p?.imgs) ? p.imgs[0] : '');
const orderTime = o => Date.parse(o.paidAt || o.createdAt) || 0;
const fullName = c => `${c?.jmeno || ''} ${c?.prijmeni || ''}`.trim();
const initials = c => ((c?.jmeno || '?')[0] + ((c?.prijmeni || '')[0] || '')).toUpperCase();
function pill(status) {
  const s = STATUS[status] || { label: status || '—', tone: 'mute' };
  return `<span class="pill ${s.tone}">${esc(s.label)}</span>`;
}
function dateShort(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - new Date(d).setHours(0, 0, 0, 0)) / DAY);
  const time = d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return 'dnes ' + time;
  if (diff === 1) return 'včera ' + time;
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
const dateLong = iso => {
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString('cs-CZ', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
};

function renderAll() {
  const todo = state.orders.filter(o => NEEDS_ACTION.includes(o.status)).length;
  $('navOrderCount').hidden = !todo;
  $('navOrderCount').textContent = todo;
  $('tabOrderDot').hidden = !todo;
  renderDashboard();
  renderOrders();
  renderProducts();
  renderInvoices();
}

function renderSkeletons() {
  $('kpis').innerHTML = '<div class="skel" style="height:118px"></div>'.repeat(4);
  $('productsGrid').innerHTML = '<div class="skel" style="height:340px"></div>'.repeat(4);
  $('ordersList').innerHTML = '<div class="skel" style="height:300px;border-radius:0"></div>';
}

// ═══ NAVIGACE ═══
const VIEWS = ['prehled', 'objednavky', 'sperky', 'faktury'];
function setView(v, { push = true } = {}) {
  if (!VIEWS.includes(v)) v = 'prehled';
  state.view = v;
  document.querySelectorAll('.view').forEach(s => { s.hidden = s.dataset.view !== v; });
  document.querySelectorAll('.side-link[data-action="view"], .tab[data-action="view"]').forEach(b => {
    const on = b.dataset.arg === v;
    b.classList.toggle('is-on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (push && location.hash !== '#' + v) history.pushState(null, '', location.pathname + location.search + '#' + v);
  scrollTo(0, 0);
}
function routeFromHash() { setView(location.hash.slice(1) || 'prehled', { push: false }); }
addEventListener('popstate', routeFromHash);

// ═══ PŘEHLED ═══
function renderDashboard() {
  const now = new Date();
  const h = now.getHours();
  const [w1, w2] = h < 10 ? ['Dobré', 'ráno'] : h < 18 ? ['Dobrý', 'den'] : ['Dobrý', 'večer'];
  $('hPrehled').innerHTML = `${w1} <em>${w2}</em>`;
  $('todayLabel').textContent = now.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });

  const o = state.orders, p = state.products;
  const earned = o.filter(x => EARNED.includes(x.status));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const thisMonth = earned.filter(x => orderTime(x) >= monthStart).reduce((s, x) => s + x.total, 0);
  const prevMonth = earned.filter(x => orderTime(x) >= prevStart && orderTime(x) < monthStart).reduce((s, x) => s + x.total, 0);
  const toShip = o.filter(x => x.status === 'paid');
  const waiting = o.filter(x => x.status === 'awaiting_transfer');
  const inStock = p.filter(x => x.inStock !== false).length;
  const monthName = now.toLocaleDateString('cs-CZ', { month: 'long' });
  const prevName = new Date(prevStart).toLocaleDateString('cs-CZ', { month: 'long' });

  $('kpis').innerHTML = `
    <button class="kpi ${toShip.length ? 'hot' : ''}" data-action="ordersFilter" data-arg="paid">
      <span class="kpi-label">${icon('truck')}K odeslání</span>
      <span class="kpi-value">${toShip.length}</span>
      <span class="kpi-sub">${toShip.length ? 'zaplacené, čekají na zabalení' : 'všechno je odeslané'}</span>
    </button>
    <div class="kpi">
      <span class="kpi-label">${icon('card')}Tržby, ${esc(monthName)}</span>
      <span class="kpi-value num">${(thisMonth).toLocaleString('cs-CZ')}<small>Kč</small></span>
      <span class="kpi-sub">${esc(prevName)} celkem ${kc(prevMonth)}</span>
    </div>
    <button class="kpi" data-action="ordersFilter" data-arg="awaiting_transfer">
      <span class="kpi-label">${icon('bank')}Čeká na platbu</span>
      <span class="kpi-value">${waiting.length}</span>
      <span class="kpi-sub">${waiting.length ? 'převodem, celkem ' + kc(waiting.reduce((s, x) => s + x.total, 0)) : 'žádný převod nečeká'}</span>
    </button>
    <button class="kpi" data-action="productsStock" data-arg="${inStock < p.length ? 'out' : ''}">
      <span class="kpi-label">${icon('gem')}Šperky skladem</span>
      <span class="kpi-value">${inStock}<small>/ ${p.length}</small></span>
      <span class="kpi-sub">${p.length - inStock ? (p.length - inStock) + ' prodáno' : 'nic není vyprodané'}</span>
    </button>`;

  renderChart();
  renderTodo(toShip, waiting);

  const recent = o.slice(0, 5);
  $('recentOrders').innerHTML = state.ordersError
    ? '<p class="empty-note">Objednávky se nepodařilo načíst.</p>'
    : recent.length ? recent.map(x => `
      <button class="mini-order" data-action="openOrder" data-arg="${esc(x.number)}">
        <span class="avatar">${esc(initials(x.customer))}</span>
        <span><b>${esc(fullName(x.customer))}</b><small>č. ${esc(x.number)} · ${esc(dateShort(x.createdAt))}</small></span>
        <span class="end">${kc(x.total)}${pill(x.status)}</span>
      </button>`).join('')
    : '<p class="empty-note">Zatím žádná objednávka. První přijde brzy.</p>';

  const sold = new Map();
  earned.forEach(x => x.lines.forEach(l => sold.set(l.id, { name: l.name, qty: (sold.get(l.id)?.qty || 0) + l.qty })));
  const top = [...sold.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 5);
  const maxQty = top[0]?.[1].qty || 1;
  $('topProducts').innerHTML = top.length ? top.map(([id, t]) => {
    const prod = productById(id), img = mainImg(prod);
    return `<li>
      ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
      <div><b>${esc(prod?.name || t.name)}</b><div class="top-bar"><i style="width:${Math.round(t.qty / maxQty * 100)}%"></i></div></div>
      <span class="qty">${t.qty}&times;</span>
    </li>`;
  }).join('') : '<li class="empty-note">Až se něco prodá, uvidíte tady pořadí.</li>';
}

function renderTodo(toShip, waiting) {
  const items = [];
  const mismatch = state.orders.filter(x => x.status === 'amount_mismatch');
  if (mismatch.length) items.push(['alert', `${mismatch.length}× nesedí zaplacená částka`, 'Zkontrolujte platbu ve Stripe', 'ordersFilter', 'amount_mismatch']);
  if (toShip.length) {
    const oldest = Math.max(...toShip.map(x => Math.floor((Date.now() - orderTime(x)) / DAY)));
    items.push(['truck', `Zabalit a odeslat: ${toShip.length} ${plural(toShip.length, 'objednávka', 'objednávky', 'objednávek')}`, oldest > 0 ? `nejstarší čeká ${oldest} ${plural(oldest, 'den', 'dny', 'dní')}` : 'zaplaceno dnes', 'ordersFilter', 'paid']);
  }
  if (waiting.length) {
    const old = waiting.filter(x => Date.now() - Date.parse(x.createdAt) > 7 * DAY).length;
    items.push(['bank', `Zkontrolovat účet: ${waiting.length} ${plural(waiting.length, 'převod', 'převody', 'převodů')}`, old ? `${old} čeká déle než týden` : 'porovnejte variabilní symbol', 'ordersFilter', 'awaiting_transfer']);
  }
  const noPhoto = state.products.filter(x => !mainImg(x)).length;
  if (noPhoto) items.push(['img', `${noPhoto} ${plural(noPhoto, 'šperk nemá', 'šperky nemají', 'šperků nemá')} fotku`, 'bez fotky se špatně prodává', 'view', 'sperky']);
  const sold = state.products.filter(x => x.inStock === false).length;
  if (sold) items.push(['gem', `Prodáno: ${sold} ${plural(sold, 'šperk', 'šperky', 'šperků')}`, 'na webu jsou vidět, ale koupit nejdou', 'productsStock', 'out']);

  $('todo').innerHTML = items.length ? items.map(([ic, title, sub, action, arg]) => `
    <li><button class="todo-item" data-action="${action}" data-arg="${esc(arg)}">
      <span class="todo-ico">${icon(ic)}</span>
      <span><b>${esc(title)}</b><small>${esc(sub)}</small></span>
      ${icon('right')}
    </button></li>`).join('')
    : `<li class="todo-empty">${icon('check')} Všechno je vyřízené. Hezký den!</li>`;
}
const plural = (n, one, few, many) => n === 1 ? one : n >= 2 && n <= 4 ? few : many;

// Graf tržeb po dnech (SVG, jen čísla, žádný text od zákaznic)
function renderChart() {
  const days = state.chartDays;
  const end = new Date(); end.setHours(0, 0, 0, 0);
  const start = end.getTime() - (days - 1) * DAY;
  const buckets = Array.from({ length: days }, () => ({ sum: 0, n: 0 }));
  state.orders.filter(o => EARNED.includes(o.status)).forEach(o => {
    const t = new Date(orderTime(o)); t.setHours(0, 0, 0, 0);
    const i = Math.round((t - start) / DAY);
    if (i >= 0 && i < days) { buckets[i].sum += o.total; buckets[i].n++; }
  });
  const total = buckets.reduce((s, b) => s + b.sum, 0);
  const count = buckets.reduce((s, b) => s + b.n, 0);
  $('chartSum').textContent = `${kc(total)} · ${count} ${plural(count, 'objednávka', 'objednávky', 'objednávek')}`;

  const W = 600, H = 200, padB = 22, padT = 8;
  const max = Math.max(1000, ...buckets.map(b => b.sum));
  const nice = Math.ceil(max / 1000) * 1000;
  const bw = W / days;
  const gap = Math.min(4, bw * .25);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Tržby po dnech">`;
  [0, .5, 1].forEach(f => {
    const y = padT + (H - padB - padT) * (1 - f);
    svg += `<line class="grid" x1="0" x2="${W}" y1="${y}" y2="${y}"/>`;
  });
  buckets.forEach((b, i) => {
    const h = b.sum ? Math.max(3, (H - padB - padT) * b.sum / nice) : 2;
    const x = i * bw + gap / 2, y = H - padB - h;
    svg += `<rect class="hit" data-i="${i}" x="${i * bw}" y="0" width="${bw}" height="${H - padB}" fill="transparent"/>`;
    svg += `<rect class="bar ${b.sum ? 'has' : ''}" data-i="${i}" x="${x}" y="${y}" width="${bw - gap}" height="${h}" rx="${Math.min(3, (bw - gap) / 2)}"/>`;
  });
  svg += '</svg>';
  const labelEvery = days > 40 ? 14 : 7;
  let axis = '<div class="chart-axis">';
  for (let i = days - 1; i >= 0; i -= labelEvery) {
    const d = new Date(start + i * DAY);
    axis += `<span style="left:${(i + .5) / days * 100}%">${d.getDate()}.${d.getMonth() + 1}.</span>`;
  }
  axis += '</div>';
  $('chart').innerHTML = svg + axis + '<div class="chart-tip" id="chartTip"></div>';
  $('chart').dataset.start = start;
  chartBuckets = buckets;
}
let chartBuckets = [];
$('chart').addEventListener('pointermove', e => {
  const r = e.target.closest('rect[data-i]');
  const tip = $('chartTip');
  if (!r || !tip) { tip?.classList.remove('show'); return; }
  const i = Number(r.dataset.i), b = chartBuckets[i];
  const d = new Date(Number($('chart').dataset.start) + i * DAY);
  const box = $('chart').getBoundingClientRect(), rb = r.getBoundingClientRect();
  tip.innerHTML = `<b>${kc(b.sum)}</b>${esc(d.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' }))} · ${b.n} obj.`;
  tip.style.left = (rb.left - box.left + rb.width / 2) + 'px';
  tip.style.top = Math.min(box.height - 30, Math.max(40, e.clientY - box.top)) + 'px';
  tip.classList.add('show');
});
$('chart').addEventListener('pointerleave', () => $('chartTip')?.classList.remove('show'));

// ═══ OBJEDNÁVKY ═══
const ORDER_FILTERS = [
  ['all', 'Všechny', () => true],
  ['paid', 'K odeslání', o => o.status === 'paid'],
  ['awaiting_transfer', 'Čeká na převod', o => o.status === 'awaiting_transfer'],
  ['shipped', 'Odeslané', o => o.status === 'shipped'],
  ['amount_mismatch', 'Nesedí částka', o => o.status === 'amount_mismatch', true],
  ['awaiting_payment', 'Nedokončené', o => o.status === 'awaiting_payment', true],
  ['cancelled', 'Zrušené', o => o.status === 'cancelled', true],
];

function renderOrders() {
  const o = state.orders;
  $('orderFilters').innerHTML = ORDER_FILTERS.map(([key, label, fn, hideEmpty]) => {
    const n = o.filter(fn).length;
    if (hideEmpty && !n && state.orderFilter !== key) return '';
    return `<button class="chip ${state.orderFilter === key ? 'is-on' : ''}" role="tab" aria-selected="${state.orderFilter === key}" data-action="ordersFilter" data-arg="${key}">${esc(label)} <b>${n}</b></button>`;
  }).join('');

  const fn = (ORDER_FILTERS.find(f => f[0] === state.orderFilter) || ORDER_FILTERS[0])[2];
  const q = state.orderQuery.toLowerCase();
  const list = o.filter(fn).filter(x => !q
    || x.number.includes(q)
    || fullName(x.customer).toLowerCase().includes(q)
    || (x.customer.email || '').includes(q));

  if (state.ordersError) {
    $('ordersList').innerHTML = `<div class="list-empty"><p class="big">Objednávky se nenačetly</p><p>Zkuste stránku obnovit. Když to nepomůže, ozvěte se správci webu.</p></div>`;
    return;
  }
  if (!list.length) {
    $('ordersList').innerHTML = `<div class="list-empty"><p class="big">${o.length ? 'Nic tu není' : 'Zatím žádné objednávky'}</p><p>${o.length ? 'Zkuste jiný filtr nebo hledání.' : 'Jakmile někdo nakoupí, objednávka se objeví tady.'}</p></div>`;
    return;
  }
  $('ordersList').innerHTML = list.slice(0, 150).map((x, i) => {
    const imgs = x.lines.slice(0, 3).map(l => {
      const img = mainImg(productById(l.id));
      return img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<span class="ph"></span>';
    }).join('');
    const pieces = x.lines.reduce((s, l) => s + l.qty, 0);
    return `
    <button class="order-row" data-action="openOrder" data-arg="${esc(x.number)}" style="animation-delay:${Math.min(i, 12) * 25}ms">
      <span class="avatar">${esc(initials(x.customer))}</span>
      <span class="who"><b>${esc(fullName(x.customer))}</b><small>č. ${esc(x.number)}</small></span>
      <span class="items">${imgs}<span>${pieces} ks</span></span>
      <span class="when"><small>${esc(dateShort(x.createdAt))}</small></span>
      <span class="status">${pill(x.status)}</span>
      <span class="total">${kc(x.total)}<small>${icon(x.payment === 'card' ? 'card' : 'bank')}${{ card: 'kartou', transfer: 'převodem', voucher: 'poukazem' }[x.payment] || ''}</small></span>
      ${icon('right')}
    </button>`;
  }).join('');
}

let currentOrder = null;
function openOrder(number) {
  const o = state.orders.find(x => x.number === number);
  if (!o) return;
  currentOrder = number;
  const c = o.customer;
  const st = o.status;
  const cancelled = st === 'cancelled';
  const step = (label, at, done) => `<div class="step ${done ? (cancelled ? 'cancel' : 'done') : ''}"><b>${label}</b>${at ? esc(dateShort(at)) : '&nbsp;'}</div>`;
  const addr = [fullName(c), c.ulice, `${c.psc} ${c.mesto}`, COUNTRIES[c.zeme] || c.zeme].filter(Boolean);
  const track = trackingUrl(o);

  let actions = '';
  if (st === 'awaiting_transfer' || st === 'amount_mismatch') actions += `<button class="btn btn-ok" data-action="orderStatus" data-arg="paid">${icon('check')}Platba dorazila</button>`;
  if (st === 'paid') actions += `<button class="btn btn-dark" data-action="orderStatus" data-arg="shipped">${icon('truck')}Označit jako odeslané</button>`;
  if (st === 'shipped') actions += `<button class="btn btn-ghost" data-action="orderStatus" data-arg="paid">Vrátit mezi k odeslání</button>`;
  if (['awaiting_transfer', 'awaiting_payment', 'amount_mismatch', 'paid'].includes(st)) actions += `<button class="btn btn-ghost danger" data-action="orderStatus" data-arg="cancelled">Zrušit</button>`;

  $('orderBody').innerHTML = `
    <div class="od-head">
      <div class="od-top">
        <div><p class="eyebrow">Objednávka · ${esc(dateLong(o.createdAt))}</p><h2 id="orderTitle">č. ${esc(o.number)}</h2>${pill(st)}</div>
        <button class="icon-btn" data-action="closeSheet" aria-label="Zavřít">${icon('x')}</button>
      </div>
      <div class="steps">
        ${step('Objednáno', o.createdAt, true)}
        ${step(cancelled ? 'Zrušeno' : 'Zaplaceno', cancelled ? o.cancelledAt : o.paidAt, cancelled || ['paid', 'shipped'].includes(st))}
        ${step('Odesláno', cancelled ? null : o.shippedAt, !cancelled && st === 'shipped')}
      </div>
    </div>

    <section class="od-sec">
      <h3>Zákaznice</h3>
      <div class="od-cust">
        <span class="avatar">${esc(initials(c))}</span>
        <div>
          <b>${esc(fullName(c))}</b>
          <a href="mailto:${esc(c.email)}?subject=${encodeURIComponent('Objednávka č. ' + o.number)}">${esc(c.email)}</a><br>
          <a href="tel:${esc(String(c.telefon).replace(/\s/g, ''))}">${esc(c.telefon)}</a>
        </div>
      </div>
      <div class="addr">${addr.map(esc).join('<br>')}
        <button class="copy" data-action="copy" data-arg="${esc([...addr, c.telefon].join('\n'))}">${icon('copy')}Kopírovat</button>
      </div>
      ${c.poznamka ? `<div class="note-box"><b>Poznámka od zákaznice:</b> ${esc(c.poznamka)}</div>` : ''}
    </section>

    <section class="od-sec">
      <h3>Šperky</h3>
      <div class="od-lines">
        ${o.lines.map(l => {
          const img = mainImg(productById(l.id));
          return `<div class="od-line">${img ? `<img src="${esc(img)}" alt="">` : '<span class="ph"></span>'}
            <div><b>${esc(l.name)}</b><small>${l.qty} × ${kc(l.price)}</small></div>
            <span class="num">${kc(l.price * l.qty)}</span></div>`;
        }).join('')}
      </div>
      <dl class="sums">
        <dt>Zboží</dt><dd>${kc(o.subtotal)}</dd>
        <dt>Doprava · ${esc(SHIPPING[o.shipping] || o.shipping)}</dt><dd>${kc(o.shippingPrice)}</dd>
        ${o.giftWrap ? `<dt>Dárkové zabalení</dt><dd>${kc(o.giftWrapPrice)}</dd>` : ''}
        ${o.discount ? `<dt>Dárkový poukaz${o.voucherLast4 ? ' ···' + esc(o.voucherLast4) : ''}</dt><dd>−${kc(o.discount)}</dd>` : ''}
        <dt class="total">Celkem</dt><dd class="total">${kc(o.total)}</dd>
      </dl>
      ${o.giftWrap ? `<div class="note-box"><b>Zabalit jako dárek.</b>${o.giftMessage ? ' Vzkaz na kartičku: ' + esc(o.giftMessage) : ''}</div>` : ''}
      ${Array.isArray(o.vouchers) && o.vouchers.length ? `<div class="note-box"><b>Vydané poukazy:</b> ${o.vouchers.map(v => `${kc(v.value)} (kód končí ${esc(v.last4)})`).join(', ')}. Kódy odešly zákazníkovi e-mailem.</div>` : ''}
    </section>

    <section class="od-sec">
      <h3>Platba a doprava</h3>
      <dl class="kv">
        <dt>Platba</dt><dd>${esc(PAY_LABELS[o.payment] || o.payment)}</dd>
        <dt>Faktura</dt><dd>${o.invoiceNumber
          ? `<a class="link-btn" href="${esc(invoiceUrl(o.invoiceNumber))}" target="_blank" rel="noopener">č. ${esc(o.invoiceNumber)} ${icon('ext')}</a>`
          : ['paid', 'shipped'].includes(st) ? `<button class="link-btn" data-action="invoiceFromOrder" data-arg="${esc(o.number)}">${icon('doc')}Vystavit fakturu</button>` : '<span class="muted">až po zaplacení</span>'}</dd>
        ${o.payment === 'transfer' ? `<dt>Var. symbol</dt><dd><b class="num">${esc(o.number)}</b><button class="copy" data-action="copy" data-arg="${esc(o.number)}">${icon('copy')}Kopírovat</button></dd>` : ''}
        <dt>Doprava</dt><dd>${esc(SHIPPING[o.shipping] || o.shipping)}</dd>
        <dt>E-maily</dt><dd>${o.emailsSent ? 'potvrzení odešlo' : (st === 'awaiting_payment' ? 'pošlou se po zaplacení' : '<span class="pill warn">neodešly</span>')}</dd>
      </dl>
      ${['paid', 'shipped'].includes(st) ? `
      <label class="field" style="margin:18px 0 0">
        <span>Číslo zásilky ${track ? `<a class="link-btn" href="${esc(track)}" target="_blank" rel="noopener noreferrer">Sledovat ${icon('ext')}</a>` : ''}</span>
        <input type="text" id="odTracking" maxlength="40" value="${esc(o.tracking)}" placeholder="např. Z 123 4567 890" autocomplete="off">
      </label>` : ''}
    </section>

    <section class="od-sec">
      <h3>Vaše poznámka <small class="muted">vidíte ji jen vy</small></h3>
      <label class="field" style="margin:0"><textarea id="odNote" maxlength="1000" rows="3" placeholder="Třeba: přibalit vzorek, zákaznice chce dárkové balení…">${esc(o.adminNote)}</textarea></label>
      <button class="btn btn-ghost btn-sm" data-action="orderSaveNote" style="margin-top:10px">Uložit poznámku</button>
    </section>

    ${actions ? `<div class="od-actions">${actions}</div>` : ''}`;
  openSheet('orderSheet');
}

function trackingUrl(o) {
  const t = String(o.tracking || '').replace(/\s/g, '');
  if (!/^[A-Za-z0-9-]{5,40}$/.test(t)) return '';
  if (o.shipping === 'zasilkovna' || o.shipping === 'packeta_sk') return 'https://tracking.packeta.com/cs/?id=' + encodeURIComponent(t);
  return 'https://www.postaonline.cz/trackandtrace/-/zasilka/cislo?parcelNumbers=' + encodeURIComponent(t);
}

async function orderStatus(status) {
  const o = state.orders.find(x => x.number === currentOrder);
  if (!o) return;
  const body = { number: o.number, status };
  const tr = $('odTracking');
  if (status === 'shipped') {
    if (tr && tr.value.trim() !== o.tracking) body.tracking = tr.value.trim();
  }
  if (status === 'cancelled' && !(await ask({
    title: `Zrušit objednávku č. ${o.number}?`,
    text: o.status === 'paid' ? 'Objednávka je zaplacená. Peníze je potřeba vrátit zvlášť (ve Stripe nebo převodem).' : 'Zrušení už nejde vrátit.',
    yes: 'Zrušit objednávku', danger: true,
  }))) return;
  await patchOrder(body, {
    paid: 'Platba potvrzena. Objednávka čeká na odeslání.',
    shipped: 'Odesláno. Hezká práce!',
    cancelled: 'Objednávka zrušena.',
  }[status]);
}
async function orderSaveNote() {
  const body = { number: currentOrder, adminNote: $('odNote').value };
  const tr = $('odTracking');
  if (tr) body.tracking = tr.value.trim();
  await patchOrder(body, 'Uloženo.');
}
async function patchOrder(body, msg) {
  try {
    const updated = await api('/api/orders', 'PATCH', body);
    const i = state.orders.findIndex(x => x.number === updated.number);
    if (i >= 0) state.orders[i] = updated;
    renderAll();
    openOrder(updated.number);
    toast(msg);
  } catch (err) {
    if (err.message !== 'unauthorized') toast(err.message, { err: true });
  }
}

// ═══ ŠPERKY ═══
function renderProducts() {
  const p = state.products;
  const cats = [['', 'Vše'], ...Object.entries(CAT_LABELS)];
  $('catFilters').innerHTML = cats.map(([k, label]) =>
    `<button class="chip ${state.cat === k ? 'is-on' : ''}" data-action="productsCat" data-arg="${k}">${esc(label)} <b>${k ? p.filter(x => x.cat === k).length : p.length}</b></button>`).join('');

  const cols = [...new Set(p.map(x => x.collection).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs'));
  $('collectionFilter').innerHTML = '<option value="">Všechny kolekce</option>' + cols.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('collectionFilter').value = cols.includes(state.collection) ? state.collection : '';
  $('collectionList').innerHTML = cols.map(c => `<option value="${esc(c)}"></option>`).join('');
  $('stockFilter').value = state.stock;

  const q = state.productQuery.toLowerCase();
  const list = p.filter(x =>
    (!state.cat || x.cat === state.cat)
    && (!state.collection || x.collection === state.collection)
    && (!state.stock || (state.stock === 'in') === (x.inStock !== false))
    && (!q || [x.name, x.collection, x.material].join(' ').toLowerCase().includes(q)));

  const cards = list.map((x, i) => {
    const imgs = (x.imgs || []).map(safeUrl).filter(Boolean);
    const id = safeId(x.id);
    const sold = x.inStock === false;
    return `
    <article class="pcard ${sold ? 'sold' : ''}" style="animation-delay:${Math.min(i, 16) * 25}ms">
      <div class="pcard-media" data-action="editProduct" data-arg="${id}">
        ${imgs[0] ? `<img src="${esc(imgs[0])}" alt="" loading="lazy">` : `<span class="ph">${icon('img')}</span>`}
        ${imgs[1] ? `<img class="alt" src="${esc(imgs[1])}" alt="" loading="lazy">` : ''}
        ${x.badge ? `<span class="pcard-badge">${esc(x.badge)}</span>` : ''}
        ${imgs.length > 1 ? `<span class="pcard-count">${icon('img')}${imgs.length}</span>` : ''}
        <div class="pcard-tools">
          <button data-action="editProduct" data-arg="${id}" aria-label="Upravit">${icon('edit')}</button>
          <button data-action="dupProduct" data-arg="${id}" aria-label="Duplikovat">${icon('dup')}</button>
          <button class="danger" data-action="delProduct" data-arg="${id}" aria-label="Smazat">${icon('trash')}</button>
        </div>
      </div>
      <div class="pcard-body" data-action="editProduct" data-arg="${id}">
        <small>${esc(x.collection || CAT_LABELS[x.cat] || '')}</small>
        <b>${esc(x.name)}</b>
      </div>
      <div class="pcard-foot">
        <span class="pcard-price">${kc(x.price)}</span>
        <label class="stock-toggle"><input type="checkbox" class="switch" data-stock="${id}" ${sold ? '' : 'checked'}><span>${sold ? 'Prodáno' : 'Skladem'}</span></label>
      </div>
    </article>`;
  }).join('');

  $('productsGrid').innerHTML = (list.length || !p.length)
    ? `<button class="pcard-new" data-action="newProduct">${icon('plus')}<span>Přidat šperk</span></button>` + cards
    : `<div class="list-empty" style="grid-column:1/-1"><p class="big">Nic jsme nenašli</p><p>Zkuste jiné hledání nebo filtr.</p></div>`;
}

$('productsGrid').addEventListener('change', async e => {
  const input = e.target.closest('input[data-stock]');
  if (!input) return;
  const id = input.dataset.stock, inStock = input.checked;
  await setStock(id, inStock, true);
});
async function setStock(id, inStock, undoable) {
  const p = productById(id);
  if (!p) return;
  const before = p.inStock;
  p.inStock = inStock;
  renderAll();
  try {
    await api('/api/products', 'PATCH', { id, inStock });
    toast(`${p.name}: ${inStock ? 'zase skladem' : 'prodáno'}`, undoable ? { undo: () => setStock(id, !inStock, false) } : {});
  } catch (err) {
    p.inStock = before;
    renderAll();
    if (err.message !== 'unauthorized') toast('Nepovedlo se uložit: ' + err.message, { err: true });
  }
}

async function delProduct(id) {
  const p = productById(id);
  if (!p || !(await ask({
    title: `Smazat „${p.name}“?`,
    text: 'Šperk zmizí z e-shopu i z administrace. Když ho jen nemáte skladem, stačí vypnout „Skladem“.',
    yes: 'Smazat', danger: true,
  }))) return false;
  try {
    await api('/api/products', 'DELETE', { id });
    state.products = state.products.filter(x => x.id !== id);
    renderAll();
    toast('Smazáno.');
    return true;
  } catch (err) {
    if (err.message !== 'unauthorized') toast('Chyba při mazání: ' + err.message, { err: true });
    return false;
  }
}

// ═══ EDITOR ŠPERKU ═══
const ed = { id: null, cat: 'nahrdelniky', imgs: [], uploading: 0, snapshot: '' };

function openEditor(id, { duplicate = false } = {}) {
  const src = (id && productById(id)) || {};
  ed.id = duplicate ? null : (id || null);
  ed.cat = src.cat || 'nahrdelniky';
  ed.imgs = (Array.isArray(src.imgs) ? src.imgs : []).map(safeUrl).filter(Boolean);
  ed.uploading = 0;
  $('fName').value = duplicate ? (src.name || '') + ' (kopie)' : src.name || '';
  $('fPrice').value = src.price || '';
  $('fCollection').value = src.collection || '';
  $('fMaterial').value = src.material || '';
  $('fDesc').value = src.desc || '';
  $('fBadge').value = src.badge || '';
  $('fStock').checked = src.inStock !== false;
  $('editorEyebrow').textContent = ed.id ? 'Úprava šperku' : duplicate ? 'Kopie šperku' : 'Nový šperk';
  $('editorDelete').hidden = !ed.id;
  $('uploadProgress').textContent = '';
  renderCat(); renderPhotos(); renderPreview();
  ed.snapshot = editorJson();
  openSheet('productSheet');
}
const editorData = () => ({
  name: $('fName').value.trim(),
  price: Number($('fPrice').value),
  cat: ed.cat,
  collection: $('fCollection').value.trim(),
  material: $('fMaterial').value.trim(),
  desc: $('fDesc').value.trim(),
  imgs: ed.imgs,
  badge: $('fBadge').value.trim(),
  inStock: $('fStock').checked,
});
const editorJson = () => JSON.stringify(editorData());
const editorDirty = () => $('productSheet').classList.contains('open') && editorJson() !== ed.snapshot;

function renderCat() {
  $('fCat').querySelectorAll('.seg-btn').forEach(b => {
    const on = b.dataset.arg === ed.cat;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', on);
  });
}
function renderPreview() {
  const d = editorData();
  $('editorTitle').textContent = d.name || 'Bez názvu';
  $('descCount').textContent = `${$('fDesc').value.length} / 3000`;
  document.querySelectorAll('#badgePicks .pick').forEach(b => b.classList.toggle('is-on', b.dataset.arg === d.badge));
  const img = ed.imgs[0];
  $('previewCard').innerHTML = `
    <div class="pv-media">
      ${img ? `<img src="${esc(img)}" alt="">` : `<span class="ph">${icon('img')}<br>Tady bude hlavní fotka</span>`}
      ${d.badge ? `<span class="pv-badge">${esc(d.badge)}</span>` : ''}
      ${d.inStock ? '' : '<span class="pv-sold">Prodáno</span>'}
    </div>
    <div class="pv-body">
      <small>${esc(d.collection || CAT_LABELS[d.cat])}</small>
      <b>${esc(d.name || 'Název šperku')}</b>
      <p>${esc(d.material || 'Materiál')}</p>
      <p class="pv-price">${d.price > 0 ? kc(d.price) : '— Kč'}</p>
    </div>`;
}
$('productForm').addEventListener('input', renderPreview);
$('productForm').addEventListener('change', renderPreview);

function renderPhotos() {
  const box = $('photos');
  box.classList.toggle('empty', !ed.imgs.length && !ed.uploading);
  box.innerHTML = ed.imgs.map((u, i) => `
    <div class="photo" draggable="true" data-i="${i}">
      <img src="${esc(u)}" alt="Fotka ${i + 1}">
      ${i === 0 ? '<span class="photo-main">Hlavní</span>' : ''}
      <div class="photo-tools">
        ${i > 0 ? `<button type="button" data-action="photoLeft" data-arg="${i}" aria-label="Posunout dopředu">${icon('left')}</button>` : ''}
        <button type="button" data-action="photoRemove" data-arg="${i}" aria-label="Odebrat fotku">${icon('x')}</button>
      </div>
    </div>`).join('')
    + '<div class="photo uploading"></div>'.repeat(ed.uploading)
    + (ed.imgs.length + ed.uploading < MAX_IMGS
      ? `<button type="button" class="drop" data-action="pickFiles">${icon('img')}<span>${ed.imgs.length ? 'Přidat' : '<b>Přidat fotky</b><br>z telefonu nebo počítače, můžete je sem i přetáhnout'}</span></button>` : '');
}

// přeskládání fotek tažením
let dragFrom = null;
const photos = $('photos');
photos.addEventListener('dragstart', e => {
  const el = e.target.closest('.photo[data-i]');
  if (!el) return;
  dragFrom = Number(el.dataset.i);
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
});
photos.addEventListener('dragend', () => { dragFrom = null; photos.querySelectorAll('.dragging, .over').forEach(x => x.classList.remove('dragging', 'over')); });
photos.addEventListener('dragover', e => {
  e.preventDefault();
  photos.querySelectorAll('.over').forEach(x => x.classList.remove('over'));
  (e.target.closest(dragFrom === null ? '.drop, .photos' : '.photo[data-i]') || photos).classList.add('over');
});
photos.addEventListener('dragleave', e => { if (!photos.contains(e.relatedTarget)) photos.querySelectorAll('.over').forEach(x => x.classList.remove('over')); });
photos.addEventListener('drop', e => {
  e.preventDefault();
  photos.querySelectorAll('.over').forEach(x => x.classList.remove('over'));
  if (dragFrom === null) { if (e.dataTransfer.files.length) uploadFiles([...e.dataTransfer.files]); return; }
  const to = e.target.closest('.photo[data-i]');
  if (!to) return;
  const [u] = ed.imgs.splice(dragFrom, 1);
  ed.imgs.splice(Number(to.dataset.i), 0, u);
  dragFrom = null;
  renderPhotos(); renderPreview();
});

// nahrávání: podepsaný upload do Cloudinary (tajný klíč zůstává na serveru)
$('fImgFile').addEventListener('change', e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) uploadFiles(files);
});
async function uploadFiles(files) {
  const progress = $('uploadProgress');
  progress.classList.remove('err');
  const room = MAX_IMGS - ed.imgs.length - ed.uploading;
  const ok = files.filter(f => FILE_TYPES.includes(f.type) && f.size <= MAX_FILE);
  if (ok.length < files.length) { progress.textContent = 'Některé soubory se nenahrály: povolené jsou JPG, PNG a WebP do 10 MB.'; progress.classList.add('err'); }
  const queue = ok.slice(0, room);
  if (ok.length > room) { progress.textContent = `Vejde se jen ${MAX_IMGS} fotek.`; progress.classList.add('err'); }
  for (const file of queue) {
    ed.uploading++;
    renderPhotos();
    try {
      const sig = await api('/api/upload-sign', 'POST', {});
      const fd = new FormData();
      fd.append('file', file);
      fd.append('api_key', sig.apiKey);
      fd.append('timestamp', sig.timestamp);
      fd.append('folder', sig.folder);
      fd.append('allowed_formats', sig.allowed_formats);
      fd.append('signature', sig.signature);
      fd.append('signature_algorithm', sig.signatureAlgorithm);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(sig.cloud)}/image/upload`, { method: 'POST', body: fd });
      const data = await res.json();
      const url = safeUrl(data.secure_url);
      if (!url) throw new Error(data.error?.message || 'neznámá chyba');
      ed.imgs.push(url);
    } catch (err) {
      ed.uploading--;
      renderPhotos();
      if (err.message === 'unauthorized') return;
      progress.textContent = 'Fotka se nenahrála: ' + err.message;
      progress.classList.add('err');
      return;
    }
    ed.uploading--;
    renderPhotos(); renderPreview();
  }
}

$('productForm').addEventListener('submit', async e => {
  e.preventDefault();
  const data = editorData();
  if (!data.name) { toast('Doplňte prosím název.', { err: true }); $('fName').focus(); return; }
  if (!Number.isInteger(data.price) || data.price <= 0) { toast('Cena musí být celé číslo v Kč.', { err: true }); $('fPrice').focus(); return; }
  if (ed.uploading) { toast('Počkejte, až se nahrají fotky.', { err: true }); return; }
  const btn = $('saveBtn');
  btn.disabled = true;
  try {
    await api('/api/products', ed.id ? 'PUT' : 'POST', ed.id ? { id: ed.id, ...data } : data);
    toast(ed.id ? 'Změny uložené.' : 'Šperk je na webu.');
    ed.snapshot = editorJson();
    closeSheet(true);
    reloadProducts();
  } catch (err) {
    if (err.message !== 'unauthorized') toast('Neuloženo: ' + err.message, { err: true });
  } finally {
    btn.disabled = false;
  }
});

// ═══ FAKTURY ═══
// Faktura se po vystavení needituje (účetnictví). Oprava = storno a nová faktura.
const invoiceUrl = n => '/admin-faktura?c=' + encodeURIComponent(n) + (DEMO ? '&demo' : '');
const isoDay = (d = new Date()) => d.toLocaleDateString('sv-SE'); // YYYY-MM-DD v místním čase
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
const czDate = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('cs-CZ') : '—';
const kc2 = n => (Number(n) || 0).toLocaleString('cs-CZ', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' Kč';
const r2 = n => Math.round(n * 100) / 100;

function invoiceState(i) {
  if (i.storno) return { label: 'Stornováno', tone: 'mute' };
  if (i.paid) return { label: 'Zaplaceno', tone: 'ok' };
  if (i.dueDate && i.dueDate < isoDay()) return { label: 'Po splatnosti', tone: 'bad' };
  return { label: 'Čeká na platbu', tone: 'warn' };
}

// Další číslo podle poslední faktury: zvýší poslední skupinu číslic a nechá formát (2026001 → 2026002, FV-07 → FV-08)
function nextInvoiceNumber() {
  const taken = new Set(state.invoices.map(i => i.number));
  const last = state.invoices[0]?.number;
  const year = String(new Date().getFullYear());
  let candidate;
  const m = last && /^(.*?)(\d+)(\D*)$/.exec(last);
  if (m && !(/^\d{7,}$/.test(last) && !last.startsWith(year))) {
    let n = Number(m[2]);
    do { n++; candidate = m[1] + String(n).padStart(m[2].length, '0') + m[3]; } while (taken.has(candidate));
  } else {
    let n = 0;
    do { n++; candidate = year + String(n).padStart(3, '0'); } while (taken.has(candidate));
  }
  return candidate.slice(0, 20);
}

function renderInvoices() {
  const all = state.invoices;
  const year = String(new Date().getFullYear());
  const live = all.filter(i => !i.storno);
  const thisYear = live.filter(i => (i.issueDate || '').startsWith(year));
  const unpaid = live.filter(i => !i.paid);
  const overdue = unpaid.filter(i => i.dueDate < isoDay());
  $('invoiceKpis').innerHTML = `
    <div class="kpi"><span class="kpi-label">${icon('doc')}Vystaveno ${year}</span><span class="kpi-value num">${thisYear.reduce((s, i) => s + i.total, 0).toLocaleString('cs-CZ')}<small>Kč</small></span><span class="kpi-sub">${thisYear.length} ${plural(thisYear.length, 'faktura', 'faktury', 'faktur')}</span></div>
    <div class="kpi"><span class="kpi-label">${icon('bank')}Čeká na zaplacení</span><span class="kpi-value num">${unpaid.reduce((s, i) => s + i.total, 0).toLocaleString('cs-CZ')}<small>Kč</small></span><span class="kpi-sub">${unpaid.length ? unpaid.length + ' ' + plural(unpaid.length, 'faktura', 'faktury', 'faktur') : 'vše zaplacené'}</span></div>
    <div class="kpi ${overdue.length ? 'hot' : ''}"><span class="kpi-label">${icon('alert')}Po splatnosti</span><span class="kpi-value">${overdue.length}</span><span class="kpi-sub">${overdue.length ? 'připomeňte se odběrateli' : 'nic nehoří'}</span></div>`;

  if (state.invoicesError) {
    $('invoicesList').innerHTML = '<div class="list-empty"><p class="big">Faktury se nenačetly</p><p>Zkuste stránku obnovit.</p></div>';
    return;
  }
  const q = state.invoiceQuery.toLowerCase();
  const list = all.filter(i => !q || i.number.toLowerCase().includes(q) || (i.customer?.name || '').toLowerCase().includes(q) || (i.orderNumber || '').includes(q));
  if (!list.length) {
    $('invoicesList').innerHTML = `<div class="list-empty"><p class="big">${all.length ? 'Nic jsme nenašli' : 'Zatím žádná faktura'}</p><p>${all.length ? 'Zkuste jiné hledání.' : 'Novou vystavíte tlačítkem „Nová faktura“, k objednávce přímo v jejím detailu.'}</p></div>`;
    return;
  }
  $('invoicesList').innerHTML = list.slice(0, 300).map((i, k) => {
    const s = invoiceState(i);
    const n = esc(i.number);
    return `
    <div class="order-row inv-list-row ${i.storno ? 'storno' : ''}" style="animation-delay:${Math.min(k, 12) * 25}ms">
      <span class="who"><b>č. ${n}</b><small>${i.orderNumber ? 'obj. ' + esc(i.orderNumber) : 'ruční'}</small></span>
      <span class="who"><b>${esc(i.customer?.name || '—')}</b><small>${esc(i.paymentLabel || '')}</small></span>
      <span class="when"><small>vystaveno</small>${esc(czDate(i.issueDate))}</span>
      <span class="status"><span class="pill ${s.tone}">${esc(s.label)}</span></span>
      <span class="total">${kc2(i.total)}<small>splatnost ${esc(czDate(i.dueDate))}</small></span>
      <span class="row-tools">
        <a class="btn btn-ghost btn-sm" href="${esc(invoiceUrl(i.number))}" target="_blank" rel="noopener">${icon('print')}PDF</a>
        ${!i.storno && !i.paid ? `<button class="btn btn-ghost btn-sm" data-action="invoicePaid" data-arg="${n}">${icon('check')}Zaplaceno</button>` : ''}
        ${!i.storno ? `<button class="btn btn-ghost btn-sm danger" data-action="invoiceStorno" data-arg="${n}">Storno</button>` : ''}
      </span>
    </div>`;
  }).join('');
}

const inv = { items: [], orderNumber: '', snapshot: '' };

function openInvoiceEditor(prefill = {}) {
  const today = isoDay();
  const c = prefill.customer || {};
  inv.orderNumber = prefill.orderNumber || '';
  inv.items = (prefill.items || [{ name: '', qty: 1, unit: 'ks', price: '' }]).map(x => ({ ...x }));
  $('iNumber').value = nextInvoiceNumber();
  $('iIssue').value = today;
  $('iDue').value = prefill.dueDate || addDays(today, 14);
  $('iPayment').value = prefill.payment || 'prevod';
  $('iPaid').checked = !!prefill.paid;
  $('cName').value = c.name || ''; $('cStreet').value = c.street || ''; $('cEmail').value = c.email || '';
  $('cZip').value = c.zip || ''; $('cCity').value = c.city || ''; $('cCountry').value = c.country || 'Česká republika';
  $('cIco').value = ''; $('cDic').value = '';
  $('iNote').value = prefill.note || '';
  $('invEyebrow').textContent = inv.orderNumber ? 'Faktura k objednávce' : 'Ruční faktura';
  $('iOrderHint').hidden = !inv.orderNumber;
  $('iOrderHint').textContent = inv.orderNumber ? `Položky jsou převzaté z objednávky č. ${inv.orderNumber}. Faktura se k ní připojí.` : '';
  renderInvItems();
  inv.snapshot = invoiceJson();
  openSheet('invoiceSheet');
  setTimeout(() => $(inv.orderNumber ? 'iNumber' : 'cName').focus({ preventScroll: true }), 90);
}

function invoiceFromOrder(number) {
  const o = state.orders.find(x => x.number === number);
  if (!o) return;
  const c = o.customer || {};
  const items = o.lines.map(l => ({ name: l.name, qty: l.qty, unit: 'ks', price: l.price }));
  if (o.shippingPrice) items.push({ name: 'Doprava · ' + (SHIPPING[o.shipping] || o.shipping), qty: 1, unit: 'ks', price: o.shippingPrice });
  if (o.giftWrap && o.giftWrapPrice) items.push({ name: 'Dárkové zabalení', qty: 1, unit: 'ks', price: o.giftWrapPrice });
  if (o.discount) items.push({ name: 'Sleva dárkovým poukazem', qty: 1, unit: 'ks', price: -o.discount });
  closeAllSheets();
  openInvoiceEditor({
    orderNumber: o.number,
    items,
    customer: { name: fullName(c), street: c.ulice, city: c.mesto, zip: c.psc, country: COUNTRIES[c.zeme] || c.zeme, email: c.email },
    payment: INV_PAY[o.payment] || 'prevod',
    paid: ['paid', 'shipped'].includes(o.status),
    dueDate: isoDay(),
    note: `Objednávka z e-shopu č. ${o.number}.`,
  });
}

function renderInvItems() {
  $('invItems').innerHTML = `<div class="inv-row inv-head"><span>Položka</span><span>Množství</span><span>Jedn.</span><span>Cena za jedn.</span><span>Celkem</span><span></span></div>`
    + inv.items.map((it, i) => `
    <div class="inv-row" data-i="${i}">
      <input type="text" data-k="name" maxlength="200" value="${esc(it.name)}" placeholder="Název položky" aria-label="Název položky">
      <input type="number" data-k="qty" class="num" min="0.001" max="10000" step="any" value="${esc(it.qty)}" aria-label="Množství">
      <input type="text" data-k="unit" maxlength="10" value="${esc(it.unit || 'ks')}" aria-label="Jednotka">
      <input type="number" data-k="price" class="num" step="0.01" min="-1000000" max="1000000" value="${esc(it.price)}" placeholder="0" aria-label="Cena za jednotku v Kč">
      <span class="num inv-line-sum">${kc2(r2((Number(it.qty) || 0) * (Number(it.price) || 0)))}</span>
      <button type="button" class="icon-btn" data-action="invRemoveItem" data-arg="${i}" aria-label="Odebrat položku" ${inv.items.length < 2 ? 'disabled' : ''}>${icon('x')}</button>
    </div>`).join('');
  renderInvTotal();
}
function renderInvTotal() {
  const total = r2(inv.items.reduce((s, it) => s + r2((Number(it.qty) || 0) * (Number(it.price) || 0)), 0));
  $('invTotal').textContent = kc2(total);
  return total;
}
$('invItems').addEventListener('input', e => {
  const row = e.target.closest('.inv-row[data-i]');
  const k = e.target.dataset.k;
  if (!row || !k) return;
  const it = inv.items[Number(row.dataset.i)];
  it[k] = e.target.value;
  row.querySelector('.inv-line-sum').textContent = kc2(r2((Number(it.qty) || 0) * (Number(it.price) || 0)));
  renderInvTotal();
});
$('iNote').addEventListener('input', () => { $('iNoteCount').textContent = `${$('iNote').value.length} / 500`; });

const invoiceData = () => ({
  number: $('iNumber').value.trim(),
  issueDate: $('iIssue').value, taxDate: $('iIssue').value, dueDate: $('iDue').value,
  payment: $('iPayment').value, paid: $('iPaid').checked,
  customer: {
    name: $('cName').value.trim(), street: $('cStreet').value.trim(), email: $('cEmail').value.trim(),
    zip: $('cZip').value.trim(), city: $('cCity').value.trim(), country: $('cCountry').value.trim(),
    ico: $('cIco').value.replace(/\s/g, ''), dic: $('cDic').value.replace(/\s/g, '').toUpperCase(),
  },
  items: inv.items.map(it => ({ name: String(it.name).trim(), qty: Number(it.qty), unit: String(it.unit || 'ks').trim() || 'ks', price: Number(it.price) })),
  note: $('iNote').value.trim(),
  orderNumber: inv.orderNumber,
});
const invoiceJson = () => JSON.stringify(invoiceData());
const invoiceDirty = () => $('invoiceSheet').classList.contains('open') && invoiceJson() !== inv.snapshot;

$('invoiceForm').addEventListener('submit', async e => {
  e.preventDefault();
  const d = invoiceData();
  const bad = (msg, id) => { toast(msg, { err: true }); if (id) $(id).focus(); };
  if (!INV_NUM_RE.test(d.number)) return bad('Číslo faktury: jen písmena, číslice a / . _ -, nejvýš 20 znaků.', 'iNumber');
  if (state.invoices.some(i => i.number === d.number)) return bad(`Faktura č. ${d.number} už existuje.`, 'iNumber');
  if (!d.issueDate || !d.dueDate) return bad('Doplňte prosím data.', 'iIssue');
  if (d.customer.name.length < 2) return bad('Doplňte odběratele.', 'cName');
  if (d.customer.ico && !/^\d{8}$/.test(d.customer.ico)) return bad('IČO má 8 číslic.', 'cIco');
  if (d.items.some(it => !it.name)) return bad('Každá položka potřebuje název.');
  if (d.items.some(it => !(it.qty > 0) || !Number.isFinite(it.price))) return bad('Zkontrolujte množství a ceny.');
  if (renderInvTotal() < 0) return bad('Celkem nemůže vyjít záporně.');
  const btn = $('invSaveBtn');
  btn.disabled = true;
  try {
    const created = await api('/api/invoices', 'POST', d);
    state.invoices.unshift(created);
    if (created.orderNumber) {
      const o = state.orders.find(x => x.number === created.orderNumber);
      if (o) o.invoiceNumber = created.number;
    }
    inv.snapshot = invoiceJson();
    closeSheet(true);
    renderAll();
    setView('faktury');
    toast(`Faktura č. ${created.number} je vystavená.`);
  } catch (err) {
    if (err.message !== 'unauthorized') toast(err.message, { err: true });
  } finally {
    btn.disabled = false;
  }
});

async function patchInvoice(number, body, msg) {
  try {
    const updated = await api('/api/invoices', 'PATCH', { number, ...body });
    const i = state.invoices.findIndex(x => x.number === number);
    if (i >= 0) state.invoices[i] = updated;
    if (body.storno && updated.orderNumber) {
      const o = state.orders.find(x => x.number === updated.orderNumber && x.invoiceNumber === number);
      if (o) o.invoiceNumber = '';
    }
    renderAll();
    toast(msg);
  } catch (err) {
    if (err.message !== 'unauthorized') toast(err.message, { err: true });
  }
}
async function invoiceStorno(number) {
  if (!(await ask({ title: `Stornovat fakturu č. ${number}?`, text: 'Faktura zůstane v přehledu přeškrtnutá a s jejím číslem se už nepočítá. Storno nejde vrátit.', yes: 'Stornovat', danger: true }))) return;
  patchInvoice(number, { storno: true }, 'Faktura je stornovaná.');
}

// ═══ PANELY, POTVRZENÍ, TOAST ═══
let lastFocus = null;
function openSheet(id) {
  const s = $(id);
  if (!s.classList.contains('open')) lastFocus = document.activeElement;
  s.classList.add('open');
  s.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => (s.querySelector('#fName') || s.querySelector('.icon-btn'))?.focus({ preventScroll: true }), 80);
}
async function closeSheet(force) {
  const s = document.querySelector('.sheet.open');
  if (!s) return;
  if (force !== true && s.id === 'productSheet' && editorDirty()
    && !(await ask({ title: 'Zahodit změny?', text: 'Úpravy šperku ještě nejsou uložené.', yes: 'Zahodit', danger: true }))) return;
  if (force !== true && s.id === 'invoiceSheet' && invoiceDirty()
    && !(await ask({ title: 'Zahodit fakturu?', text: 'Faktura ještě není vystavená.', yes: 'Zahodit', danger: true }))) return;
  s.classList.remove('open');
  s.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (s.id === 'orderSheet') currentOrder = null;
  lastFocus?.focus?.({ preventScroll: true });
}
function closeAllSheets() {
  document.querySelectorAll('.sheet.open').forEach(s => { s.classList.remove('open'); s.setAttribute('aria-hidden', 'true'); });
  document.body.style.overflow = '';
}

let confirmResolve = null;
function ask({ title, text, yes, danger }) {
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text || '';
  $('confirmYes').textContent = yes || 'Ano';
  $('confirmYes').classList.toggle('danger-yes', !!danger);
  $('confirm').classList.add('open');
  $('confirm').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('confirmYes').focus(), 30);
  return new Promise(r => { confirmResolve = r; });
}
function answer(v) {
  $('confirm').classList.remove('open');
  $('confirm').setAttribute('aria-hidden', 'true');
  confirmResolve?.(v);
  confirmResolve = null;
}

let toastTimer, toastUndo = null;
function toast(msg, { err = false, undo = null } = {}) {
  const t = $('toast');
  toastUndo = undo;
  t.className = 'toast' + (err ? ' err' : '');
  t.innerHTML = icon(err ? 'alert' : 'check') + `<span>${esc(msg)}</span>` + (undo ? '<button data-action="undo">Zpět</button>' : '');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); toastUndo = null; }, undo ? 5000 : 3200);
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  btn.classList.add('done');
  const html = btn.innerHTML;
  btn.innerHTML = icon('check') + 'Zkopírováno';
  setTimeout(() => { btn.classList.remove('done'); btn.innerHTML = html; }, 1600);
}

// ═══ UDÁLOSTI ═══
const ACTIONS = {
  logout: () => logout(),
  forgetDevice: async () => {
    if (await ask({ title: 'Zapomenout toto zařízení?', text: 'Při příštím přihlášení přijde nový kód na e-mail.', yes: 'Odhlásit a zapomenout' })) logout(true);
  },
  openSecurity: () => { closeAllSheets(); openSecurity(); },
  revokeDevice: a => revokeDevice(a),
  loginRestart: () => loginStep('password'),
  view: v => { closeAllSheets(); setView(v); },
  togglePass: (a, el) => {
    const inp = $('loginPass');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    el.setAttribute('aria-label', inp.type === 'password' ? 'Zobrazit heslo' : 'Skrýt heslo');
  },
  chartRange: (a, el) => {
    state.chartDays = Number(a) || 30;
    el.parentElement.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('is-on', b === el));
    renderChart();
  },
  ordersFilter: a => { state.orderFilter = a || 'all'; renderOrders(); setView('objednavky'); },
  openOrder: a => openOrder(a),
  orderStatus: a => orderStatus(a),
  orderSaveNote,
  copy: (a, el) => copyText(a, el),
  productsCat: a => { state.cat = a; renderProducts(); },
  productsStock: a => { state.stock = a; state.cat = ''; state.collection = ''; state.productQuery = ''; $('productSearch').value = ''; renderProducts(); setView('sperky'); },
  newProduct: () => openEditor(null),
  editProduct: a => openEditor(a),
  dupProduct: a => openEditor(a, { duplicate: true }),
  delProduct: a => delProduct(a),
  deleteCurrent: async () => { if (ed.id && await delProduct(ed.id)) closeSheet(true); },
  setCat: a => { ed.cat = a; renderCat(); renderPreview(); },
  pickBadge: a => { $('fBadge').value = a; renderPreview(); },
  pickFiles: () => $('fImgFile').click(),
  photoRemove: a => { ed.imgs.splice(Number(a), 1); renderPhotos(); renderPreview(); },
  photoLeft: a => { const i = Number(a); [ed.imgs[i - 1], ed.imgs[i]] = [ed.imgs[i], ed.imgs[i - 1]]; renderPhotos(); renderPreview(); },
  newInvoice: () => openInvoiceEditor(),
  invoiceFromOrder: a => invoiceFromOrder(a),
  invAddItem: () => {
    if (inv.items.length >= 30) return toast('Nejvýš 30 položek.', { err: true });
    inv.items.push({ name: '', qty: 1, unit: 'ks', price: '' });
    renderInvItems();
    $('invItems').querySelector('.inv-row:last-child input')?.focus();
  },
  invRemoveItem: a => { if (inv.items.length > 1) { inv.items.splice(Number(a), 1); renderInvItems(); } },
  invoicePaid: a => patchInvoice(a, { paid: true }, 'Označeno jako zaplacené.'),
  invoiceStorno: a => invoiceStorno(a),
  closeSheet: () => closeSheet(),
  confirmYes: () => answer(true),
  confirmNo: () => answer(false),
  undo: () => { const u = toastUndo; toastUndo = null; $('toast').classList.remove('show'); u?.(); },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  fn(el.dataset.arg ?? '', el, e);
});
$('confirm').addEventListener('click', e => { if (e.target === $('confirm')) answer(false); });

$('orderSearch').addEventListener('input', e => { state.orderQuery = e.target.value.trim(); renderOrders(); });
$('productSearch').addEventListener('input', e => { state.productQuery = e.target.value.trim(); renderProducts(); });
$('collectionFilter').addEventListener('change', e => { state.collection = e.target.value; renderProducts(); });
$('stockFilter').addEventListener('change', e => { state.stock = e.target.value; renderProducts(); });
$('invoiceSearch').addEventListener('input', e => { state.invoiceQuery = e.target.value.trim(); renderInvoices(); });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('confirm').classList.contains('open')) return answer(false);
    return closeSheet();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && $('productSheet').classList.contains('open')) {
    e.preventDefault();
    $('productForm').requestSubmit();
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (typing || e.ctrlKey || e.metaKey || e.altKey || $('adminScreen').hidden || document.querySelector('.sheet.open, .confirm.open')) return;
  if (e.key === '/') {
    e.preventDefault();
    if (state.view === 'prehled') setView('sperky');
    $({ objednavky: 'orderSearch', faktury: 'invoiceSearch' }[state.view] || 'productSearch').focus();
  }
  if (e.key === 'n') { e.preventDefault(); openEditor(null); }
});
// Zavřít stránku s neuloženým šperkem? Prohlížeč se zeptá.
addEventListener('beforeunload', e => { if (editorDirty() || invoiceDirty()) e.preventDefault(); });

// ═══ START ═══
(async () => {
  if (DEMO) {
    await new Promise((ok, fail) => {
      const s = Object.assign(document.createElement('script'), { src: '/js/admin-demo.js', onload: ok, onerror: fail });
      document.head.appendChild(s);
    });
    await window.SA_DEMO.ready;
  }
  try {
    const { authenticated } = await api('/api/auth');
    authenticated ? showAdmin() : showLogin();
  } catch {
    showLogin();
  }
})();
