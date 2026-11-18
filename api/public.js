const { fail } = require('./_utils');

// Jedna funkce pro drobné veřejné koncové body (bezplatný plán Vercelu povoluje nejvýš 12 funkcí).
// Adresy zůstávají /api/newsletter, /api/voucher a /api/withdrawal, přesměrování je ve vercel.json.
// Povolené jsou jen názvy z tohoto seznamu (nic se nenačítá dynamicky).
const HANDLERS = {
  newsletter: require('./_h/newsletter'),
  voucher: require('./_h/voucher'),
  withdrawal: require('./_h/withdrawal'),
};

module.exports = async function handler(req, res) {
  const r = req.query?.r;
  const h = typeof r === 'string' && Object.prototype.hasOwnProperty.call(HANDLERS, r) ? HANDLERS[r] : null;
  if (!h) return fail(res, 404, 'Nenalezeno');
  return h(req, res);
};
