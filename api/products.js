const { getDb, fail, requireAdmin } = require('./_utils');
const { ID_RE, clean } = require('./_shop');
const Price = require('./_price');

const CATEGORIES = ['nahrdelniky', 'nausnice', 'naramky', 'prstynky', 'soupravy'];

// Fotky smí být JEN nahrané přes administraci (/media), ze složky webu /img/produkty nebo (starší) z vlastního
// Cloudinary účtu. Žádné cizí servery ani sledovací pixely.
const LOCAL_IMG = /^(\/img\/produkty\/[a-z0-9-]+\/\d+\.jpg|\/media\/[a-f0-9]{24}\.(jpg|png|webp))$/;
function allowedImg(url) {
  if (LOCAL_IMG.test(url)) return true;
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloud) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'res.cloudinary.com'
      && u.pathname.startsWith('/' + cloud + '/image/upload/') && !u.username && !u.password;
  } catch {
    return false;
  }
}

// Whitelist polí + validace — do databáze se nikdy neuloží nic navíc.
function sanitizeProduct(body) {
  const name = clean(body.name, 200);
  if (!name) return { error: 'Neplatný název' };

  const price = Number(body.price);
  if (!Number.isInteger(price) || price <= 0 || price > 1000000) return { error: 'Cena musí být celé číslo v Kč' };

  if (!CATEGORIES.includes(body.cat)) return { error: 'Neplatná kategorie' };

  const imgs = (Array.isArray(body.imgs) ? body.imgs : []).map(u => clean(u, 500)).filter(Boolean);
  if (imgs.length > 10) return { error: 'Maximálně 10 fotek' };
  if (!imgs.every(allowedImg)) return { error: 'Fotky musí být nahrané přes administraci' };

  const sale = Price.validateSale(body, price);
  if (sale.error) return { error: sale.error };

  return {
    sale,
    data: {
      name,
      price,
      cat: body.cat,
      collection: clean(body.collection, 60),
      material: clean(body.material, 300),
      desc: clean(body.desc, 3000, true),
      imgs,
      badge: clean(body.badge, 40),
      inStock: body.inStock !== false,
    },
  };
}

export default async function handler(req, res) {
  if (!(await requireAdmin(req, res, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']))) return;
  const col = getDb().collection('products');

  try {
    if (req.method === 'GET') {
      const snap = await col.orderBy('name').get();
      return res.status(200).json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }

    if (req.method === 'POST') {
      const { data, sale, error } = sanitizeProduct(req.body);
      if (error) return fail(res, 400, error);
      const ref = await col.add({ ...data, ...Price.priceFields(null, { price: data.price, ...sale }), createdAt: new Date().toISOString() });
      return res.status(200).json({ id: ref.id });
    }

    const id = req.body.id;
    if (typeof id !== 'string' || !ID_RE.test(id)) return fail(res, 400, 'Neplatné ID');

    if (req.method === 'PUT') {
      const { data, sale, error } = sanitizeProduct(req.body);
      if (error) return fail(res, 400, error);
      const before = await col.doc(id).get();
      if (!before.exists) return fail(res, 404, 'Šperk neexistuje');
      // administrace ze staré záložky slevu neposílá: v tom případě se rozběhnutá sleva nemá tiše zrušit
      const keep = req.body.salePrice === undefined && Price.saleActive(before.data()) && before.data().salePrice < data.price;
      const wanted = keep ? { salePrice: before.data().salePrice, saleTo: before.data().saleTo || '' } : sale;
      await col.doc(id).update({ ...data, ...Price.priceFields(before.data(), { price: data.price, ...wanted }), updatedAt: new Date().toISOString() });
      return res.status(200).json({ ok: true });
    }

    // rychlé přepnutí Skladem / Prodáno z přehledu šperků
    if (req.method === 'PATCH') {
      if (typeof req.body.inStock !== 'boolean') return fail(res, 400, 'Neplatná hodnota');
      await col.doc(id).update({ inStock: req.body.inStock, updatedAt: new Date().toISOString() });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      await col.doc(id).delete();
      return res.status(200).json({ ok: true });
    }
  } catch (err) {
    console.error('products error:', err.message);
    return fail(res, 500, 'Interní chyba serveru');
  }
}
