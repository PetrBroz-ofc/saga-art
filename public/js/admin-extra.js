'use strict';
// Sága Art · administrace: Slevové kódy, Odběratelé novinek a Texty e-mailů (záložka v Obchodu).
// Používá pomocné funkce z admin.js (api, esc, toast, ask, openSheet, closeSheet, ACTIONS).

(() => {
  const $ = id => document.getElementById(id);
  const czDate = iso => (iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('cs-CZ') : '');
  const kcz = n => Number(n).toLocaleString('cs-CZ') + ' Kč';
  const today = () => new Date().toLocaleDateString('sv-SE');

  // ═══ SLEVOVÉ KÓDY ═══
  const C = { list: [], loaded: false, editing: '' };

  function couponState(c) {
    if (!c.enabled) return { label: 'Vypnutý', tone: 'mute' };
    if (c.validTo && c.validTo < today()) return { label: 'Prošlý', tone: 'bad' };
    if (c.validFrom && c.validFrom > today()) return { label: 'Čeká na začátek', tone: 'warn' };
    if (c.maxUses > 0 && c.used >= c.maxUses) return { label: 'Vyčerpaný', tone: 'mute' };
    return { label: 'Platí', tone: 'ok' };
  }
  const couponText = c => {
    const parts = [c.type === 'percent' ? `−${c.value} % ze zboží` : `−${kcz(c.value)} ze zboží`];
    if (c.minGoods) parts.push(`od ${kcz(c.minGoods)}`);
    if (c.validFrom || c.validTo) parts.push((c.validFrom ? czDate(c.validFrom) : '…') + ' až ' + (c.validTo ? czDate(c.validTo) : '…'));
    return parts.join(' · ');
  };

  function renderCoupons() {
    const box = $('couponList');
    if (!C.loaded) { box.innerHTML = '<div class="skel" style="height:200px;border-radius:0"></div>'; return; }
    if (!C.list.length) {
      box.innerHTML = '<div class="list-empty"><p class="big">Zatím žádný slevový kód</p><p>Vytvořte třeba JARO10 se slevou 10 % nebo PRVNI100 se slevou 100 Kč. Zákaznice ho zadá v pokladně.</p></div>';
      return;
    }
    box.innerHTML = C.list.map((c, k) => {
      const s = couponState(c), code = esc(c.code);
      return `<div class="order-row coupon-row" style="animation-delay:${Math.min(k, 12) * 25}ms">
        <span class="who"><b class="coupon-code">${code}</b><small>${esc(c.note || '')}</small></span>
        <span class="who"><b>${esc(couponText(c))}</b><small>použito ${c.used}${c.maxUses ? ' z ' + c.maxUses : '×'}</small></span>
        <span class="status"><span class="pill ${s.tone}">${esc(s.label)}</span></span>
        <span class="row-tools">
          <button class="btn btn-ghost btn-sm" data-action="couponEdit" data-arg="${code}">Upravit</button>
          <button class="btn btn-ghost btn-sm" data-action="couponToggle" data-arg="${code}">${c.enabled ? 'Vypnout' : 'Zapnout'}</button>
          ${c.used === 0 ? `<button class="btn btn-ghost btn-sm danger" data-action="couponDelete" data-arg="${code}">Smazat</button>` : ''}
        </span></div>`;
    }).join('');
  }

  async function loadCoupons() {
    try { C.list = await api('/api/coupons'); C.loaded = true; renderCoupons(); }
    catch (err) { if (err.message !== 'unauthorized') toast(err.message || 'Kódy se nepodařilo načíst', { err: true }); }
  }

  function openCouponEditor(code) {
    const c = code ? C.list.find(x => x.code === code) : null;
    C.editing = code || '';
    $('cpTitle').textContent = c ? 'Upravit kód' : 'Nový slevový kód';
    $('cpCode').value = c ? c.code : '';
    $('cpCode').readOnly = !!c;
    $('cpType').value = c ? c.type : 'percent';
    $('cpValue').value = c ? c.value : '';
    $('cpMin').value = c && c.minGoods ? c.minGoods : '';
    $('cpFrom').value = c ? c.validFrom : '';
    $('cpTo').value = c ? c.validTo : '';
    $('cpMax').value = c && c.maxUses ? c.maxUses : '';
    $('cpNote').value = c ? c.note : '';
    $('cpEnabled').checked = c ? c.enabled : true;
    updateValueUnit();
    openSheet('couponSheet');
    setTimeout(() => $(c ? 'cpValue' : 'cpCode').focus({ preventScroll: true }), 90);
  }
  const updateValueUnit = () => { $('cpUnit').textContent = $('cpType').value === 'percent' ? '%' : 'Kč'; };

  async function saveCoupon(e) {
    e.preventDefault();
    const num = id => { const v = $(id).value.trim(); return v === '' ? 0 : Number(v); };
    const body = {
      code: $('cpCode').value.trim(), type: $('cpType').value, value: Number($('cpValue').value),
      minGoods: num('cpMin'), validFrom: $('cpFrom').value, validTo: $('cpTo').value, maxUses: num('cpMax'),
      note: $('cpNote').value.trim(), enabled: $('cpEnabled').checked,
    };
    const btn = $('cpSave'); btn.disabled = true;
    try {
      const saved = C.editing ? await api('/api/coupons', 'PATCH', { ...body, code: C.editing }) : await api('/api/coupons', 'POST', body);
      const i = C.list.findIndex(x => x.code === saved.code);
      if (i >= 0) C.list[i] = saved; else C.list.unshift(saved);
      renderCoupons(); closeSheet(true);
      toast(C.editing ? 'Kód je uložený.' : `Kód ${saved.code} je vytvořený.`);
    } catch (err) { if (err.message !== 'unauthorized') toast(err.message, { err: true }); }
    finally { btn.disabled = false; }
  }

  // ═══ ODBĚRATELÉ ═══
  const N = { list: [], loaded: false, q: '' };
  function renderSubs() {
    const box = $('subsList');
    const active = N.list.filter(s => !s.unsubscribed).length;
    $('subsKpis').innerHTML = `<div class="kpi"><span class="kpi-label">Odběratelé</span><span class="kpi-value">${active}</span><span class="kpi-sub">aktivních</span></div>
      <div class="kpi"><span class="kpi-label">Odhlášení</span><span class="kpi-value">${N.list.length - active}</span><span class="kpi-sub">nebudou oslovováni</span></div>`;
    if (!N.loaded) { box.innerHTML = '<div class="skel" style="height:200px;border-radius:0"></div>'; return; }
    const q = N.q.toLowerCase();
    const list = N.list.filter(s => !q || s.email.toLowerCase().includes(q));
    if (!list.length) { box.innerHTML = `<div class="list-empty"><p class="big">${N.list.length ? 'Nic jsme nenašli' : 'Zatím nikdo'}</p><p>${N.list.length ? 'Zkuste jiné hledání.' : 'Adresy se objeví, jakmile se někdo přihlásí k novinkám na webu.'}</p></div>`; return; }
    box.innerHTML = list.slice(0, 500).map((s, k) => `
      <div class="order-row sub-row" style="animation-delay:${Math.min(k, 12) * 25}ms">
        <span class="who"><b>${esc(s.email)}</b><small>přihlášen ${esc(czDate(s.consentAt))}</small></span>
        <span class="status"><span class="pill ${s.unsubscribed ? 'mute' : 'ok'}">${s.unsubscribed ? 'Odhlášen' : 'Odebírá'}</span></span>
        <span class="row-tools">
          <button class="btn btn-ghost btn-sm" data-action="subToggle" data-arg="${esc(s.id)}">${s.unsubscribed ? 'Přihlásit' : 'Odhlásit'}</button>
          <button class="btn btn-ghost btn-sm danger" data-action="subDelete" data-arg="${esc(s.id)}">Smazat</button>
        </span></div>`).join('');
  }
  async function loadSubs() {
    try { N.list = await api('/api/subscribers'); N.loaded = true; renderSubs(); }
    catch (err) { if (err.message !== 'unauthorized') toast(err.message || 'Odběratele se nepodařilo načíst', { err: true }); }
  }
  function exportSubs() {
    const rows = N.list.filter(s => !s.unsubscribed);
    if (!rows.length) return toast('Zatím není co exportovat.', { err: true });
    // středník a BOM, ať se soubor v českém Excelu otevře správně
    const csv = '﻿e-mail;datum souhlasu\r\n' + rows.map(s => `${s.email};${s.consentAt ? s.consentAt.slice(0, 10) : ''}`).join('\r\n') + '\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'odberatele-' + today() + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`Exportováno ${rows.length} adres (jen ti, kdo odebírají).`);
  }

  // ═══ TEXTY E-MAILŮ (záložka v Obchodu) ═══
  const MAIL_FIELDS = [
    ['orderIntro', 'Úvod potvrzení objednávky', 'Musí obsahovat {cislo}.'],
    ['transferNote', 'Věta k platbě převodem', 'Za číslem účtu a variabilním symbolem.'],
    ['paidNote', 'Věta při zaplacené objednávce', 'Platba kartou nebo poukazem.'],
    ['shipNote', 'Věta o odeslání', 'Kdy zásilku odešlete.'],
    ['returnNote', 'Věta o vrácení zboží', 'Odkaz na obchodní podmínky se přidá sám.'],
    ['voucherIntro', 'Úvod e-mailu s poukazem (jeden)', ''],
    ['voucherIntroMany', 'Úvod e-mailu s poukazy (víc)', ''],
    ['sign', 'Podpis', 'Pod každým e-mailem.'],
  ];
  const M = { texts: null, defaults: null, loaded: false };
  function renderMail(pane) {
    if (!M.loaded) {
      pane.innerHTML = '<p class="muted">Načítám…</p>';
      api('/api/mail-settings').then(r => { M.texts = r.texts; M.defaults = r.defaults; M.loaded = true; if (pane.isConnected && ShopEditorTab() === 'mail') renderMail(pane); })
        .catch(err => { if (err.message !== 'unauthorized') toast(err.message, { err: true }); });
      return;
    }
    pane.innerHTML = `
      <h2 class="sh-h">Texty e-mailů zákazníkům</h2>
      <p class="muted sh-lead">Tyhle věty se doplní do potvrzení objednávky a do e-mailu s poukazem. Údaje o objednávce, částky a platební údaje se doplňují samy. Ve větách jde použít <b>{cislo}</b> (číslo objednávky) a <b>{jmeno}</b> (jméno zákaznice).</p>
      ${MAIL_FIELDS.map(([k, label, hint]) => `
        <label class="field"><span>${esc(label)}${M.texts[k] !== M.defaults[k] ? `<button type="button" class="th-undo" data-action="mailReset" data-arg="${k}">původní</button>` : ''}</span>
          <textarea data-mail="${k}" rows="2" maxlength="400">${esc(M.texts[k])}</textarea>${hint ? `<small class="muted">${esc(hint)}</small>` : ''}</label>`).join('')}
      <div class="mail-actions">
        <button type="button" class="btn btn-accent" data-action="mailSave"><svg class="i"><use href="#i-check"/></svg>Uložit texty</button>
        <button type="button" class="btn btn-ghost" data-action="mailTest" data-arg="order">Poslat zkušební potvrzení</button>
        <button type="button" class="btn btn-ghost" data-action="mailTest" data-arg="voucher">Poslat zkušební poukaz</button>
      </div>
      <p class="muted" style="margin-top:10px">Zkušební e-mail přijde jen vám, na adresu administrace, a nic se kvůli němu nevytváří.</p>`;
  }
  const ShopEditorTab = () => window.ShopEditor?.state?.tab;
  async function saveMail() {
    const body = {};
    document.querySelectorAll('[data-mail]').forEach(t => { body[t.dataset.mail] = t.value; });
    try {
      const r = await api('/api/mail-settings', 'PUT', body);
      M.texts = r.texts; M.defaults = r.defaults; renderMail($('shPane'));
      toast('Texty e-mailů jsou uložené.');
    } catch (err) { if (err.message !== 'unauthorized') toast(err.message, { err: true }); }
  }
  async function testMail(kind) {
    // nejdřív uložit, ať se zkouší to, co je na obrazovce
    const body = {};
    document.querySelectorAll('[data-mail]').forEach(t => { body[t.dataset.mail] = t.value; });
    try {
      const saved = await api('/api/mail-settings', 'PUT', body);
      M.texts = saved.texts; M.defaults = saved.defaults;
      const r = await api('/api/mail-settings', 'POST', { test: kind });
      toast('Zkušební e-mail je na cestě' + (r.to ? ' (' + r.to + ').' : '.'));
    } catch (err) { if (err.message !== 'unauthorized') toast(err.message, { err: true }); }
  }
  window.ShopMail = { render: renderMail };

  // ═══ Zapojení ═══
  Object.assign(ACTIONS, {
    newCoupon: () => openCouponEditor(''),
    couponEdit: a => openCouponEditor(a),
    couponToggle: async a => {
      const c = C.list.find(x => x.code === a); if (!c) return;
      try { const r = await api('/api/coupons', 'PATCH', { ...c, enabled: !c.enabled }); C.list[C.list.indexOf(c)] = r; renderCoupons(); toast(r.enabled ? 'Kód je zapnutý.' : 'Kód je vypnutý.'); }
      catch (err) { if (err.message !== 'unauthorized') toast(err.message, { err: true }); }
    },
    couponDelete: async a => {
      if (!(await ask({ title: `Smazat kód ${a}?`, text: 'Smazat jde jen kód, který ještě nikdo nepoužil.', yes: 'Smazat', danger: true }))) return;
      try { await api('/api/coupons', 'DELETE', { code: a }); C.list = C.list.filter(x => x.code !== a); renderCoupons(); toast('Kód je smazaný.'); }
      catch (err) { if (err.message !== 'unauthorized') toast(err.message, { err: true }); }
    },
    subToggle: async a => {
      const s = N.list.find(x => x.id === a); if (!s) return;
      try { await api('/api/subscribers', 'PATCH', { id: a, unsubscribed: !s.unsubscribed }); s.unsubscribed = !s.unsubscribed; renderSubs(); }
      catch (err) { if (err.message !== 'unauthorized') toast(err.message, { err: true }); }
    },
    subDelete: async a => {
      const s = N.list.find(x => x.id === a); if (!s) return;
      if (!(await ask({ title: 'Smazat odběratele?', text: `${s.email} zmizí ze seznamu. Hodí se na žádost o výmaz údajů.`, yes: 'Smazat', danger: true }))) return;
      try { await api('/api/subscribers', 'DELETE', { id: a }); N.list = N.list.filter(x => x.id !== a); renderSubs(); toast('Odběratel je smazaný.'); }
      catch (err) { if (err.message !== 'unauthorized') toast(err.message, { err: true }); }
    },
    exportSubs,
    mailSave: saveMail,
    mailTest: testMail,
    mailReset: a => { const t = document.querySelector(`[data-mail="${a}"]`); if (t && M.defaults) { t.value = M.defaults[a]; } },
    openMore: () => openSheet('moreSheet'),
  });
  $('couponForm').addEventListener('submit', saveCoupon);
  $('cpType').addEventListener('change', updateValueUnit);
  $('subSearch').addEventListener('input', e => { N.q = e.target.value.trim(); renderSubs(); });

  window.ExtraViews = {
    show(v) {
      if (v === 'slevy') { if (!C.loaded) loadCoupons(); else renderCoupons(); }
      if (v === 'newsletter') { if (!N.loaded) loadSubs(); else renderSubs(); }
    },
  };
  const v = document.querySelector('.view:not([hidden])')?.dataset.view;
  if (v === 'slevy' || v === 'newsletter') window.ExtraViews.show(v);
})();
