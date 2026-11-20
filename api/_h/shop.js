const { getDb, fail, requireAdmin } = require('../_utils');
const R = require('../_rules');

// Pravidla obchodu (jen admin): ceny dopravy, doprava zdarma, zabalení, poukazy, platby, dovolená.
// GET /api/shop-settings — aktuální hodnoty (včetně výchozích)
// PUT /api/shop-settings — uložit; platí hned při další objednávce

function view() {
  const shipping = {};
  for (const k of R.SHIP_KEYS) shipping[k] = { name: R.SHIPPING[k].name, price: R.SHIPPING[k].price, on: !R.SHIPPING[k].off, freeFrom: !!R.SHIPPING[k].freeFrom, country: R.SHIPPING[k].country };
  return {
    shipping, freeFrom: R.RULES.freeFrom,
    giftWrap: { price: R.GIFT_WRAP.price, on: R.RULES.giftWrapOn },
    vouchers: { values: R.RULES.voucherValues, months: R.RULES.voucherMonths, on: R.RULES.vouchersOn },
    payments: R.RULES.payments, cardReady: R.cardReady(), vacation: R.RULES.vacation, collections: R.RULES.collections, reviews: { show: R.RULES.reviewsShow },
  };
}

module.exports = async function handler(req, res) {
  if (!(await requireAdmin(req, res, ['GET', 'PUT']))) return;
  try {
    if (req.method === 'GET') {
      await R.refresh(true);
      return res.status(200).json(view());
    }
    const v = R.validate(req.body);
    if (v.error) return fail(res, 400, v.error);
    const cur = await R.load();
    const doc = { ...(cur || {}), ...v.data, updatedAt: new Date() };
    await getDb().collection('settings').doc('shop').set(doc);
    R.apply(doc);
    R.markStale();
    return res.status(200).json(view());
  } catch (err) {
    console.error('shop settings error:', err.message);
    return fail(res, 500, 'Interní chyba serveru');
  }
};
