'use strict';
// Odstoupení od smlouvy (/odstoupeni): 1. vyplnění údajů, 2. potvrzení tlačítkem „Potvrdit odstoupení“.
(() => {
  const form = document.getElementById('withdrawForm');
  const msg = document.getElementById('withdrawMsg');
  const review = document.getElementById('withdrawReview');
  const sum = document.getElementById('withdrawSummary');
  if (!form || !review) return;
  const LABELS = [['order', 'Číslo objednávky'], ['name', 'Jméno'], ['email', 'E-mail'], ['items', 'Vrácené šperky'], ['received', 'Datum převzetí'], ['account', 'Účet pro vrácení peněz']];
  const q = new URLSearchParams(location.search).get('order');
  if (q && /^\d{10}$/.test(q)) form.elements.order.value = q;

  const show = (text, cls) => { msg.className = 'doc-msg' + (cls ? ' ' + cls : ''); msg.textContent = text; };
  const fmt = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); return m ? `${+m[3]}. ${+m[2]}. ${m[1]}` : d; };

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    sum.textContent = '';
    for (const [k, label] of LABELS) {
      const v = k === 'received' ? fmt(data[k]) : data[k];
      if (!v) continue;
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = v;
      sum.append(dt, dd);
    }
    form.hidden = true; review.hidden = false; show('');
    review.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.getElementById('withdrawBack').addEventListener('click', () => { review.hidden = true; form.hidden = false; show(''); });

  document.getElementById('withdrawConfirm').addEventListener('click', async ev => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    show('Odesílám…');
    try {
      const r = await fetch('/api/withdrawal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Odeslání se nepovedlo.');
      form.reset();
      review.hidden = true;
      show('Odstoupení jsem přijala ' + (j.at || '') + '. Potvrzení vám přišlo e-mailem.', 'ok');
    } catch (err) {
      review.hidden = true; form.hidden = false;
      show(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });
})();
