'use strict';
// Zákaznické účty zatím nejsou (přijdou spolu s programem perliček). Tohle je místo, kde se pak ověří
// přihlášená zákaznice. Recenze už s ní počítají: psát je smí jen přihlášená zákaznice, která šperk koupila.
//
// customerSession(req) → null (nikdo přihlášený) nebo { id, email, firstName, lastName }.
// Až účty vzniknou, stačí upravit TADY, nic dalšího se v recenzích měnit nemusí.

const { getDb } = require('./_utils');

async function customerSession(/* req */) {
  return null;
}

// Koupila zákaznice tenhle šperk? (zaplacená nebo odeslaná objednávka s jejím e-mailem)
async function hasBought(customer, productId) {
  if (!customer || !customer.email) return false;
  const snap = await getDb().collection('orders').where('customer', '==', { email: String(customer.email).toLowerCase() }).get();
  return snap.docs.some(d => {
    const o = d.data();
    return ['paid', 'shipped'].includes(o.status) && Array.isArray(o.lines) && o.lines.some(l => l.id === productId);
  });
}

module.exports = { customerSession, hasBought };
