const { getDb, noStore, requireAdmin } = require('../_utils');

// GET /api/backup — záloha dat obchodu jako jeden soubor JSON (jen čtení, jen přihlášená správa).
// Obsahuje šperky, objednávky, faktury, poukazy, kupóny, recenze, odběratele, odstoupení a nastavení.
// Fotky (kolekce media), přihlašovací zařízení, kódy a hesla v záloze nejsou.
const COLLECTIONS = ['products', 'orders', 'invoices', 'vouchers', 'coupons', 'reviews', 'newsletter', 'withdrawals', 'settings'];
const SKIP = new Set(['settings/client_account']);

module.exports = async function handler(req, res) {
  noStore(res);
  if (!(await requireAdmin(req, res, ['GET']))) return;
  try {
    const db = getDb();
    const out = { createdAt: new Date().toISOString(), note: 'Záloha dat Sága Art. Obsahuje osobní údaje zákazníků, uložte ji bezpečně.', collections: {} };
    for (const col of COLLECTIONS) {
      const snap = await db.collection(col).get();
      out.collections[col] = snap.docs.filter(d => !SKIP.has(col + '/' + d.id)).map(d => ({ id: d.id, ...d.data() }));
    }
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="zaloha-saga-art-${day}.json"`);
    return res.status(200).send(JSON.stringify(out, null, 1));
  } catch (err) {
    console.error('backup error:', err.message);
    return res.status(500).json({ error: 'Zálohu se nepodařilo vytvořit.' });
  }
};
