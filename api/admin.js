const { fail } = require('./_utils');

// Jedna funkce pro koncové body administrace (bezplatný plán Vercelu povoluje nejvýš 12 funkcí).
// Adresy zůstávají /api/invoices a /api/account, přesměrování je ve vercel.json.
// Každý z handlerů si sám vynucuje přihlášení admina. Povolené jsou jen názvy z tohoto seznamu.
const HANDLERS = {
  invoices: require('./_h/invoices'),
  account: require('./_h/account'),
  site: require('./_h/site'),
  shop: require('./_h/shop'),
  subscribers: require('./_h/subscribers'),
  mail: require('./_h/mailtexts'),
  coupons: require('./_h/coupons'),
  reviews: require('./_h/reviewsadmin'),
};

module.exports = async function handler(req, res) {
  const r = req.query?.r;
  const h = typeof r === 'string' && Object.prototype.hasOwnProperty.call(HANDLERS, r) ? HANDLERS[r] : null;
  if (!h) return fail(res, 404, 'Nenalezeno');
  return h(req, res);
};
