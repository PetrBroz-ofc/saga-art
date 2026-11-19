'use strict';
// Sága Art · administrace: Obchod (doprava, platby, poukazy, zabalení, dovolená).
// Používá pomocné funkce z admin.js (api, esc, toast, ACTIONS).

(() => {
  const $ = id => document.getElementById(id);
  const clone = v => JSON.parse(JSON.stringify(v));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const S = { loaded: false, tab: 'ship', saved: null, cur: null, mailLoaded: false };
  const dirty = () => S.cur && S.saved && !same(S.cur, S.saved);
  const num = v => (v === '' || v === null || v === undefined ? NaN : Number(v));

  function renderDirty() {
    const d = dirty();
    $('shDirty').hidden = !d;
    $('shSave').disabled = !d;
  }

  function render() {
    const pane = $('shPane'), c = S.cur;
    document.querySelectorAll('.shop-tab').forEach(b => {
      const on = b.dataset.arg === S.tab;
      b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (!c) { pane.innerHTML = '<p class="muted">Načítám…</p>'; return; }

    if (S.tab === 'ship') {
      pane.innerHTML = `
        <h2 class="sh-h">Doprava</h2>
        <p class="muted sh-lead">Zapnuté dopravy uvidí zákazníci v pokladně. Ceny se změní hned u další objednávky.</p>
        <div class="sh-rows">${Object.entries(c.shipping).map(([k, s]) => `
          <div class="sh-row">
            <label class="th-switch"><input type="checkbox" data-sh-ship-on="${esc(k)}" ${s.on ? 'checked' : ''}><span>${esc(s.name)}<small>${s.country === 'SK' ? 'Slovensko' : 'Česko'}${s.freeFrom ? ' · může být zdarma od limitu' : ''}</small></span></label>
            <span class="sh-price"><input type="number" min="0" max="2000" step="1" data-sh-ship="${esc(k)}" value="${esc(s.price)}" aria-label="Cena: ${esc(s.name)}"><b>Kč</b></span>
          </div>`).join('')}
        </div>
        <label class="field sh-field"><span>Doprava Zásilkovnou zdarma od <b>(0 = nikdy)</b></span>
          <span class="sh-price"><input type="number" min="0" max="100000" step="10" id="shFree" value="${esc(c.freeFrom)}"><b>Kč</b></span></label>
        <p class="muted">Limit se počítá ze zboží a zabalení po odečtení případného poukazu. Poukaz dopravu neplatí.</p>

        <h2 class="sh-h" style="margin-top:28px">Platby</h2>
        <label class="th-switch"><input type="checkbox" id="shPayCard" ${c.payments.card ? 'checked' : ''}><span>Platební karta online (Stripe)</span></label>
        <label class="th-switch"><input type="checkbox" id="shPayTransfer" ${c.payments.transfer ? 'checked' : ''}><span>Bankovní převod předem</span></label>
        <p class="muted">Aspoň jedna platba musí zůstat zapnutá. Číslo účtu pro převody se nastavuje ve Vercelu (BANK_ACCOUNT).</p>`;
    }

    if (S.tab === 'extras') {
      pane.innerHTML = `
        <h2 class="sh-h">Dárkové poukazy</h2>
        <label class="th-switch"><input type="checkbox" id="shVouchersOn" ${c.vouchers.on ? 'checked' : ''}><span>Prodávat dárkové poukazy</span></label>
        <p class="th-h" style="margin-top:10px">Hodnoty poukazů</p>
        <div class="sh-chips">${c.vouchers.values.map((v, i) => `
          <span class="sh-chip">${esc(v.toLocaleString('cs-CZ'))} Kč<button type="button" data-action="shVoucherDel" data-arg="${i}" aria-label="Odebrat ${esc(v)} Kč">×</button></span>`).join('')}
          <span class="sh-add"><input type="number" min="100" max="20000" step="50" id="shVoucherNew" placeholder="Nová částka"><button type="button" class="btn btn-ghost btn-sm" data-action="shVoucherAdd">Přidat</button></span>
        </div>
        <label class="field sh-field"><span>Platnost poukazu</span>
          <span class="sh-price"><input type="number" min="1" max="36" step="1" id="shMonths" value="${esc(c.vouchers.months)}"><b>měsíců</b></span></label>
        <p class="muted">Poukaz je jednorázový, platí jen na zboží (ne na dopravu), nevyčerpaná část propadá. Pravidla v obchodních podmínkách upravte podle potřeby.</p>

        <h2 class="sh-h" style="margin-top:28px">Dárkové zabalení</h2>
        <label class="th-switch"><input type="checkbox" id="shWrapOn" ${c.giftWrap.on ? 'checked' : ''}><span>Nabízet dárkové zabalení</span></label>
        <label class="field sh-field"><span>Cena zabalení</span>
          <span class="sh-price"><input type="number" min="0" max="1000" step="1" id="shWrapPrice" value="${esc(c.giftWrap.price)}"><b>Kč</b></span></label>`;
    }

    if (S.tab === 'vacation') {
      pane.innerHTML = `
        <h2 class="sh-h">Dovolená a pauza</h2>
        <p class="muted sh-lead">Nahoře na webu se ukáže pruh se zprávou. Můžete objednávky nechat otevřené (odešlete později), nebo je na dobu pauzy zavřít.</p>
        <label class="th-switch"><input type="checkbox" id="shVacOn" ${c.vacation.on ? 'checked' : ''}><span>Zobrazit zprávu o dovolené</span></label>
        <label class="field sh-field"><span>Zpráva pro zákazníky</span>
          <textarea id="shVacMsg" rows="3" maxlength="300" placeholder="Např. Do 5. 1. jsem na dovolené, zásilky odesílám od 6. 1.">${esc(c.vacation.message)}</textarea></label>
        <label class="th-switch"><input type="checkbox" id="shVacBlock" ${c.vacation.block ? 'checked' : ''}><span>Během pauzy zavřít objednávání<small>Zákazníci si nic neobjednají, jen uvidí zprávu.</small></span></label>`;
    }

    if (S.tab === 'mail' && window.ShopMail) window.ShopMail.render(pane);
    renderDirty();
  }

  function onInput(e) {
    const t = e.target, c = S.cur; if (!c) return;
    if (t.dataset.shShip) c.shipping[t.dataset.shShip].price = num(t.value);
    else if (t.dataset.shShipOn) c.shipping[t.dataset.shShipOn].on = t.checked;
    else if (t.id === 'shFree') c.freeFrom = num(t.value);
    else if (t.id === 'shPayCard') c.payments.card = t.checked;
    else if (t.id === 'shPayTransfer') c.payments.transfer = t.checked;
    else if (t.id === 'shVouchersOn') c.vouchers.on = t.checked;
    else if (t.id === 'shMonths') c.vouchers.months = num(t.value);
    else if (t.id === 'shWrapOn') c.giftWrap.on = t.checked;
    else if (t.id === 'shWrapPrice') c.giftWrap.price = num(t.value);
    else if (t.id === 'shVacOn') c.vacation.on = t.checked;
    else if (t.id === 'shVacMsg') c.vacation.message = t.value;
    else if (t.id === 'shVacBlock') c.vacation.block = t.checked;
    else return;
    renderDirty();
  }

  async function load() {
    try {
      const res = await api('/api/shop-settings');
      S.saved = res; S.cur = clone(res); S.loaded = true;
      render();
    } catch (err) { if (err.message !== 'unauthorized') toast(err.message || 'Nastavení se nepodařilo načíst', { err: true }); }
  }

  const toBody = c => ({
    shipping: Object.fromEntries(Object.entries(c.shipping).map(([k, s]) => [k, { price: s.price, on: s.on }])),
    freeFrom: c.freeFrom, giftWrap: c.giftWrap, vouchers: c.vouchers, payments: c.payments, vacation: c.vacation,
  });

  async function save() {
    if (!dirty()) return;
    const btn = $('shSave'); btn.disabled = true;
    try {
      const res = await api('/api/shop-settings', 'PUT', toBody(S.cur));
      S.saved = res; S.cur = clone(res); render();
      toast('Uloženo. Platí hned u další objednávky.');
    } catch (err) { if (err.message !== 'unauthorized') toast(err.message, { err: true }); }
    finally { renderDirty(); }
  }

  Object.assign(ACTIONS, {
    shTab: a => { S.tab = a; render(); },
    shSave: save,
    shDiscard: () => { if (dirty()) { S.cur = clone(S.saved); render(); toast('Změny jsou zahozené.'); } },
    shVoucherAdd: () => {
      const v = num($('shVoucherNew').value);
      if (!Number.isInteger(v) || v < 100 || v > 20000) return toast('Částka poukazu: celé číslo od 100 do 20 000 Kč.', { err: true });
      if (S.cur.vouchers.values.includes(v)) return toast('Takový poukaz už je.', { err: true });
      if (S.cur.vouchers.values.length >= 6) return toast('Nejvýš 6 hodnot poukazů.', { err: true });
      S.cur.vouchers.values = [...S.cur.vouchers.values, v].sort((a, b) => a - b); render();
    },
    shVoucherDel: a => {
      if (S.cur.vouchers.values.length < 2) return toast('Aspoň jedna hodnota poukazu musí zůstat.', { err: true });
      S.cur.vouchers.values.splice(Number(a), 1); render();
    },
  });
  const pane = $('shPane');
  pane.addEventListener('input', onInput);
  pane.addEventListener('change', onInput);
  addEventListener('beforeunload', e => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });

  window.ShopEditor = {
    show() { if (!S.loaded) load(); else render(); },
    state: S, rerender: render, renderDirty, // pro záložku E-maily
    markDirtyCheck: renderDirty,
  };
})();
