'use strict';
// Formulář pro odstoupení od smlouvy (/odstoupeni).
(() => {
  const form = document.getElementById('withdrawForm');
  const msg = document.getElementById('withdrawMsg');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    msg.className = 'doc-msg';
    msg.textContent = 'Odesílám…';
    const data = Object.fromEntries(new FormData(form));
    try {
      const r = await fetch('/api/withdrawal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Odeslání se nepovedlo.');
      form.reset();
      msg.className = 'doc-msg ok';
      msg.textContent = 'Odstoupení jsem přijala ' + (j.at || '') + '. Potvrzení vám přišlo e-mailem.';
    } catch (err) {
      msg.className = 'doc-msg err';
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
})();
