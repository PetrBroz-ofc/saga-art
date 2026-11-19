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

    if (S.tab === 'collections') {
      // kolekce, které mají šperky, ale nejsou v seznamu, se přidají (uloží se při dalším uložení)
      const known = new Set(c.collections.map(x => x.name.toLowerCase()));
      (typeof state !== 'undefined' ? state.products : []).forEach(p => {
        const n = (p.collection || '').trim();
        if (n && !known.has(n.toLowerCase())) { c.collections.push({ name: n, desc: '', cover: '', hidden: false }); known.add(n.toLowerCase()); }
      });
      const count = name => (typeof state !== 'undefined' ? state.products : []).filter(p => (p.collection || '') === name).length;
      pane.innerHTML = `
        <h2 class="sh-h">Kolekce na webu</h2>
        <p class="muted sh-lead">Pořadí, popis a titulní fotka kolekcí v nabídce. Název se nemění, patří k němu šperky. Šperk do kolekce zařadíte v jeho detailu.</p>
        <div class="sh-cols">${c.collections.map((x, i) => `
          <div class="sh-col ${x.hidden ? 'is-off' : ''}">
            <span class="sh-col-pic">${x.cover ? `<img src="${esc(x.cover)}" alt="">` : '<i>bez fotky</i>'}</span>
            <div class="sh-col-body">
              <div class="sh-col-top"><b>${esc(x.name)}</b><small>${count(x.name)} ${count(x.name) === 1 ? 'šperk' : count(x.name) >= 2 && count(x.name) <= 4 ? 'šperky' : 'šperků'}</small>
                <span class="th-sec-mv"><button type="button" class="icon-btn" data-action="shColMove" data-arg="${i}:-1" aria-label="Posunout nahoru" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-btn" data-action="shColMove" data-arg="${i}:1" aria-label="Posunout dolů" ${i === c.collections.length - 1 ? 'disabled' : ''}>↓</button></span></div>
              <textarea data-sh-coldesc="${i}" rows="2" maxlength="200" placeholder="Krátký popis kolekce">${esc(x.desc)}</textarea>
              <div class="sh-col-btns">
                <button type="button" class="btn btn-ghost btn-sm" data-action="shColPhoto" data-arg="${i}">${x.cover ? 'Změnit fotku' : 'Nahrát fotku'}</button>
                <label class="th-switch" style="margin:0"><input type="checkbox" data-sh-colhide="${i}" ${x.hidden ? '' : 'checked'}><span>Zobrazit na webu</span></label>
                ${count(x.name) === 0 ? `<button type="button" class="th-undo" data-action="shColDel" data-arg="${i}">odebrat</button>` : ''}
                <small class="sh-col-st" id="shColSt-${i}"></small>
              </div>
            </div>
          </div>`).join('')}</div>
        <div class="sh-add" style="margin-top:14px"><input type="text" id="shColNew" maxlength="40" placeholder="Název nové kolekce"><button type="button" class="btn btn-ghost btn-sm" data-action="shColAdd">Přidat kolekci</button></div>`;
    }

    if (S.tab === 'mail' && window.ShopMail) window.ShopMail.render(pane);
    $('shSave').hidden = S.tab === 'mail'; $('shDiscard').hidden = S.tab === 'mail';
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
    else if (t.dataset.shColdesc) c.collections[Number(t.dataset.shColdesc)].desc = t.value;
    else if (t.dataset.shColhide) { c.collections[Number(t.dataset.shColhide)].hidden = !t.checked; t.closest('.sh-col').classList.toggle('is-off', !t.checked); }
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
    collections: c.collections,
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
    shColMove: a => {
      const [i, d] = a.split(':').map(Number), l = S.cur.collections, j = i + d;
      if (j < 0 || j >= l.length) return;
      [l[i], l[j]] = [l[j], l[i]]; render();
    },
    shColAdd: () => {
      const n = ($('shColNew').value || '').trim();
      if (!n) return toast('Napište název kolekce.', { err: true });
      if (S.cur.collections.some(x => x.name.toLowerCase() === n.toLowerCase())) return toast('Taková kolekce už je.', { err: true });
      if (S.cur.collections.length >= 30) return toast('Nejvýš 30 kolekcí.', { err: true });
      S.cur.collections.push({ name: n, desc: '', cover: '', hidden: false }); render();
    },
    shColDel: a => { S.cur.collections.splice(Number(a), 1); render(); },
    shColPhoto: a => { S.colIdx = Number(a); $('shFile').value = ''; $('shFile').click(); },
    shVoucherDel: a => {
      if (S.cur.vouchers.values.length < 2) return toast('Aspoň jedna hodnota poukazu musí zůstat.', { err: true });
      S.cur.vouchers.values.splice(Number(a), 1); render();
    },
  });
  // nahrání titulní fotky kolekce do Cloudinary (stejný postup jako u šperků)
  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.id = 'shFile'; fileInput.accept = 'image/jpeg,image/png,image/webp'; fileInput.hidden = true;
  document.body.appendChild(fileInput);
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0], i = S.colIdx; if (!file || i === undefined) return;
    const st = document.getElementById('shColSt-' + i);
    const say = (m, err) => { if (st) { st.textContent = m; st.style.color = err ? 'var(--bad)' : ''; } };
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) return say('JPG, PNG nebo WebP do 10 MB.', true);
    say('Nahrávám…');
    try {
      const sig = await api('/api/upload-sign', 'POST', {});
      const fd = new FormData();
      fd.append('file', file); fd.append('api_key', sig.apiKey); fd.append('timestamp', sig.timestamp); fd.append('folder', sig.folder);
      fd.append('allowed_formats', sig.allowed_formats); fd.append('signature', sig.signature); fd.append('signature_algorithm', sig.signatureAlgorithm);
      const res = await fetch('https://api.cloudinary.com/v1_1/' + encodeURIComponent(sig.cloud) + '/image/upload', { method: 'POST', body: fd });
      const data = await res.json();
      const url = typeof data.secure_url === 'string' && /^https:\/\/res\.cloudinary\.com\//.test(data.secure_url) ? data.secure_url : '';
      if (!url) throw new Error(data.error?.message || 'neznámá chyba');
      S.cur.collections[i].cover = url; render();
    } catch (err) { if (err.message !== 'unauthorized') say('Nenahrálo se: ' + err.message, true); }
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
