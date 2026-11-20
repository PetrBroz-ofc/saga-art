const { getDb, SITE_URL, guard } = require('../_utils');
const R = require('../_reviews');
const { RULES, refresh } = require('../_rules');

// GET /sperk/<id> — samostatná stránka šperku pro vyhledávače a sdílení: název, popis, cena, fotky, recenze,
// strukturovaná data (schema.org Product). Koupit se šperk dál jde v e-shopu (/?produkt=<id>).
// Všechno z databáze se do HTML vkládá escapované.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeImg = u => (/^(https:\/\/res\.cloudinary\.com\/[^\s"'<>]+|\/img\/produkty\/[a-z0-9-]+\/\d+\.jpg)$/.test(String(u || '')) ? String(u) : '');
const abs = u => (u.startsWith('/') ? SITE_URL + u : u);
const kc = n => Number(n).toLocaleString('cs-CZ') + ' Kč';
const jsonLd = o => JSON.stringify(o).replace(/</g, '\\u003c');
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);

function notFound(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=60');
  return res.status(404).send(`<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Šperk nenalezen | Sága Art</title><link rel="stylesheet" href="/css/shop.css"><link rel="stylesheet" href="/css/page.css"></head><body><main class="pp pp-empty"><h1>Tenhle šperk tu nenajdu</h1><p>Možná už není v nabídce. Podívejte se na ostatní.</p><a class="btn-primary" href="/#produkty">Zpět do obchodu</a></main></body></html>`);
}

module.exports = async function handler(req, res) {
  if (!guard(req, res, ['GET'])) return;
  const id = req.query?.id;
  if (typeof id !== 'string' || !R.ID_RE.test(id)) return notFound(res);
  try {
    await refresh();
    const snap = await getDb().collection('products').doc(id).get();
    if (!snap.exists) return notFound(res);
    const p = snap.data();
    const reviews = RULES.reviewsShow ? await R.approvedFor(id) : [];
    const sum = R.summarize(reviews);

    const imgs = (Array.isArray(p.imgs) ? p.imgs : []).map(safeImg).filter(Boolean);
    const name = String(p.name || 'Šperk');
    const desc = String(p.desc || '').replace(/\s+/g, ' ').trim();
    const metaDesc = (desc || `${name}, ručně vyráběný šperk Sága Art.`).slice(0, 155);
    const url = `${SITE_URL}/sperk/${encodeURIComponent(id)}`;
    const inStock = p.inStock !== false;
    const props = Object.entries({ Kolekce: p.collection, ...(p.props || {}) }).filter(([k, v]) => k && v);

    const ld = {
      '@context': 'https://schema.org', '@type': 'Product', name, sku: id, url,
      description: desc || metaDesc,
      ...(imgs.length ? { image: imgs.map(abs) } : {}),
      brand: { '@type': 'Brand', name: 'Sága Art' },
      ...(p.material ? { material: String(p.material) } : {}),
      offers: {
        '@type': 'Offer', url, priceCurrency: 'CZK', price: String(Number(p.price) || 0),
        availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
        seller: { '@type': 'Organization', name: 'Sága Art' },
      },
      ...(sum.count ? {
        aggregateRating: { '@type': 'AggregateRating', ratingValue: String(sum.avg), reviewCount: String(sum.count) },
        review: reviews.slice(0, 20).map(r => ({ '@type': 'Review', author: { '@type': 'Person', name: r.name }, datePublished: (R.iso(r.createdAt) || '').slice(0, 10),
          reviewRating: { '@type': 'Rating', ratingValue: String(r.rating), bestRating: '5', worstRating: '1' }, reviewBody: r.text })),
      } : {}),
    };
    const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Sága Art', item: SITE_URL + '/' },
      { '@type': 'ListItem', position: 2, name: 'Šperky', item: SITE_URL + '/#produkty' },
      { '@type': 'ListItem', position: 3, name, item: url } ] };

    const html = `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)} | Sága Art</title>
<meta name="description" content="${esc(metaDesc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="product"><meta property="og:site_name" content="Sága Art"><meta property="og:locale" content="cs_CZ">
<meta property="og:title" content="${esc(name)} | Sága Art"><meta property="og:description" content="${esc(metaDesc)}"><meta property="og:url" content="${esc(url)}">
${imgs[0] ? `<meta property="og:image" content="${esc(abs(imgs[0]))}">` : `<meta property="og:image" content="${SITE_URL}/img/og.jpg">`}
<meta property="product:price:amount" content="${esc(Number(p.price) || 0)}"><meta property="product:price:currency" content="CZK">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#f8f7fb">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500&family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/shop.css"><link rel="stylesheet" href="/css/page.css">
<script src="/js/theme.js"></script>
<script type="application/ld+json">${jsonLd(ld)}</script>
<script type="application/ld+json">${jsonLd(crumbs)}</script>
</head><body>
<header class="pp-head"><a href="/" class="nav-logo" data-cms-logo>Sága <em>Art</em></a><a class="pp-back" href="/#produkty">← Zpět do obchodu</a></header>
<main class="pp">
  <div class="pp-media">${imgs.length ? imgs.map((src, i) => `<img src="${esc(src)}" alt="${esc(name)}${i ? ' (fotka ' + (i + 1) + ')' : ''}"${i ? ' loading="lazy"' : ''} referrerpolicy="no-referrer">`).join('') : ''}</div>
  <div class="pp-info">
    <nav class="pp-crumbs" aria-label="Drobečková navigace"><a href="/">Sága Art</a> / <a href="/#produkty">Šperky</a>${p.collection ? ` / <span>${esc(p.collection)}</span>` : ''}</nav>
    <h1>${esc(name)}</h1>
    ${sum.count ? `<p class="pp-rating" aria-label="Hodnocení ${sum.avg} z 5"><span class="pp-stars" aria-hidden="true">${stars(Math.round(sum.avg))}</span> ${esc(String(sum.avg).replace('.', ','))} <small>(${sum.count} ${sum.count === 1 ? 'recenze' : sum.count < 5 ? 'recenze' : 'recenzí'})</small></p>` : ''}
    ${p.material ? `<p class="pp-material">${esc(p.material)}</p>` : ''}
    <p class="pp-price">${esc(kc(p.price))}</p>
    ${desc ? `<p class="pp-desc">${esc(desc)}</p>` : ''}
    ${props.length ? `<dl class="pp-props">${props.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
    ${inStock ? `<a class="btn-primary" href="/?produkt=${encodeURIComponent(id)}">Koupit v e-shopu</a>` : '<p class="pp-sold">Tenhle šperk je prodaný. Podobný ráda vytvořím na míru.</p>'}
    <p class="pp-ship">Doprava Zásilkovnou od ${esc(Math.min(...Object.values(require('../_rules').SHIPPING).filter(x => !x.voucherOnly && !x.off).map(x => x.price)))} Kč${RULES.freeFrom > 0 ? `, nad ${esc(kc(RULES.freeFrom))} zdarma` : ''}. Každý šperk dostanete v dárkové krabičce.</p>
  </div>
  ${reviews.length ? `<section class="pp-reviews"><h2>Recenze</h2>${reviews.slice(0, 20).map(r => `<article class="pp-review"><p class="pp-stars" aria-label="${r.rating} z 5">${stars(r.rating)}</p>${r.title ? `<h3>${esc(r.title)}</h3>` : ''}<p>${esc(r.text)}</p><small>${esc(r.name)}${r.verified ? ' · ověřený nákup' : ''} · ${esc((R.iso(r.createdAt) || '').slice(0, 10).split('-').reverse().join('. '))}</small></article>`).join('')}</section>` : ''}
</main>
<footer class="pp-foot"><a href="/">Sága Art</a> · <a href="/obchodni-podminky">Obchodní podmínky</a> · <a href="/ochrana-osobnich-udaju">Ochrana osobních údajů</a></footer>
</body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
    return res.status(200).send(html);
  } catch (err) {
    console.error('product page error:', err.message);
    return notFound(res);
  }
};
