'use strict';
// Sága Art: úvodní animace. Balíček fotek se složí na sebe, vrchní fotka přeletí
// na své místo v hero, pak vyjedou řádky nadpisu a sjede navigace.
// Jen při prvním příchodu během návštěvy; klik nebo klávesa ji přeskočí.

(() => {
  const intro = document.getElementById('intro');
  if (!intro) return;
  const root = document.documentElement;

  let seen = false;
  try { seen = sessionStorage.getItem('sa_intro') === '1'; } catch {}
  const skip = seen
    || matchMedia('(prefers-reduced-motion: reduce)').matches
    || location.hash || scrollY > 10
    || !('animate' in Element.prototype);

  if (skip) { intro.remove(); return; }
  try { sessionStorage.setItem('sa_intro', '1'); } catch {}

  root.classList.add('intro-play', 'intro-fly');
  document.body.style.overflow = 'hidden';
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  scrollTo(0, 0);

  const cards = [...intro.querySelectorAll('.intro-card')];
  const letters = [...intro.querySelectorAll('.intro-word span')];
  const EASE = 'cubic-bezier(.76,0,.24,1)';
  const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let finished = false, skipping = false;

  const decoded = Promise.all(cards.map(c => {
    const img = c.querySelector('img');
    return img.decode ? img.decode().catch(() => {}) : Promise.resolve();
  }));

  // Přesun karty na místo cíle (left/top/width/height, aby se fotka nedeformovala)
  function flyTo(card, target, duration) {
    const from = card.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    Object.assign(card.style, { position: 'fixed', zIndex: 1001, margin: 0, inset: 'auto', left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px' });
    document.body.appendChild(card);
    return card.animate([
      { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px', transform: getComputedStyle(card).transform, borderRadius: '3px' },
      { left: to.left + 'px', top: to.top + 'px', width: to.width + 'px', height: to.height + 'px', transform: 'none', borderRadius: '3px', boxShadow: '0 0 0 rgba(0,0,0,0)' },
    ], { duration, easing: EASE, fill: 'forwards' }).finished;
  }

  async function run() {
    // název vyjede hned, zatímco se dotahují fotky
    letters.forEach((l, i) => l.animate(
      [{ transform: 'translateY(110%)' }, { transform: 'none' }],
      { duration: 900, delay: 100 + i * 45, easing: EASE_OUT, fill: 'backwards' }));
    await Promise.race([decoded, wait(1200)]);
    if (skipping) return;

    // 1) fotky se rychle skládají na sebe
    cards.forEach((c, i) => {
      const rot = Number(c.dataset.rot || 0);
      c.animate([
        { opacity: 0, transform: `translateY(40px) scale(1.12) rotate(${rot * 2}deg)` },
        { opacity: 1, transform: `rotate(${rot}deg)` },
      ], { duration: 650, delay: i * 150, easing: EASE_OUT, fill: 'forwards' });
    });
    await wait(cards.length * 150 + 650);
    if (skipping) return;

    // 2) vrchní fotka přeletí do hero, Duna do malého rámečku, zbytek zmizí
    const flights = [];
    cards.forEach(c => {
      const slot = c.dataset.target;
      const t = slot && /^[a-z0-9]+$/.test(slot) ? document.querySelector('[data-slot="' + slot + '"]') : null;
      if (t && t.getBoundingClientRect().width > 0) flights.push(flyTo(c, t, 1100));
      else c.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.92)' }], { duration: 450, easing: EASE, fill: 'forwards' });
    });
    letters.forEach((l, i) => l.animate(
      [{ transform: 'none' }, { transform: 'translateY(-110%)' }],
      { duration: 600, delay: i * 25, easing: EASE, fill: 'forwards' }));
    intro.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, delay: 350, easing: 'ease', fill: 'forwards' });

    await wait(650);
    reveal();
    await Promise.race([Promise.all(flights), wait(1400)]);   // pojistka, kdyby prohlížeč animace pozastavil
    finish();
  }

  // 3) text hero, malá fotka a navigace
  function reveal() {
    if (root.classList.contains('hero-in')) return;
    root.classList.add('hero-in');
    // další snímek, ať se přechody spustí; pojistka pro kartu na pozadí, kde snímky neběží
    const show = () => root.classList.remove('intro-play');
    requestAnimationFrame(show);
    setTimeout(show, 60);
  }

  function finish() {
    if (finished) return;
    finished = true;
    reveal();
    document.body.style.overflow = '';
    root.classList.remove('intro-fly');
    cards.forEach(c => c.remove());
    intro.remove();
    setTimeout(() => root.classList.remove('intro-play', 'hero-in'), 2200);
  }

  // přeskočení klikem nebo klávesou
  function skipNow() {
    if (finished) return;
    skipping = true;
    finish();
  }
  intro.addEventListener('click', skipNow);
  addEventListener('keydown', skipNow, { once: true });
  addEventListener('wheel', skipNow, { once: true, passive: true });
  addEventListener('touchmove', skipNow, { once: true, passive: true });

  run();
})();
