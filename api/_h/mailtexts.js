const { getDb, fail, requireAdmin, limitOrReject, clientIp } = require('../_utils');
const Mail = require('../_mail');
const { ownerEmail } = require('../_account');

// Texty e-mailů zákazníkům (jen admin).
// GET  /api/mail-settings              — aktuální a výchozí texty
// PUT  /api/mail-settings              — uložit
// POST /api/mail-settings { test }     — pošle zkušební e-mail na adresu majitelky (test: "order" | "voucher")

const view = () => ({ texts: { ...Mail.TEXTS }, defaults: { ...Mail.DEFAULT_TEXTS } });

module.exports = async function handler(req, res) {
  if (!(await requireAdmin(req, res, ['GET', 'PUT', 'POST']))) return;
  try {
    if (req.method === 'GET') { await Mail.refresh(true); return res.status(200).json(view()); }

    if (req.method === 'PUT') {
      const v = Mail.validateTexts(req.body);
      if (v.error) return fail(res, 400, v.error);
      await getDb().collection('settings').doc('mail').set({ ...v.data, updatedAt: new Date() });
      Mail.applyTexts(v.data);
      return res.status(200).json(view());
    }

    // POST: zkušební e-mail (s ukázkovými údaji) jen na adresu majitelky
    if (!(await limitOrReject(res, 'mail_test', 'global', 6, 60 * 60 * 1000))) return;
    await Mail.refresh(true);
    const to = ownerEmail();
    const kind = req.body?.test;
    let msg;
    if (kind === 'order') {
      msg = Mail.orderCustomer({
        number: '2611190001', name: 'Jana Nováková', email: to, phone: '777 123 456', address: 'Dlouhá 12, 110 00 Praha, Česká republika', note: '',
        lines: [['Euforie Gold náramek × 1', '950 Kč'], ['Doprava: Zásilkovna, výdejní místo nebo Z-BOX', '89 Kč']], total: 1039,
        shippingLabel: 'Zásilkovna, výdejní místo nebo Z-BOX', payment: 'transfer', paymentLabel: 'Bankovní převod předem',
        bank: { account: process.env.BANK_ACCOUNT || '123456789/0800', iban: process.env.BANK_IBAN || '' }, giftMessage: '', invoiceNumber: '2611190001',
      });
    } else if (kind === 'voucher') {
      msg = Mail.voucherMail({ issued: [{ value: 1000, code: 'ABCD-EFGH-JKMN' }], expires: '19. 11. 2027' });
    } else return fail(res, 400, 'Neznámý e-mail');
    msg.subject = '[ZKOUŠKA] ' + msg.subject;
    await Mail.sendMail({ to, ...msg });
    return res.status(200).json({ ok: true, to });
  } catch (err) {
    console.error('mail texts error:', err.message);
    return fail(res, 500, 'Nepodařilo se. Zkontrolujte nastavení odesílání e-mailů (Resend).');
  }
};
