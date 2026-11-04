'use strict';
// Sága Art: pohyb při scrollu (GSAP + ScrollTrigger, obojí uložené v /js/vendor).
// Kdo má v systému omezené animace, dostane web bez pohybu. Bez JS je všechno vidět normálně.

(() => {
  if (!window.gsap || !window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  gsap.defaults({ ease: 'power3.out', duration: 1 });

  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const mm = gsap.matchMedia();

  // Rozdělí text prvku na slova (každé ve vlastním obalu), cite a další prvky nechá být.
  function splitWords(el, cls) {
    if (!el || el.dataset.split) return [];
    el.dataset.split = '1';
    const words = [];
    [...el.childNodes].forEach(node => {
      if (node.nodeType !== 3) return;
      const frag = document.createDocumentFragment();
      node.textContent.split(/( +)/).forEach(part => {
        if (!part) return;
        if (/^ +$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
        const outer = document.createElement('span');
        outer.className = cls;
        const inner = document.createElement('span');
        inner.textContent = part;
        outer.appendChild(inner);
        frag.appendChild(outer);
        words.push(inner);
      });
      node.replaceWith(frag);
    });
    return words;
  }

  mm.add('(prefers-reduced-motion: no-preference)', () => {

    // ── Hero: text se při odjezdu rozplyne, fotky vlevo a vpravo jedou každá jinou rychlostí ──
    const hero = document.querySelector('.hero');
    if (hero) {
      // na užších displejích jsou fotky menší, tak se posouvají méně
      const k = () => (innerWidth >= 1000 ? 1 : innerWidth > 600 ? .6 : .4);
      const tl = gsap.timeline({ scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: .6, invalidateOnRefresh: true } });
      tl.to('.hero-text', { yPercent: -35, autoAlpha: 0, ease: 'none' }, 0)
        .to('.hero-media--left', { y: () => -140 * k(), ease: 'none' }, 0)
        .to('.hero-media--right', { y: () => -70 * k(), ease: 'none' }, 0)
        // yPercent, aby se to nepralo s posunem za myší (ten používá x/y)
        .to('.hero-media .hero-side', { yPercent: -50, rotation: (i) => (i ? 3 : -3), ease: 'none' }, 0);
    }

    // ── Hero: fotky se jemně natáčejí za kurzorem (jen myš) ──
    if (hero && matchMedia('(hover: hover) and (pointer: fine)').matches) {
      const layers = $$('.hero-main, .hero-side', hero).map((el, i) => {
        const depth = el.classList.contains('hero-side') ? 26 : 12;
        return { depth, x: gsap.quickTo(el, 'x', { duration: 1.2, ease: 'power3.out' }), y: gsap.quickTo(el, 'y', { duration: 1.2, ease: 'power3.out' }) };
      });
      const onMove = e => {
        const nx = e.clientX / innerWidth - .5, ny = e.clientY / innerHeight - .5;
        layers.forEach(l => { l.x(nx * l.depth); l.y(ny * l.depth); });
      };
      hero.addEventListener('pointermove', onMove);
      hero.addEventListener('pointerleave', () => layers.forEach(l => { l.x(0); l.y(0); }));
    } else if (hero) {
      // dotyk (mobil, tablet): fotky v rámečcích pomalu dýchají, každá v jiném rytmu
      $$('.hero-main img, .hero-side img', hero).forEach((img, i) => {
        gsap.fromTo(img, { scale: 1 }, { scale: 1.08, duration: 5 + i * .8, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: i * .6 });
      });
    }

    // ── Pás s materiály, který jede do strany podle scrollu ──
    $$('.ribbon-track').forEach((track, i) => {
      gsap.fromTo(track, { xPercent: i % 2 ? -30 : 0 }, {
        xPercent: i % 2 ? 0 : -30, ease: 'none',
        scrollTrigger: { trigger: track.parentElement, start: 'top bottom', end: 'bottom top', scrub: .4 },
      });
    });

    // ── Nadpisy sekcí vyjedou po slovech zespodu ──
    $$('.section-title, .footer-strip-text').forEach(title => {
      const words = splitWords(title, 'w');
      gsap.from(words, {
        yPercent: 110, rotation: 4, duration: 1.1, stagger: .07,
        scrollTrigger: { trigger: title, start: 'top 88%', once: true },
      });
    });

    // ── O mně: fotka se otevře z menšího výřezu a obraz uvnitř dojíždí ──
    const aboutImg = document.querySelector('.about-img');
    if (aboutImg) {
      gsap.fromTo(aboutImg, { clipPath: 'inset(16% 14% 16% 14% round 3px)' }, {
        clipPath: 'inset(0% 0% 0% 0% round 3px)', ease: 'none',
        scrollTrigger: { trigger: aboutImg, start: 'top 90%', end: 'top 25%', scrub: .5 },
      });
      gsap.fromTo(aboutImg.querySelector('img'), { scale: 1.3, yPercent: -6 }, {
        scale: 1, yPercent: 6, ease: 'none',
        scrollTrigger: { trigger: aboutImg, start: 'top bottom', end: 'bottom top', scrub: true },
      });
      gsap.from('.about-text > p', {
        y: 40, autoAlpha: 0, stagger: .12,
        scrollTrigger: { trigger: '.about-text', start: 'top 82%', once: true },
      });
    }

    // ── Materiály: karty postupně, fotky se odkryjí zdola ──
    const mats = $$('.mat-card');
    if (mats.length) {
      gsap.from(mats, {
        y: 70, autoAlpha: 0, stagger: .12, duration: 1.1,
        scrollTrigger: { trigger: '.mat-grid', start: 'top 85%', once: true },
      });
      gsap.from($$('.mat-photo'), {
        clipPath: 'inset(100% 0% 0% 0%)', stagger: .12, duration: 1.3, ease: 'expo.out',
        scrollTrigger: { trigger: '.mat-grid', start: 'top 85%', once: true },
      });
    }

    // ── Citát se rozsvěcuje slovo po slovu podle scrollu ──
    const quote = document.querySelector('.quote-strip');
    if (quote) {
      const words = splitWords(quote, 'qw');
      gsap.fromTo(words, { opacity: .14 }, {
        opacity: 1, stagger: .1, ease: 'none',
        scrollTrigger: { trigger: quote, start: 'top 80%', end: 'bottom 50%', scrub: true },
      });
    }

    // ── Galerie na modelce: fotky vyskočí z mírného natočení ──
    const photos = $$('.footer-photo');
    if (photos.length) {
      gsap.from(photos, {
        y: 90, rotation: (i) => (i % 2 ? 4 : -4), autoAlpha: 0, stagger: .08, duration: 1.2, ease: 'back.out(1.3)',
        scrollTrigger: { trigger: '.footer-photos', start: 'top 88%', once: true },
      });
    }

    // ── Prvky, které dokresluje shop.js (kolekce, šperky, doprava): animují se i po filtrování ──
    const groups = [
      { sel: '.cat-card', vars: { x: 80, autoAlpha: 0 } },
      { sel: '.product-card', vars: { y: 60, autoAlpha: 0 } },
      { sel: '.ship-grid > *', vars: { y: 30, autoAlpha: 0 } },
    ];
    function bindNew() {
      groups.forEach(({ sel, vars }) => {
        const fresh = $$(sel).filter(el => !el.dataset.gs);
        if (!fresh.length) return;
        fresh.forEach(el => { el.dataset.gs = '1'; });
        // co už je nad oknem, neschovávat
        const hide = fresh.filter(el => el.getBoundingClientRect().bottom > 0);
        if (!hide.length) return;
        gsap.set(hide, vars);
        ScrollTrigger.batch(hide, {
          start: 'top 94%', once: true,
          onEnter: batch => gsap.to(batch, { x: 0, y: 0, autoAlpha: 1, stagger: .08, duration: .95, overwrite: true, clearProps: 'transform' }),
        });
      });
    }
    bindNew();
    let pending = 0;
    const mo = new MutationObserver(() => {
      clearTimeout(pending);
      pending = setTimeout(() => { bindNew(); ScrollTrigger.refresh(); }, 40);
    });
    $$('#productsGrid, #collectionGrid, #shipGrid').forEach(el => mo.observe(el, { childList: true }));

    // ── Newsletter ──
    gsap.from('.newsletter-desc, .newsletter-form', {
      y: 30, autoAlpha: 0, stagger: .1,
      scrollTrigger: { trigger: '.newsletter', start: 'top 80%', once: true },
    });

    // fotky se dotahují líně, po načtení přepočítat pozice
    addEventListener('load', () => ScrollTrigger.refresh());

    return () => mo.disconnect();
  });
})();
