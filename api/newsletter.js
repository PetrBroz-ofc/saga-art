const { getDb, sha256, noStore, clientIp, fail, guard, limitOrReject } = require('./_utils');
const { clean } = require('./_shop');

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}$/;

// POST /api/newsletter { email } — přihlášení k odběru novinek (souhlas se ukládá s časem).
export default async function handler(req, res) {
  noStore(res);
  if (!guard(req, res, ['POST'])) return;
  if (!(await limitOrReject(res, 'newsletter_ip', clientIp(req), 5, 60 * 60 * 1000))) return;

  const { email, website } = req.body;
  if (website) return res.status(200).json({ ok: true }); // honeypot

  const mail = clean(email, 254).toLowerCase();
  if (!EMAIL_RE.test(mail)) return fail(res, 400, 'Zkontrolujte prosím e-mail');

  try {
    // id = hash e-mailu, takže opakované přihlášení nic nezdvojí
    await getDb().collection('newsletter').doc(sha256(mail).slice(0, 40)).set({
      email: mail,
      consentAt: new Date(),
      consentText: 'Souhlas se zasíláním novinek e-mailem (formulář na sagaart.cz)',
      unsubscribed: false,
    }, { merge: true });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('newsletter error:', err.message);
    return fail(res, 500, 'Přihlášení se nepovedlo, zkuste to prosím znovu.');
  }
}
