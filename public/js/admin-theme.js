'use strict';
// Sága Art · administrace: Vzhled webu (barvy, písma, tvary, texty, odkazy) s živým náhledem.
// Používá pomocné funkce z admin.js (api, esc, toast, ask, openSheet, closeSheet, ACTIONS).
// Náhled je stránka e-shopu v rámu (/?preview=1). Nastavení se do ní posílá zprávou (postMessage, jen vlastní doména).

(() => {
  const COLOR_LABELS = [
    ['bg', 'Pozadí stránky', 'Hlavní plocha webu'],
    ['paper', 'Karty a panely', 'Košík, okna, karty šperků'],
    ['ink', 'Text', 'Hlavní barva písma'],
    ['ink2', 'Jemný text', 'Popisky a vedlejší texty'],
    ['accent', 'Hlavní barva', 'Odkazy, zvýraznění, ikony'],
    ['accentDark', 'Tlačítka', 'Pozadí tlačítek a čísla v košíku'],
    ['pink', 'Pozadí sekce A', 'Poukazy, jemné plochy'],
    ['sea', 'Pozadí sekce B', 'Materiály, doprava'],
    ['lilac', 'Pozadí sekce C', 'Další jemné plochy'],
    ['line', 'Linky a okraje', 'Čáry mezi sekcemi'],
  ];
  const PRESETS = [
    ['Perlová', { bg: '#f8f7fb', paper: '#fefdff', ink: '#3e3a52', ink2: '#5b566e', accent: '#83639f', accentDark: '#6a5089', pink: '#f8e9ef', sea: '#e6f2f1', lilac: '#efe9f7', line: '#e0dbe9' }],
    ['Mořská', { bg: '#f3f8f8', paper: '#fcfefe', ink: '#23393d', ink2: '#44595d', accent: '#3f8f8b', accentDark: '#2d6f6c', pink: '#e6f0f2', sea: '#dff0ee', lilac: '#e9f1f5', line: '#d3e3e3' }],
    ['Růžový pudr', { bg: '#fbf6f6', paper: '#fffdfd', ink: '#4a3438', ink2: '#6b5256', accent: '#b5707f', accentDark: '#98546a', pink: '#f7e4e7', sea: '#f1e8e4', lilac: '#f4e9ee', line: '#ecdcdf' }],
    ['Šalvěj', { bg: '#f5f7f2', paper: '#fcfdfa', ink: '#2f3a31', ink2: '#4f5b50', accent: '#6f8f6a', accentDark: '#557552', pink: '#efe8e2', sea: '#e4eee3', lilac: '#eaeee6', line: '#dbe2d6' }],
    ['Zlatá', { bg: '#faf7f0', paper: '#fffdf8', ink: '#3b342a', ink2: '#5f564a', accent: '#b08d5b', accentDark: '#8a6b3d', pink: '#f3e9dc', sea: '#ece8dc', lilac: '#f1ece1', line: '#e5dccb' }],
    ['Noc', { bg: '#1f1d29', paper: '#272535', ink: '#efeaf7', ink2: '#b9b3c9', accent: '#b79ad6', accentDark: '#8c6bb0', pink: '#2f2b40', sea: '#232a33', lilac: '#2b2840', line: '#3a3650' }],
  ];
  const LINK_FIELDS = [
    ['instagram', 'Instagram', 'https://www.instagram.com/vase-stranka'],
    ['facebook', 'Facebook', 'https://www.facebook.com/vase-stranka'],
  ];

  const $ = id => document.getElementById(id);
  const clone = v => JSON.parse(JSON.stringify(v));
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const lum = h => rgb(h).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const HEX = /^#[0-9a-fA-F]{6}$/;

  const T = {
    loaded: false, tab: 'colors', fonts: [], defaults: null, history: [], fields: [],
    saved: null,      // co je právě na webu
    cur: null,        // co upravuji
    frameReady: false, timer: 0,
  };

  const emptySettings = () => ({ theme: clone(T.defaults), texts: {}, links: {}, flags: { announce: false, promo: false }, images: {}, sections: [], seo: {}, tracking: {} });
  const normalize = x => { x.images = x.images || {}; x.sections = x.sections || []; x.seo = x.seo || {}; x.tracking = x.tracking || {}; x.flags = x.flags || { announce: false, promo: false }; return x; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const dirty = () => T.cur && T.saved && !same(T.cur, T.saved);

  // ── Nastavení → podoba pro náhled (jako veřejné /api/site) ──
  function toPreview(s) {
    const f = key => T.fonts.find(x => x.key === key) || T.fonts[0];
    const h = f(s.theme.fonts.heading), b = f(s.theme.fonts.body);
    const keys = [...new Set([h, b])];
    return {
      theme: { colors: s.theme.colors, radius: s.theme.radius, scale: s.theme.scale,
        fonts: { heading: h.css, body: b.css },
        fontsUrl: 'https://fonts.googleapis.com/css2?' + keys.map(k => 'family=' + k.gf).join('&') + '&display=swap' },
      texts: s.texts, links: s.links, flags: s.flags, images: s.images, sections: s.sections, seo: s.seo, tracking: s.tracking,
    };
  }
  function pushPreview() {
    const fr = $('thFrame');
    if (!T.cur || !T.frameReady || !fr?.contentWindow) return;
    fr.contentWindow.postMessage({ type: 'sa-preview', settings: toPreview(T.cur) }, location.origin);
  }
  const schedule = () => { clearTimeout(T.timer); T.timer = setTimeout(() => { pushPreview(); renderDirty(); }, 120); };
  function renderDirty() {
    const d = dirty();
    $('thDirty').hidden = !d;
    $('thSave').disabled = !d;
  }

  // ── Texty webu: seznam se bere přímo z úvodní stránky (prvky s data-cms) ──
  async function loadFields() {
    const html = await (await fetch('/', { headers: { Accept: 'text/html' } })).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    T.imgSlots = []; T.sectionDefs = [];
    T.fields = [...doc.querySelectorAll('[data-cms]')].map(el => {
      const multi = el.hasAttribute('data-cms-multiline');
      const def = multi ? [...el.childNodes].map(n => (n.nodeName === 'BR' ? '\n' : n.textContent)).join('') : el.textContent;
      return { key: el.getAttribute('data-cms'), label: el.getAttribute('data-cms-label') || el.getAttribute('data-cms'),
        group: el.getAttribute('data-cms-group') || 'Ostatní', def: def.replace(/ /g, ' ').trim(), multi };
    }).filter(f => f.key !== 'announce-text' && !f.key.startsWith('promo-'));
    const slots = new Map();
    doc.querySelectorAll('[data-cms-img]').forEach(el => {
      const key = el.getAttribute('data-cms-img');
      if (!slots.has(key) || el.getAttribute('data-cms-label')) {
        slots.set(key, { key, label: el.getAttribute('data-cms-label') || slots.get(key)?.label || key,
          group: el.getAttribute('data-cms-group') || slots.get(key)?.group || 'Ostatní', def: el.getAttribute('src') || '' });
      }
    });
    T.imgSlots = [...slots.values()];
    T.sectionDefs = [...doc.querySelectorAll('[data-section]')].map(el => ({ id: el.getAttribute('data-section'), label: el.getAttribute('data-section-label') || el.getAttribute('data-section') }));
  }

  // ── Vykreslení panelů ──
  function renderPane() {
    const pane = $('thPane');
    const s = T.cur;
    if (!s) { pane.innerHTML = '<p class="muted">Načítám…</p>'; return; }

    if (T.tab === 'colors') {
      const c = s.theme.colors;
      const warns = [];
      if (ratio(c.ink, c.bg) < 4.5) warns.push('Text na pozadí je špatně čitelný.');
      if (ratio(c.ink2, c.bg) < 3) warns.push('Jemný text na pozadí je špatně čitelný.');
      pane.innerHTML = `
        <p class="th-h">Hotové kombinace</p>
        <div class="th-presets">${PRESETS.map(([name, col], i) => `
          <button type="button" class="th-preset ${same(col, c) ? 'is-on' : ''}" data-action="thPreset" data-arg="${i}">
            <span class="th-sw">${['bg', 'accentDark', 'pink', 'sea'].map(k => `<i style="background:${col[k]}"></i>`).join('')}</span>${esc(name)}
          </button>`).join('')}</div>
        <p class="th-h">Vlastní barvy</p>
        ${COLOR_LABELS.map(([k, label, hint]) => `
          <div class="th-color">
            <label for="thc-${k}"><b>${esc(label)}</b><small>${esc(hint)}</small></label>
            <span class="th-color-in"><input type="color" id="thc-${k}" data-th-color="${k}" value="${esc(c[k])}" aria-label="${esc(label)}">
            <input type="text" data-th-hex="${k}" value="${esc(c[k])}" maxlength="7" spellcheck="false" autocomplete="off" aria-label="${esc(label)} (kód barvy)"></span>
          </div>`).join('')}
        ${warns.length ? `<p class="th-warn" role="alert">${warns.map(esc).join(' ')} Web takové barvy neuloží.</p>` : ''}`;
    }

    if (T.tab === 'fonts') {
      const opt = (kind, sel) => T.fonts.filter(f => f.kind === kind).map(f => `<option value="${esc(f.key)}" ${f.key === sel ? 'selected' : ''}>${esc(f.label)}</option>`).join('');
      const fam = key => (T.fonts.find(f => f.key === key) || T.fonts[0]).css;
      pane.innerHTML = `
        <label class="field"><span>Písmo nadpisů</span>
          <select class="select" id="thFontH">${opt('serif', s.theme.fonts.heading)}<optgroup label="Bezpatková">${opt('sans', s.theme.fonts.heading)}</optgroup></select></label>
        <div class="th-sample" style="font-family:${esc(fam(s.theme.fonts.heading))};font-size:1.7rem" id="thSampleH">Šperky s příběhem</div>
        <label class="field"><span>Písmo textu</span>
          <select class="select" id="thFontB">${opt('sans', s.theme.fonts.body)}<optgroup label="Patková">${opt('serif', s.theme.fonts.body)}</optgroup></select></label>
        <div class="th-sample" style="font-family:${esc(fam(s.theme.fonts.body))}" id="thSampleB">Ručně tvořím šperky z pravých říčních perel a přírodních minerálů.</div>
        <label class="field"><span>Velikost písma na webu <b id="thScaleV">${s.theme.scale} %</b></span>
          <input type="range" id="thScale" min="90" max="115" step="1" value="${s.theme.scale}"></label>
        <p class="muted">Písma jsou z Google Fonts a mají všechna česká písmena.</p>`;
    }

    if (T.tab === 'shape') {
      pane.innerHTML = `
        <label class="field"><span>Zaoblení rohů <b id="thRadiusV">${s.theme.radius} px</b></span>
          <input type="range" id="thRadius" min="0" max="28" step="1" value="${s.theme.radius}"></label>
        <p class="muted">0 jsou ostré rohy, vyšší číslo dělá tlačítka a karty měkčí. Zaoblení se projeví tam, kde web používá společné zaoblení.</p>`;
    }

    if (T.tab === 'texts') {
      const groups = [];
      T.fields.forEach(f => { let g = groups.find(x => x.name === f.group); if (!g) groups.push(g = { name: f.group, items: [] }); g.items.push(f); });
      pane.innerHTML = `<p class="muted" style="margin-bottom:12px">Prázdné pole znamená původní text. Odkazy v textech a obrázky se tu nemění.</p>` + groups.map(g => `
        <details class="th-group" ${g.name === groups[0].name ? 'open' : ''}><summary>${esc(g.name)}</summary>
          ${g.items.map(f => {
            const v = s.texts[f.key] ?? '';
            const long = f.multi || f.def.length > 70;
            return `<label class="field th-text"><span>${esc(f.label)}${v ? `<button type="button" class="th-undo" data-action="thTextReset" data-arg="${esc(f.key)}">původní</button>` : ''}</span>
              ${long ? `<textarea data-th-text="${esc(f.key)}" rows="${f.multi ? 2 : 3}" maxlength="600" placeholder="${esc(f.def)}">${esc(v)}</textarea>`
                     : `<input type="text" data-th-text="${esc(f.key)}" maxlength="600" value="${esc(v)}" placeholder="${esc(f.def)}">`}</label>`;
          }).join('')}
        </details>`).join('');
    }

    if (T.tab === 'promo') {
      const txt = (key, label, ph, max, rows) => `<label class="field"><span>${esc(label)}</span>${rows
        ? `<textarea data-th-text="${key}" rows="${rows}" maxlength="${max}" placeholder="${esc(ph)}">${esc(s.texts[key] || '')}</textarea>`
        : `<input type="text" data-th-text="${key}" maxlength="${max}" value="${esc(s.texts[key] || '')}" placeholder="${esc(ph)}">`}</label>`;
      pane.innerHTML = `
        <p class="muted" style="margin-bottom:12px">Velký blok s akcí pod úvodními fotkami. Napište, co chcete (třeba slevu, dárek k nákupu nebo jen vzkaz zákazníkům). Prázdná pole se na webu neukážou. Až akce skončí, blok vypněte.</p>
        <label class="th-switch"><input type="checkbox" id="thPromoOn" ${s.flags.promo ? 'checked' : ''}><span>Zobrazit akci na webu</span></label>
        ${txt('promo-label', 'Malý nadpis nad titulkem', 'Např. Vánoční akce', 40)}
        ${txt('promo-title', 'Velký nadpis', 'Např. Letos si dárek vyberete s mojí slevou', 120, 2)}
        ${txt('promo-lead', 'Úvodní text (nepovinný)', 'Krátký text pod nadpisem', 400, 3)}
        <p class="th-h">První akce</p>
        ${txt('promo-1-big', 'Velké číslo nebo slovo', 'Např. -15 %', 12)}
        ${txt('promo-1-title', 'Nadpis', 'Např. Sleva na všechny náušnice', 80)}
        ${txt('promo-1-text', 'Text', 'Kdy akce platí a co k ní patří', 300, 3)}
        ${txt('promo-1-note', 'Poznámka (nepovinná)', 'Např. Platí do 24. 12.', 80)}
        <p class="th-h">Druhá akce (nepovinná)</p>
        ${txt('promo-2-big', 'Velké číslo nebo slovo', 'Např. Zdarma', 12)}
        ${txt('promo-2-title', 'Nadpis', 'Např. Doprava zdarma', 80)}
        ${txt('promo-2-text', 'Text', 'Podmínky akce', 300, 3)}
        ${txt('promo-2-note', 'Poznámka (nepovinná)', 'Např. Od nákupu nad 1 490 Kč', 80)}
        <p class="th-h">Tlačítko (nepovinné)</p>
        ${txt('promo-btn', 'Text tlačítka', 'Např. Prohlédnout šperky', 40)}
        <label class="field"><span>Kam tlačítko vede</span><input type="url" data-th-link="promo" maxlength="300" value="${esc(s.links.promo || '')}" placeholder="https://… nebo #produkty"></label>
        <p class="muted">Tlačítko se ukáže, jen když je vyplněný text i odkaz. Změny vidíte hned v náhledu, na web se dostanou až po uložení.</p>`;
    }

    if (T.tab === 'links') {
      const l = s.links;
      pane.innerHTML = `
        <p class="th-h">Oznámení nad hlavičkou</p>
        <label class="th-switch"><input type="checkbox" id="thAnnounceOn" ${s.flags.announce ? 'checked' : ''}><span>Zobrazit oznámení</span></label>
        <label class="field"><span>Text oznámení</span><input type="text" data-th-text="announce-text" maxlength="160" value="${esc(s.texts['announce-text'] || '')}" placeholder="Např. Doprava Zásilkovnou zdarma od 1 490 Kč"></label>
        <label class="field"><span>Odkaz (nepovinný)</span><input type="url" data-th-link="announce" maxlength="300" value="${esc(l.announce || '')}" placeholder="https://… nebo #poukazy"></label>
        <p class="th-h">Kontakt a sociální sítě</p>
        <label class="field"><span>Kontaktní e-mail</span><input type="email" data-th-link="email" maxlength="254" value="${esc(l.email || '')}" placeholder="postmaster@sagaart.cz"></label>
        ${LINK_FIELDS.map(([k, label, ph]) => `<label class="field"><span>${esc(label)}</span><input type="url" data-th-link="${k}" maxlength="300" value="${esc(l[k] || '')}" placeholder="${esc(ph)}"></label>`).join('')}
        <p class="muted">Sociální sítě bez odkazu se v patičce neukážou. Odkaz musí začínat https://.</p>`;
    }
    if (T.tab === 'images') {
      const groups = [];
      const slots = [...T.imgSlots, { key: 'logo', label: 'Logo (místo textu Sága Art v hlavičce)', group: 'Značka', def: '' }, { key: 'favicon', label: 'Ikona webu (v záložce prohlížeče)', group: 'Značka', def: '' }];
      slots.forEach(f => { let g = groups.find(x => x.name === f.group); if (!g) groups.push(g = { name: f.group, items: [] }); g.items.push(f); });
      pane.innerHTML = `<p class="muted" style="margin-bottom:12px">Nahrajte fotku (JPG, PNG nebo WebP do 10 MB). Web ji sám zmenší, vložte klidně tu největší.</p>` + groups.map(g => `
        <details class="th-group" ${g.name === 'Úvod' || g.name === 'Značka' ? 'open' : ''}><summary>${esc(g.name)}</summary>
          ${g.items.map(f => {
            const url = s.images[f.key] || '';
            const shown = url || f.def;
            return `<div class="th-img">
              <span class="th-img-pic">${shown ? `<img src="${esc(shown)}" alt="">` : '<i>bez obrázku</i>'}</span>
              <span class="th-img-info"><b>${esc(f.label)}</b>
                <small>${url ? 'vlastní fotka' : (f.def ? 'původní fotka' : 'nenastaveno')}</small>
                <span class="th-img-btns"><button type="button" class="btn btn-ghost btn-sm" data-action="thImgPick" data-arg="${esc(f.key)}">${url ? 'Změnit' : 'Nahrát'}</button>
                ${url ? `<button type="button" class="th-undo" data-action="thImgReset" data-arg="${esc(f.key)}">původní</button>` : ''}</span>
                <small class="th-img-status" id="thImgSt-${esc(f.key)}"></small></span></div>`;
          }).join('')}
        </details>`).join('');
    }

    if (T.tab === 'sections') {
      const defs = T.sectionDefs.length ? T.sectionDefs : (T.sectionIds || []).map(id => ({ id, label: id }));
      const list = s.sections.length ? s.sections.map(x => ({ ...x, label: defs.find(d => d.id === x.id)?.label || x.id }))
        .concat(defs.filter(d => !s.sections.some(x => x.id === d.id)).map(d => ({ id: d.id, label: d.label, show: true })))
        : defs.map(d => ({ id: d.id, label: d.label, show: true }));
      const locked = T.locked || ['products'];
      pane.innerHTML = `<p class="muted" style="margin-bottom:12px">Posouvejte sekce šipkami a skrývejte, co zrovna nechcete ukazovat. Úvodní fotky nahoře a patička zůstávají vždy.</p>
        <div class="th-sections">${list.map((x, i) => `
          <div class="th-sec ${x.show ? '' : 'is-off'}">
            <label class="th-switch"><input type="checkbox" data-th-sec="${esc(x.id)}" ${x.show ? 'checked' : ''} ${locked.includes(x.id) ? 'disabled' : ''}><span>${esc(x.label)}${locked.includes(x.id) ? '<small>vždy zobrazená</small>' : ''}</span></label>
            <span class="th-sec-mv"><button type="button" class="icon-btn" data-action="thSecMove" data-arg="${i}:-1" aria-label="Posunout nahoru" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="icon-btn" data-action="thSecMove" data-arg="${i}:1" aria-label="Posunout dolů" ${i === list.length - 1 ? 'disabled' : ''}>↓</button></span>
          </div>`).join('')}</div>
        <button type="button" class="th-undo" style="margin-top:10px" data-action="thSecReset">Vrátit původní pořadí</button>`;
      T.secList = list;
    }

    if (T.tab === 'seo') {
      const t = s.seo.title || '', d = s.seo.description || '';
      const defT = 'Sága Art | Ručně vyráběné šperky z pravých perel';
      pane.innerHTML = `
        <p class="muted" style="margin-bottom:12px">Takhle se web ukáže ve vyhledávači. Prázdné pole znamená původní text.</p>
        <label class="field"><span>Titulek stránky <b id="thSeoTc">${t.length} / 70</b></span><input type="text" data-th-seo="title" maxlength="70" value="${esc(t)}" placeholder="${esc(defT)}"></label>
        <label class="field"><span>Popis ve vyhledávači <b id="thSeoDc">${d.length} / 200</b></span><textarea data-th-seo="description" rows="4" maxlength="200" placeholder="Krátký popis, co na webu najdou (zhruba 150 znaků)">${esc(d)}</textarea></label>
        <div class="th-serp"><small>sagaart.cz</small><b id="thSerpT">${esc(t || defT)}</b><span id="thSerpD">${esc(d || 'Ručně vyráběné šperky z pravých říčních perel, přírodních minerálů a nerezové oceli…')}</span></div>
        <p class="muted" style="margin-top:12px">Změna se ve vyhledávačích objeví, až web znovu projdou (dny až týdny). Náhled při sdílení na sociálních sítích zatím bere původní údaje.</p>
        <p class="th-h" style="margin-top:22px">Měření návštěvnosti</p>
        <p class="muted" style="margin-bottom:12px">Nepovinné. Bez ID se nic neměří. S ID se měří jen návštěvníci, kteří v liště cookies souhlasí.</p>
        <label class="field"><span>Google Analytics 4: ID měření</span><input type="text" data-th-track="gaId" maxlength="20" value="${esc(s.tracking.gaId || '')}" placeholder="G-AB12CD34EF" autocomplete="off" spellcheck="false"></label>
        <label class="field"><span>Meta Pixel: ID (reklamy na Facebooku a Instagramu)</span><input type="text" data-th-track="metaPixel" maxlength="20" value="${esc(s.tracking.metaPixel || '')}" placeholder="jen číslice" autocomplete="off" inputmode="numeric"></label>`;
    }

    document.querySelectorAll('.theme-tab').forEach(b => {
      const on = b.dataset.arg === T.tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  // ── Události v panelu ──
  function onInput(e) {
    const s = T.cur; if (!s) return;
    const t = e.target;
    if (t.dataset.thColor) {
      s.theme.colors[t.dataset.thColor] = t.value.toLowerCase();
      const hx = document.querySelector(`[data-th-hex="${t.dataset.thColor}"]`); if (hx) hx.value = t.value.toLowerCase();
    } else if (t.dataset.thHex) {
      let v = t.value.trim(); if (v && v[0] !== '#') v = '#' + v;
      if (!HEX.test(v)) return;
      s.theme.colors[t.dataset.thHex] = v.toLowerCase();
      const pk = document.querySelector(`[data-th-color="${t.dataset.thHex}"]`); if (pk) pk.value = v.toLowerCase();
    } else if (t.id === 'thFontH' || t.id === 'thFontB') {
      s.theme.fonts[t.id === 'thFontH' ? 'heading' : 'body'] = t.value;
      renderPane();
    } else if (t.id === 'thScale') {
      s.theme.scale = Number(t.value); $('thScaleV').textContent = t.value + ' %';
    } else if (t.id === 'thRadius') {
      s.theme.radius = Number(t.value); $('thRadiusV').textContent = t.value + ' px';
    } else if (t.dataset.thText) {
      const v = t.value; if (v.trim()) s.texts[t.dataset.thText] = v; else delete s.texts[t.dataset.thText];
    } else if (t.dataset.thLink) {
      const v = t.value.trim(); if (v) s.links[t.dataset.thLink] = v; else delete s.links[t.dataset.thLink];
    } else if (t.id === 'thAnnounceOn') {
      s.flags.announce = t.checked;
    } else if (t.id === 'thPromoOn') {
      s.flags.promo = t.checked;
    } else if (t.dataset.thSec) {
      s.sections = (T.secList || []).map(x => ({ id: x.id, show: x.id === t.dataset.thSec ? t.checked : x.show }));
      t.closest('.th-sec').classList.toggle('is-off', !t.checked);
    } else if (t.dataset.thTrack) {
      const v = t.value.trim(); if (v) s.tracking[t.dataset.thTrack] = v; else delete s.tracking[t.dataset.thTrack];
    } else if (t.dataset.thSeo) {
      const v = t.value; if (v.trim()) s.seo[t.dataset.thSeo] = v; else delete s.seo[t.dataset.thSeo];
      const tc = $('thSeoTc'), dc = $('thSeoDc');
      if (tc) tc.textContent = (s.seo.title || '').length + ' / 70';
      if (dc) dc.textContent = (s.seo.description || '').length + ' / 200';
      if ($('thSerpT')) $('thSerpT').textContent = s.seo.title || 'Sága Art | Ručně vyráběné šperky z pravých perel';
      if ($('thSerpD')) $('thSerpD').textContent = s.seo.description || 'Ručně vyráběné šperky z pravých říčních perel, přírodních minerálů a nerezové oceli…';
    } else return;
    schedule();
    if (T.tab === 'colors' && (t.dataset.thColor || t.dataset.thHex)) updateColorWarn();
  }
  function updateColorWarn() {
    const c = T.cur.theme.colors;
    const bad = ratio(c.ink, c.bg) < 4.5 || ratio(c.ink2, c.bg) < 3;
    let w = document.querySelector('#thPane .th-warn');
    if (bad && !w) { w = document.createElement('p'); w.className = 'th-warn'; w.setAttribute('role', 'alert'); w.textContent = 'Text na pozadí je špatně čitelný. Web takové barvy neuloží.'; $('thPane').appendChild(w); }
    if (!bad && w) w.remove();
  }

  // ── Načtení, uložení ──
  async function load() {
    try {
      const [res] = await Promise.all([api('/api/site-settings'), loadFields().catch(() => { T.fields = []; })]);
      T.fonts = res.options.fonts; T.defaults = res.options.defaults; T.history = res.history;
      T.sectionIds = res.options.sections; T.locked = res.options.lockedSections;
      T.saved = res.settings ? clone(res.settings) : emptySettings();
      T.saved.theme.colors = { ...T.defaults.colors, ...T.saved.theme.colors };
      normalize(T.saved);
      T.cur = clone(T.saved);
      T.loaded = true;
      renderPane(); renderDirty();
      const fr = $('thFrame');
      if (!fr.dataset.ready) { fr.dataset.ready = '1'; fr.src = '/?preview=1'; }
    } catch (err) {
      if (err.message !== 'unauthorized') toast(err.message || 'Vzhled se nepodařilo načíst', { err: true });
    }
  }

  async function save() {
    if (!dirty()) return;
    const btn = $('thSave'); btn.disabled = true;
    try {
      const res = await api('/api/site-settings', 'PUT', T.cur);
      T.history = res.history;
      T.saved = normalize(res.settings ? clone(res.settings) : emptySettings());
      T.cur = clone(T.saved);
      renderPane(); renderDirty();
      toast('Změny jsou na webu. Návštěvníci je uvidí při příštím načtení stránky.');
    } catch (err) {
      if (err.message !== 'unauthorized') toast(err.message, { err: true });
    } finally { renderDirty(); }
  }

  async function reset() {
    if (!(await ask({ title: 'Vrátit původní vzhled?', text: 'Barvy, písma, texty i odkazy se vrátí do původní podoby. Současnou verzi najdete v historii.', yes: 'Vrátit původní', danger: true }))) return;
    try {
      const res = await api('/api/site-settings', 'POST', { reset: true });
      T.history = res.history; T.saved = emptySettings(); T.cur = clone(T.saved);
      renderPane(); renderDirty(); pushPreview();
      toast('Web má zase původní vzhled.');
    } catch (err) { if (err.message !== 'unauthorized') toast(err.message, { err: true }); }
  }

  function discard() {
    if (!dirty()) return;
    T.cur = clone(T.saved); renderPane(); renderDirty(); pushPreview();
    toast('Změny jsou zahozené.');
  }

  function showHistory() {
    const list = $('thHistoryList');
    list.innerHTML = T.history.length ? T.history.map(h => `
      <button type="button" class="th-hist" data-action="thRestore" data-arg="${h.i}">
        <b>${esc(h.at ? new Date(h.at).toLocaleString('cs-CZ', { dateStyle: 'long', timeStyle: 'short' }) : 'Starší verze')}</b>
        <small>Vrátit tuto verzi</small></button>`).join('') : '<p class="muted">Zatím tu nic není. Verze se ukládají při každém zveřejnění.</p>';
    openSheet('themeHistorySheet');
  }
  async function restore(i) {
    try {
      const res = await api('/api/site-settings', 'POST', { restore: Number(i) });
      T.history = res.history; T.saved = normalize(res.settings ? clone(res.settings) : emptySettings()); T.cur = clone(T.saved);
      closeSheet(true); renderPane(); renderDirty(); pushPreview();
      toast('Verze je vrácená na web.');
    } catch (err) { if (err.message !== 'unauthorized') toast(err.message, { err: true }); }
  }

  // ── Zapojení do administrace ──
  Object.assign(ACTIONS, {
    thTab: a => { T.tab = a; renderPane(); },
    thPreset: a => { if (!T.cur) return; T.cur.theme.colors = { ...PRESETS[Number(a)][1] }; renderPane(); schedule(); },
    thTextReset: a => { delete T.cur.texts[a]; renderPane(); schedule(); },
    thSecMove: a => {
      const [i, d] = a.split(':').map(Number); const l = (T.secList || []).slice();
      const j = i + d; if (j < 0 || j >= l.length) return;
      [l[i], l[j]] = [l[j], l[i]];
      T.cur.sections = l.map(x => ({ id: x.id, show: x.show })); renderPane(); schedule();
    },
    thSecReset: () => { T.cur.sections = []; renderPane(); schedule(); },
    thImgPick: a => { T.uploadKey = a; $('thFile').value = ''; $('thFile').click(); },
    thImgReset: a => { delete T.cur.images[a]; renderPane(); schedule(); },
    thScrollPreview: () => $('thPreviewBox').scrollIntoView({ behavior: 'smooth', block: 'start' }),
    thSave: save, thDiscard: discard, thReset: reset, thHistory: showHistory, thRestore: restore,
    thDevice: a => {
      $('thFrameWrap').classList.toggle('is-phone', a === 'phone');
      document.querySelectorAll('[data-action="thDevice"]').forEach(b => { const on = b.dataset.arg === a; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    },
  });
  // nahrání fotky do Cloudinary (stejný postup jako u šperků)
  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.id = 'thFile'; fileInput.accept = 'image/jpeg,image/png,image/webp'; fileInput.hidden = true;
  document.body.appendChild(fileInput);
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]; const key = T.uploadKey; if (!file || !key) return;
    const st = document.getElementById('thImgSt-' + key);
    const say = (m, err) => { if (st) { st.textContent = m; st.style.color = err ? 'var(--bad)' : ''; } };
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) return say('Povolené jsou JPG, PNG a WebP do 10 MB.', true);
    say('Nahrávám…');
    try {
      const url = await uploadImage(file, { keepAlpha: key === 'logo' || key === 'favicon' });
      T.cur.images[key] = url; renderPane(); schedule();
    } catch (err) { if (err.message !== 'unauthorized') say('Fotka se nenahrála: ' + err.message, true); }
  });

  const pane = $('thPane');
  pane.addEventListener('input', onInput);
  pane.addEventListener('change', onInput);
  addEventListener('message', e => {
    if (e.origin !== location.origin || e.source !== $('thFrame')?.contentWindow) return;
    if (e.data && e.data.type === 'sa-preview-ready') { T.frameReady = true; pushPreview(); }
  });
  addEventListener('beforeunload', e => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });

  // admin.js zavolá, když se otevře sekce Vzhled
  window.ThemeEditor = { show() { if (!T.loaded) load(); else { renderDirty(); pushPreview(); } } };
  if (document.querySelector('.view[data-view="vzhled"]') && !document.querySelector('.view[data-view="vzhled"]').hidden) window.ThemeEditor.show();
})();
