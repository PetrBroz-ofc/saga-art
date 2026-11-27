'use strict';
// Vánoční výzdoba: girlanda z perel se světýlky, jemný sníh, sekce „Vánoce“ s odpočtem do Štědrého dne.
// Ukazuje se sama od 15. 11. do 6. 1. a jde vypnout v administraci (Vzhled → Akce).
// theme.js nastaví <html data-xmas="off">, když ji majitelka vypnula.

(() => {
  const root = document.documentElement;
  const section = document.getElementById('vanoce');
  const SNOW_KEY = 'sa_snow';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  // datum podle Prahy, ať odpočet nesedí o den vedle
  function today() {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(new Date()).map(x => [x.type, Number(x.value)]));
    return { y: p.year, m: p.month, d: p.day };
  }
  const inSeason = t => (t.m === 11 && t.d >= 15) || t.m === 12 || (t.m === 1 && t.d <= 6);

  function countdownText(t) {
    if (t.m === 1 || (t.m === 12 && t.d > 24)) return 'Krásné svátky a šťastný nový rok.';
    if (t.m === 12 && t.d === 24) return 'Dnes je Štědrý den. Krásné Vánoce!';
    const days = Math.round((Date.UTC(t.y, 11, 24) - Date.UTC(t.y, t.m - 1, t.d)) / 864e5);
    return days === 1 ? 'Do Štědrého dne zbývá 1 den' : days <= 4 ? 'Do Štědrého dne zbývají ' + days + ' dny' : 'Do Štědrého dne zbývá ' + days + ' dní';
  }

  // ── girlanda ──
  let garland = null;
  function drawGarland() {
    const hero = document.querySelector('.hero');
    if (!hero) return;
    if (!garland) {
      garland = document.createElement('div');
      garland.className = 'xm-garland'; garland.setAttribute('aria-hidden', 'true');
      hero.before(garland);
      // šířka se může změnit i bez události resize (načítání, posuvník, rám náhledu)
      if ('ResizeObserver' in window) {
        let seen = 0;
        new ResizeObserver(e => { const x = Math.round(e[0].contentRect.width); if (x && x !== seen && active) { seen = x; drawGarland(); size(); } }).observe(garland);
      }
    }
    const NS = 'http://www.w3.org/2000/svg';
    const w = Math.max(320, Math.round(garland.getBoundingClientRect().width) || root.clientWidth);
    const swags = Math.max(2, Math.round(w / 260));
    const step = w / swags, top = 4, sag = w < 700 ? 22 : 34, gap = w < 700 ? 15 : 17;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' 90'); svg.setAttribute('width', w); svg.setAttribute('height', 90);
    const add = (tag, attrs, parent = svg) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
    let n = 0;
    for (let s = 0; s < swags; s++) {
      const x0 = s * step, x1 = x0 + step, cx = x0 + step / 2, cy = top + sag * 2;
      add('path', { d: `M${x0} ${top} Q${cx} ${cy} ${x1} ${top}`, class: 'xm-string' });
      const count = Math.floor(step / gap);
      for (let i = 1; i < count; i++) {
        const t = i / count;
        const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t ** 2 * x1;
        const y = (1 - t) ** 2 * top + 2 * (1 - t) * t * cy + t ** 2 * top;
        if (i % 4 === 2) {
          add('circle', { cx: x, cy: y + 7, r: 9, class: 'xm-glow', style: `animation-delay:-${(n * 0.37) % 3}s` });
          add('circle', { cx: x, cy: y + 7, r: 3.6, class: 'xm-bulb xm-bulb-' + (n % 3) });
          n++;
        } else add('circle', { cx: x, cy: y, r: i % 4 === 0 ? 4.2 : 3.2, class: 'xm-pearl' });
      }
      // přívěsek uprostřed oblouku: střídavě hvězdička a baňka
      const my = top + sag;
      add('line', { x1: cx, y1: my, x2: cx, y2: my + 16, class: 'xm-string' });
      if (s % 2 === 0) add('path', { d: `M${cx} ${my + 14} l3 7.2 7.6 .6 -5.8 5 1.8 7.4 -6.6 -4 -6.6 4 1.8 -7.4 -5.8 -5 7.6 -.6z`, class: 'xm-star' });
      else { add('circle', { cx, cy: my + 26, r: 10, class: 'xm-ball' }); add('circle', { cx: cx - 3.4, cy: my + 22.6, r: 2.6, class: 'xm-shine' }); }
    }
    garland.replaceChildren(svg);
  }

  // ── sníh ──
  let canvas = null, ctx = null, flakes = [], raf = 0, last = 0, toggle = null;
  const snowWanted = () => { try { return localStorage.getItem(SNOW_KEY) !== 'off'; } catch { return true; } };
  function size() {
    if (!canvas) return;
    const k = Math.min(2, devicePixelRatio || 1);
    canvas.width = innerWidth * k; canvas.height = innerHeight * k;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const want = innerWidth < 700 ? 22 : 46;
    flakes = Array.from({ length: want }, (_, i) => flakes[i] || newFlake(true));
  }
  function newFlake(anywhere) {
    const big = Math.random() < 0.28;
    return { x: Math.random() * innerWidth, y: anywhere ? Math.random() * innerHeight : -12, r: big ? 4 + Math.random() * 3.5 : 1.4 + Math.random() * 1.8,
      big, v: 14 + Math.random() * 26, sway: 8 + Math.random() * 20, p: Math.random() * 6.28, a: 0.28 + Math.random() * 0.34, spin: Math.random() * 6.28 };
  }
  function paint(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const color = getComputedStyle(root).getPropertyValue('--xm-snow').trim() || '#8d8fc0';
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1; ctx.lineCap = 'round';
    for (const f of flakes) {
      f.y += f.v * dt; f.p += dt; f.spin += dt * 0.4;
      if (f.y > innerHeight + 12) Object.assign(f, newFlake(false));
      const x = f.x + Math.sin(f.p) * f.sway;
      ctx.globalAlpha = f.a;
      if (f.big) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = f.spin + i * Math.PI / 3, ex = x + Math.cos(a) * f.r, ey = f.y + Math.sin(a) * f.r;
          ctx.moveTo(x, f.y); ctx.lineTo(ex, ey);
          const bx = x + Math.cos(a) * f.r * 0.6, by = f.y + Math.sin(a) * f.r * 0.6;
          ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(a + 0.9) * f.r * 0.32, by + Math.sin(a + 0.9) * f.r * 0.32);
          ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(a - 0.9) * f.r * 0.32, by + Math.sin(a - 0.9) * f.r * 0.32);
        }
        ctx.stroke();
      } else { ctx.beginPath(); ctx.arc(x, f.y, f.r, 0, 6.2832); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(paint);
  }
  function snow(on) {
    cancelAnimationFrame(raf); raf = 0;
    if (!on) { canvas?.remove(); canvas = null; return; }
    if (!canvas) {
      canvas = document.createElement('canvas'); canvas.className = 'xm-snow'; canvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(canvas); ctx = canvas.getContext('2d'); flakes = []; size();
    }
    last = performance.now(); raf = requestAnimationFrame(paint);
  }
  function snowButton() {
    if (toggle || reduce.matches) return;
    toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'xm-toggle'; toggle.textContent = '❄';
    const label = () => {
      const on = snowWanted();
      toggle.setAttribute('aria-pressed', String(on)); toggle.classList.toggle('is-off', !on);
      toggle.title = on ? 'Vypnout sněžení' : 'Zapnout sněžení'; toggle.setAttribute('aria-label', toggle.title);
    };
    toggle.addEventListener('click', () => {
      const next = !snowWanted();
      try { localStorage.setItem(SNOW_KEY, next ? 'on' : 'off'); } catch {}
      label(); snow(next);
    });
    label(); document.body.appendChild(toggle);
  }

  // ── zapnout / vypnout ──
  let active = false;
  function set(on) {
    if (on === active) return;
    active = on;
    root.classList.toggle('xmas-on', on);
    if (section) {
      section.hidden = !on;
      const c = section.querySelector('[data-xm-count]'); if (c && on) c.textContent = countdownText(today());
    }
    if (on) {
      drawGarland(); snowButton(); if (toggle) toggle.hidden = false;
      snow(!reduce.matches && snowWanted());
    } else {
      snow(false); garland?.remove(); garland = null; if (toggle) toggle.hidden = true;
    }
    try { window.ScrollTrigger && window.ScrollTrigger.refresh(); } catch {}
  }
  const wanted = () => root.dataset.xmas !== 'off' && inSeason(today());

  let timer = 0;
  addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(() => { if (active) { drawGarland(); size(); } }, 150); });
  document.addEventListener('visibilitychange', () => {
    if (!canvas) return;
    cancelAnimationFrame(raf); raf = 0;
    if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(paint); }
  });

  // počkat na nastavení ze serveru (ať vypnutá výzdoba neproblikne), pak sledovat změny (náhled v administraci)
  const start = () => {
    set(wanted());
    new MutationObserver(() => set(wanted())).observe(root, { attributes: true, attributeFilter: ['data-xmas'] });
  };
  Promise.race([Promise.resolve(window.SaTheme && window.SaTheme.ready), new Promise(r => setTimeout(r, 1500))]).then(start);
})();
