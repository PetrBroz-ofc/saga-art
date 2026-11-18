// Jednorázově nahraje výchozí šperky (public/data/products.json) do databáze.
// Existující šperky NEPŘEPISUJE. Potřebuje .env.local s proměnnou DATABASE_URL.
// Jede přes HTTPS (port 443, Neon SQL over HTTP), takže funguje i v síti, která blokuje port 5432.
// Použití: npm run seed
const path = require('path');
const products = require(path.join(__dirname, '..', 'public', 'data', 'products.json'));

const url = process.env.DATABASE_URL;
if (!url) { console.error('Chybí DATABASE_URL v .env.local'); process.exit(1); }
const host = new URL(url).hostname;

async function sql(queries) {
  const r = await fetch(`https://${host}/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': url },
    body: JSON.stringify({ queries }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Databáze odpověděla ${r.status}: ${body.message || 'neznámá chyba'}`);
  return body.results;
}

(async () => {
  const create = { query: 'CREATE TABLE IF NOT EXISTS docs (col text NOT NULL, id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY (col, id))', params: [] };
  const inserts = products.map(({ id, ...p }) => ({
    query: "INSERT INTO docs (col, id, data) VALUES ('products', $1, $2::jsonb) ON CONFLICT (col, id) DO NOTHING",
    params: [id, JSON.stringify({ ...p, price: Math.round(p.price), inStock: true })],
  }));
  const results = await sql([create, ...inserts]);
  const created = results.slice(1).reduce((n, r) => n + (r.rowCount || 0), 0);
  console.log(`Hotovo: přidáno ${created}, přeskočeno (už existují) ${products.length - created}.`);
})().catch(e => { console.error(e.message); process.exit(1); });
