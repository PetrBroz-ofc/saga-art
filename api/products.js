const { getDb, fail, requireAdmin } = require('./_utils');
const { ID_RE, clean } = require('./_shop');

const CATEGORIES = ['nahrdelniky', 'nausnice', 'naramky', 'soupravy'];

// Fotky smí být JEN z vlastního Cloudinary účtu nebo ze složky webu /img/produkty
// (žádné cizí servery / sledovací pixely).
const LOCAL_IMG = /^\/img\/produkty\/[a-z0-9-]+\/\d+\.jpg$/;
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

// Whitelist polí + validace — do Firestore se nikdy neuloží nic navíc.
function sanitizeProduct(body) {
  const name = clean(body.name, 200);
  if (!name) return { error: 'Neplatný název' };

  const price = Number(body.price);
  if (!Number.isInteger(price) || price <= 0 || price > 1000000) return { error: 'Cena musí být celé číslo v Kč' };

  if (!CATEGORIES.includes(body.cat)) return { error: 'Neplatná kategorie' };

  const imgs = (Array.isArray(body.imgs) ? body.imgs : []).map(u => clean(u, 500)).filter(Boolean);
  if (imgs.length > 10) return { error: 'Maximálně 10 fotek' };
  if (!imgs.every(allowedImg)) return { error: 'Fotky musí být nahrané přes admin (Cloudinary)' };

  return {
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
  if (!requireAdmin(req, res, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])) return;
  const col = getDb().collection('products');

  try {
    if (req.method === 'GET') {
      const snap = await col.orderBy('name').get();
      return res.status(200).json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }

    if (req.method === 'POST') {
      const { data, error } = sanitizeProduct(req.body);
      if (error) return fail(res, 400, error);
      const ref = await col.add({ ...data, createdAt: new Date().toISOString() });
      return res.status(200).json({ id: ref.id });
    }

    const id = req.body.id;
    if (typeof id !== 'string' || !ID_RE.test(id)) return fail(res, 400, 'Neplatné ID');

    if (req.method === 'PUT') {
      const { data, error } = sanitizeProduct(req.body);
      if (error) return fail(res, 400, error);
      await col.doc(id).update({ ...data, updatedAt: new Date().toISOString() });
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
