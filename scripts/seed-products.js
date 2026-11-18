// Jednorázově nahraje výchozí šperky (public/data/products.json) do databáze.
// Existující šperky NEPŘEPISUJE. Potřebuje .env.local s proměnnou DATABASE_URL.
// Použití: npm run seed
const path = require('path');
const { getDb } = require('../api/_db');

const db = getDb();
const products = require(path.join(__dirname, '..', 'public', 'data', 'products.json'));

(async () => {
  let created = 0, skipped = 0;
  for (const { id, ...p } of products) {
    try {
      await db.collection('products').doc(id).create({ ...p, price: Math.round(p.price), inStock: true });
      created++;
    } catch (e) {
      if (e.code === 6) { skipped++; continue; } // už existuje
      throw e;
    }
  }
  console.log(`Hotovo: přidáno ${created}, přeskočeno (už existují) ${skipped}.`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
