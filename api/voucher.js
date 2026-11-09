const { noStore, clientIp, fail, guard, limitOrReject } = require('./_utils');
const { checkVoucher } = require('./_vouchers');

// POST /api/voucher { code } — kontrola kódu dárkového poukazu v pokladně (nic nestrhává).
// Přísný limit pokusů, aby se kódy nedaly hádat.
export default async function handler(req, res) {
  noStore(res);
  if (!guard(req, res, ['POST'])) return;
  if (!(await limitOrReject(res, 'voucher_ip', clientIp(req), 10, 15 * 60 * 1000))) return;
  if (!(await limitOrReject(res, 'voucher_all', 'global', 300, 60 * 60 * 1000))) return;

  const code = req.body.code;
  if (typeof code !== 'string' || code.length > 30) return fail(res, 400, 'Kód poukazu má 12 znaků');
  try {
    const r = await checkVoucher(code);
    if (r.error) return fail(res, 400, r.error);
    return res.status(200).json(r);
  } catch (err) {
    console.error('voucher error:', err.message);
    return fail(res, 500, 'Poukaz se nepodařilo ověřit, zkuste to prosím znovu.');
  }
}
