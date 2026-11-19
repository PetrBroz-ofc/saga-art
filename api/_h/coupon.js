const { noStore, clientIp, fail, guard, limitOrReject } = require('../_utils');
const Coupons = require('../_coupons');

// POST /api/coupon { code, goods } — kontrola slevového kódu v pokladně (nic se nezapisuje).
// Použití se zapíše až při vytvoření objednávky. Hádání kódů se brzdí limitem na IP.
module.exports = async function handler(req, res) {
  noStore(res);
  if (!guard(req, res, ['POST'])) return;
  if (!(await limitOrReject(res, 'coupon_ip', clientIp(req), 15, 15 * 60 * 1000))) return;
  const { code, goods } = req.body || {};
  if (typeof code !== 'string' || code.length > 40) return fail(res, 400, 'Zadejte prosím kód');
  const g = Number.isInteger(goods) && goods >= 0 && goods < 1e7 ? goods : 0;
  try {
    const r = await Coupons.check(code, g);
    if (r.error) return fail(res, 400, r.error);
    return res.status(200).json(r);
  } catch (err) {
    console.error('coupon check error:', err.message);
    return fail(res, 500, 'Kód se nepodařilo ověřit. Zkuste to prosím znovu.');
  }
};
