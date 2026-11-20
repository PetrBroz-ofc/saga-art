'use strict';
// Čísla v obchodních podmínkách (platnost poukazu, doprava zdarma) se berou z nastavení v administraci,
// aby sedělo to, co je v textu, s tím, co platí v obchodě. Bez nastavení zůstane text, jak je napsaný.
(() => {
  fetch('/api/products-public').then(r => (r.ok ? r.json() : null)).then(d => {
    if (!d) return;
    const months = n => n + (n === 1 ? ' měsíc' : n >= 2 && n <= 4 ? ' měsíce' : ' měsíců');
    const free = Number.isInteger(d.freeShippingFrom) ? d.freeShippingFrom : null;
    document.querySelectorAll('[data-rule]').forEach(el => {
      const k = el.dataset.rule;
      if (k === 'v-months' && d.vouchers && Number.isInteger(d.vouchers.months)) el.textContent = months(d.vouchers.months);
      if (k === 'free-from' && free) el.textContent = free.toLocaleString('cs-CZ');
    });
    document.querySelectorAll('[data-rule-block="free"]').forEach(el => { if (free === 0) el.hidden = true; });
  }).catch(() => {});
})();
