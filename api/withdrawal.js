const { getDb, noStore, clientIp, fail, guard, limitOrReject, safeEqual } = require('./_utils');
const { clean, sendEmail } = require('./_shop');

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}$/;

// POST /api/withdrawal — online odstoupení od smlouvy (funkce „odstoupit“ podle směrnice EU 2023/2673).
// Přijetí se potvrdí e-mailem zákazníkovi a majitelka dostane upozornění.
export default async function handler(req, res) {
  noStore(res);
  if (!guard(req, res, ['POST'])) return;
  if (!(await limitOrReject(res, 'withdraw_ip', clientIp(req), 5, 60 * 60 * 1000))) return;

  const b = req.body;
  if (b.website) return res.status(200).json({ ok: true }); // honeypot

  const d = {
    order: clean(b.order, 10),
    name: clean(b.name, 120),
    email: clean(b.email, 254).toLowerCase(),
    items: clean(b.items, 1000, true),
    received: clean(b.received, 10),
    account: clean(b.account, 60),
  };
  if (!/^\d{10}$/.test(d.order)) return fail(res, 400, 'Číslo objednávky má 10 číslic');
  if (d.name.length < 3) return fail(res, 400, 'Vyplňte prosím jméno');
  if (!EMAIL_RE.test(d.email)) return fail(res, 400, 'Zkontrolujte prosím e-mail');
  if (d.items.length < 2) return fail(res, 400, 'Napište prosím, které šperky vracíte');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.received) || isNaN(Date.parse(d.received))) return fail(res, 400, 'Vyplňte prosím datum převzetí');
  if (d.account && !/^[0-9A-Za-z /-]{4,60}$/.test(d.account)) return fail(res, 400, 'Neplatné číslo účtu');

  try {
    const db = getDb();
    const orderRef = db.collection('orders').doc(d.order);
    const snap = await orderRef.get();
    // stejná odpověď pro neexistující objednávku i nesedící e-mail (nic neprozradí)
    if (!snap.exists || !safeEqual(String(snap.data().customer?.email || '').toLowerCase(), d.email)) {
      return fail(res, 400, 'Číslo objednávky a e-mail k sobě nesedí. Zkontrolujte je prosím, nebo napište na info@sagaart.cz.');
    }

    const now = new Date();
    const ref = await db.collection('withdrawals').add({ ...d, createdAt: now });
    await orderRef.update({ withdrawalAt: now, withdrawalId: ref.id });

    const when = now.toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' });
    const summary = `Objednávka: ${d.order}\nJméno: ${d.name}\nE-mail: ${d.email}\nVrácené zboží: ${d.items}\nDatum převzetí: ${d.received}\nÚčet pro vrácení: ${d.account || '—'}\nPřijato: ${when}`;
    const results = await Promise.allSettled([
      sendEmail(process.env.EMAILJS_TEMPLATE_NOTICE, {
        to_email: d.email,
        subject: 'Potvrzení odstoupení od smlouvy, objednávka ' + d.order,
        message: `Dobrý den,\n\npotvrzuji, že jsem ${when} přijala vaše odstoupení od kupní smlouvy.\n\n${summary}\n\nŠperk mi prosím pošlete do 14 dnů na adresu Petra Miklušáková, Městečko 212, 270 23 Křivoklát. Peníze vám vrátím do 14 dnů od odstoupení, nejdřív ale ve chvíli, kdy mi šperk dorazí.\n\nPetra, Sága Art`,
      }),
      sendEmail(process.env.EMAILJS_TEMPLATE_NOTICE, {
        to_email: process.env.OWNER_EMAIL,
        subject: 'Odstoupení od smlouvy: objednávka ' + d.order,
        message: summary,
      }),
    ]);
    results.filter(r => r.status === 'rejected')
      .forEach(r => console.error('withdrawal e-mail selhal:', r.reason?.message));

    return res.status(200).json({ ok: true, at: when });
  } catch (err) {
    console.error('withdrawal error:', err.message);
    return fail(res, 500, 'Odeslání se nepovedlo. Napište mi prosím na info@sagaart.cz.');
  }
}
