'use strict';
// Sága Art · tisk faktury. Data jdou jen z /api/invoices (jen přihlášená administrace),
// všechno do stránky přes esc(). Uložení do PDF = tisk prohlížeče → „Uložit jako PDF“.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const $ = id => document.getElementById(id);
const NUM_RE = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,19}$/;
const money = n => (Number(n) || 0).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Kč';
const qtyFmt = n => (Number(n) || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 3 });
const czDate = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? new Date(iso + 'T12:00:00').toLocaleDateString('cs-CZ') : '—';
const DEMO = /^(localhost|127\.0\.0\.1)$|\.vercel\.app$/.test(location.hostname) && new URLSearchParams(location.search).has('demo');

function fail(msg) {
  $('barMsg').textContent = msg;
  $('invoice').innerHTML = `<p class="msg">${esc(msg)}</p>`;
}

async function load(number) {
  if (DEMO) {
    let list = [];
    try { list = JSON.parse(localStorage.getItem('sa_demo_invoices')) || []; } catch {}
    const f = list.find(i => i.number === number);
    if (!f) throw new Error('Faktura v ukázce neexistuje.');
    return f;
  }
  const res = await fetch('/api/invoices?number=' + encodeURIComponent(number), { credentials: 'same-origin' });
  if (res.status === 401) throw new Error('Nejste přihlášená. Přihlaste se v administraci a otevřete fakturu znovu.');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Fakturu se nepodařilo načíst.');
  return data;
}

function render(f) {
  const s = f.seller || {}, c = f.customer || {}, b = f.bank || {};
  const lines = (arr) => arr.filter(Boolean).map(esc).join('<br>');
  const isTransfer = f.payment === 'prevod';
  document.title = `Faktura ${f.number} · ${s.brand || 'Sága Art'}`;

  $('invoice').innerHTML = `
    ${f.storno ? '<div class="stamp">STORNO</div>' : ''}
    <header class="top">
      <div class="brand">Sága <em>Art</em></div>
      <div class="title"><h1>Faktura č.&nbsp;${esc(f.number)}</h1><p>dodavatel není plátcem DPH</p></div>
    </header>

    <section class="parties">
      <div class="party">
        <h2>Dodavatel</h2>
        <b>${esc(s.name)}</b>
        ${lines([s.street, `${s.zip || ''} ${s.city || ''}`.trim(), s.country])}
        <div class="ids">IČO: ${esc(s.ico)}<br>${s.vatPayer ? '' : 'Není plátce DPH'}${s.register ? '<br>' + esc(s.register) : ''}</div>
      </div>
      <div class="party">
        <h2>Odběratel</h2>
        <b>${esc(c.name)}</b>
        ${lines([c.street, `${c.zip || ''} ${c.city || ''}`.trim(), c.country])}
        ${c.ico || c.dic || c.email ? `<div class="ids">${lines([c.ico && 'IČO: ' + c.ico, c.dic && 'DIČ: ' + c.dic, c.email])}</div>` : ''}
      </div>
    </section>

    <section class="meta">
      <div><span>Vystaveno</span><b>${esc(czDate(f.issueDate))}</b></div>
      <div><span>Splatnost</span><b>${esc(czDate(f.dueDate))}</b></div>
      <div><span>Platba</span><b>${esc(f.paymentLabel || '')}</b></div>
      <div><span>Var. symbol</span><b>${esc(f.vs || '—')}</b></div>
    </section>
    ${isTransfer && (b.account || b.iban) ? `<div class="pay">${b.account ? `<span>Číslo účtu: <b>${esc(b.account)}</b></span>` : ''}${b.iban ? `<span>IBAN: <b>${esc(b.iban)}</b></span>` : ''}</div>` : ''}
    ${f.orderNumber ? `<div class="pay"><span>Objednávka z e-shopu: <b>${esc(f.orderNumber)}</b></span></div>` : ''}

    <table>
      <thead><tr><th>Položka</th><th class="r">Množství</th><th class="r">Cena za jedn.</th><th class="r">Celkem</th></tr></thead>
      <tbody>
        ${(f.items || []).map(i => `<tr>
          <td>${esc(i.name)}</td>
          <td class="r">${esc(qtyFmt(i.qty))} ${esc(i.unit || 'ks')}</td>
          <td class="r">${esc(money(i.price))}</td>
          <td class="r">${esc(money(i.sum ?? i.qty * i.price))}</td>
        </tr>`).join('')}
      </tbody>
    </table>

    <div class="total"><div><span>${f.paid ? 'Celkem' : 'Celkem k úhradě'}</span><b>${esc(money(f.total))}</b></div></div>
    ${f.paid && !f.storno ? '<p class="paid-note">Uhrazeno, neplaťte.</p>' : ''}

    ${f.note ? `<section class="note"><h2>Poznámka</h2>${esc(f.note)}</section>` : ''}

    <footer class="foot">
      <span>Dodavatel není plátcem DPH. Vystavila ${esc(s.name)}.</span>
      <span>${lines([s.web, s.email])}</span>
    </footer>`;
  $('barMsg').textContent = f.storno ? `Faktura č. ${f.number} je stornovaná.` : `Faktura č. ${f.number}`;
  $('printBtn').disabled = false;
}

$('printBtn').addEventListener('click', () => window.print());

(async () => {
  const number = new URLSearchParams(location.search).get('c') || '';
  if (!NUM_RE.test(number)) return fail('Neplatné číslo faktury.');
  try {
    render(await load(number));
  } catch (err) {
    fail(err.message);
  }
})();
