'use strict';
// Vánoční výzdoba: sníh s hloubkou, teplá rozostřená světla v sekci „Vánoce“ a odpočet do Štědrého dne.
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

  // ── rozostřená světla, jako když se fotí stromek mimo ostrost ──
  let lights = null;
  function drawLights() {
    if (!section) return;
    if (!lights) {
      lights = document.createElement('canvas'); lights.className = 'xm-bokeh'; lights.setAttribute('aria-hidden', 'true');
      section.prepend(lights);
      if ('ResizeObserver' in window) {
        let seen = '';
        new ResizeObserver(() => {
          const key = section.clientWidth + 'x' + section.clientHeight;
          if (active && key !== seen) { seen = key; drawLights(); }
        }).observe(section);
      }
    }
    const w = section.clientWidth, h = section.clientHeight;
    if (!w || !h) return;
    const k = Math.min(1.5, devicePixelRatio || 1);
    lights.width = w * k; lights.height = h * k;
    const g = lights.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    g.globalCompositeOperation = 'lighter';
    let seed = 7;                                   // pevné rozložení, ať světla při změně šířky neskáčou
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const warm = ['255,184,92', '255,206,128', '255,164,74', '255,226,170', '226,128,72'];
    const spot = (x, y, r, color, a) => {           // kolečko objektivu: skoro rovná plocha s jemným jasnějším okrajem
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${color},${a * 0.75})`);
      gr.addColorStop(0.72, `rgba(${color},${a * 0.8})`);
      gr.addColorStop(0.86, `rgba(${color},${a})`);
      gr.addColorStop(1, `rgba(${color},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
    };
    const unit = Math.max(0.6, Math.min(1.25, w / 1200));
    // dva volné oblouky světel (jako navinuté na větvích) a pár dalších kolem
    for (const [from, mid, to, count] of [[0.02, 0.2, 0.06, 46], [0.16, 0.02, 0.3, 30]]) {
      for (let i = 0; i < count; i++) {
        const t = (i + rnd() * 0.8) / count;
        const x = t * w;
        const y = ((1 - t) ** 2 * from + 2 * (1 - t) * t * mid + t ** 2 * to) * Math.min(h, w < 700 ? 300 : 640) + (rnd() - 0.5) * 36;
        spot(x, y, (5 + rnd() ** 2 * 20) * unit, warm[(rnd() * warm.length) | 0], 0.14 + rnd() * 0.3);
        if (rnd() < 0.35) spot(x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 30, 1.6 * unit, '255,236,200', 0.85);
      }
    }
    for (let i = 0; i < 26; i++) {
      const edge = rnd() < 0.5 ? rnd() * 0.22 : 0.78 + rnd() * 0.22;
      spot(edge * w, h * (0.35 + rnd() * 0.65), (14 + rnd() * 44) * unit, warm[(rnd() * warm.length) | 0], 0.05 + rnd() * 0.1);
    }
  }

  // ── sníh: tři vzdálenosti, bližší vločky jsou větší, rychlejší a rozostřené, vítr se pomalu mění ──
  let canvas = null, ctx = null, flakes = [], sprites = null, raf = 0, last = 0, clock = 0, toggle = null;
  const LAYERS = [
    { share: 0.62, r: [0.9, 1.9], v: [16, 28], a: [0.45, 0.75], sprite: 0 },
    { share: 0.31, r: [2, 3.4], v: [30, 48], a: [0.55, 0.85], sprite: 1 },
    { share: 0.07, r: [5, 10], v: [55, 85], a: [0.25, 0.45], sprite: 2 },
  ];
  // vločka je měkký chumáček bez obrysu; lehce modrošedý, aby byl vidět i na světlém pozadí
  function makeSprite(core) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(198,207,232,1)');
    gr.addColorStop(core, 'rgba(194,203,229,.9)');
    gr.addColorStop(1, 'rgba(188,198,226,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return c;
  }
  const snowWanted = () => { try { return localStorage.getItem(SNOW_KEY) !== 'off'; } catch { return true; } };
  const between = ([a, b]) => a + Math.random() * (b - a);
  function newFlake(layer, anywhere) {
    const L = LAYERS[layer];
    return { layer, x: Math.random() * (innerWidth + 80) - 40, y: anywhere ? Math.random() * innerHeight : -24,
      r: between(L.r), v: between(L.v), a: between(L.a), p: Math.random() * 6.28, f: 0.5 + Math.random(), sway: 4 + Math.random() * 12 };
  }
  function size() {
    if (!canvas) return;
    const k = Math.min(2, devicePixelRatio || 1);
    canvas.width = innerWidth * k; canvas.height = innerHeight * k;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const total = innerWidth < 700 ? 60 : 130;
    flakes = [];
    LAYERS.forEach((L, i) => { for (let n = 0; n < Math.round(total * L.share); n++) flakes.push(newFlake(i, true)); });
  }
  function paint(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now; clock += dt;
    const wind = Math.sin(clock * 0.13) * 14 + Math.sin(clock * 0.41 + 2) * 7;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const f of flakes) {
      f.y += f.v * dt; f.p += dt * f.f; f.x += wind * (0.35 + f.layer * 0.4) * dt;
      if (f.y > innerHeight + 24) Object.assign(f, newFlake(f.layer, false));
      if (f.x > innerWidth + 40) f.x = -40; else if (f.x < -40) f.x = innerWidth + 40;
      const x = f.x + Math.sin(f.p) * f.sway, d = f.r * 3;
      ctx.globalAlpha = f.a;
      ctx.drawImage(sprites[LAYERS[f.layer].sprite], x - d / 2, f.y - d / 2, d, d);
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(paint);
  }
  function snow(on) {
    cancelAnimationFrame(raf); raf = 0;
    if (!on) { canvas?.remove(); canvas = null; return; }
    if (!canvas) {
      sprites = sprites || [makeSprite(0.42), makeSprite(0.3), makeSprite(0.06)];
      canvas = document.createElement('canvas'); canvas.className = 'xm-snow'; canvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(canvas); ctx = canvas.getContext('2d'); size();
    }
    last = performance.now(); raf = requestAnimationFrame(paint);
  }
  function snowButton() {
    if (toggle || reduce.matches) return;
    toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'xm-toggle'; toggle.textContent = 'Sníh';
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
      drawLights(); snowButton(); if (toggle) toggle.hidden = false;
      snow(!reduce.matches && snowWanted());
    } else {
      snow(false); if (toggle) toggle.hidden = true;
    }
    try { window.ScrollTrigger && window.ScrollTrigger.refresh(); } catch {}
  }
  const wanted = () => root.dataset.xmas !== 'off' && inSeason(today());

  let timer = 0;
  addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(() => { if (active) { drawLights(); size(); } }, 150); });
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
