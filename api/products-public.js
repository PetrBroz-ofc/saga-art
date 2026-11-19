const { getDb, fail, guard } = require('./_utils');
const { refresh, publicRules } = require('./_rules');

// GET /api/products-public — veřejný katalog + ceník dopravy (jen pro čtení).
export default async function handler(req, res) {
  if (!guard(req, res, ['GET'])) return;
  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');

  try {
    await refresh();
    const snap = await getDb().collection('products').where('inStock', '==', true).get();
    const products = snap.docs
      .map(d => {
        const p = d.data();
        // jen pole, která frontend potřebuje — nic navíc neunikne
        return {
          id: d.id,
          name: p.name,
          price: p.price,
          cat: p.cat,
          collection: p.collection || '',
          material: p.material || '',
          desc: p.desc || '',
          props: p.props || {},
          imgs: Array.isArray(p.imgs) ? p.imgs : [],
          badge: p.badge || '',
          createdAt: p.createdAt || '',
        };
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(({ createdAt, ...p }) => p);
    res.status(200).json({ products, ...publicRules() });
  } catch (err) {
    console.error('products-public error:', err.message);
    fail(res, 500, 'Interní chyba serveru');
  }
}
