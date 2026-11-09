const { getDb, fail, guard } = require('./_utils');
const { SHIPPING, GIFT_WRAP } = require('./_shop');

// GET /api/products-public — veřejný katalog + ceník dopravy (jen pro čtení).
export default async function handler(req, res) {
  if (!guard(req, res, ['GET'])) return;
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

  try {
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
    res.status(200).json({ products, shipping: SHIPPING, giftWrap: GIFT_WRAP });
  } catch (err) {
    console.error('products-public error:', err.message);
    fail(res, 500, 'Interní chyba serveru');
  }
}
