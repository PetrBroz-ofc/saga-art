'use strict';
// E-maily přes Resend (https://resend.com). Klíč je jen na serveru, texty e-mailů jsou tady v kódu.
//
// Proměnné prostředí:
//   RESEND_API_KEY   klíč z Resend (Sending access)
//   MAIL_FROM        odesílatel, např. "Sága Art <objednavky@sagaart.cz>" (doména musí být v Resend ověřená)
//   OWNER_EMAIL      kam chodí upozornění na objednávky a odstoupení
//   MAIL_REPLY_TO    nepovinné, kam se odpovídá zákazníkům (jinak OWNER_EMAIL)
//
// Do HTML jde všechno přes esc(). Předměty obsahují jen číslo objednávky, žádné údaje od zákazníků.

const { SITE_URL } = require('./_utils');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kc = n => `${Number(n || 0).toLocaleString('cs-CZ')} Kč`;
const oneLine = s => String(s ?? '').replace(/[\r\n]+/g, ' ');

const SIGN = 'Petra, Sága Art';
const FOOTER = 'Sága Art · Petra Miklušáková · IČO 47055723 · Městečko 212, 270 23 Křivoklát';

// ── odeslání ──
async function sendMail({ to, subject, text, html, replyTo }) {
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  if (!key || !from || !from.includes('@')) throw new Error('Odesílání e-mailů není nakonfigurováno (RESEND_API_KEY, MAIL_FROM)');
  if (!to || !String(to).includes('@')) throw new Error('Chybí příjemce e-mailu');
  const body = { from, to: [String(to)], subject: oneLine(subject).slice(0, 200), text, html };
  const rt = replyTo || process.env.MAIL_REPLY_TO || process.env.OWNER_EMAIL;
  if (rt) body.reply_to = String(rt);
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('Resend ' + r.status); // bez těla odpovědi: může obsahovat adresu příjemce
}

// ── vzhled (jednoduchý, kompatibilní s e-mailovými programy: tabulky a vložené styly) ──
const para = t => `<p style="margin:0 0 14px;line-height:1.65">${esc(t).replace(/\n/g, '<br>')}</p>`;
function layout(title, inner) {
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f8f7fb;font-family:Arial,Helvetica,sans-serif;color:#3e3a52;font-size:15px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f7fb"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;border:1px solid #e7e2ef">
<tr><td style="padding:26px 30px 8px;font-family:Georgia,'Times New Roman',serif;font-size:26px;color:#3e3a52">Sága <span style="color:#83639f;font-style:italic">Art</span></td></tr>
<tr><td style="padding:8px 30px 26px">${inner}</td></tr>
<tr><td style="padding:16px 30px;border-top:1px solid #e7e2ef;font-size:12px;color:#6c6782;line-height:1.5">${esc(FOOTER)}<br><a href="${esc(SITE_URL)}" style="color:#83639f">${esc(SITE_URL.replace(/^https?:\/\//, ''))}</a></td></tr>
</table></td></tr></table></body></html>`;
}
const h2 = t => `<h2 style="margin:6px 0 14px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:22px;color:#3e3a52">${esc(t)}</h2>`;
const rowsTable = (rows, total) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:6px 0 18px">${
  rows.map(([a, b]) => `<tr><td style="padding:9px 0;border-bottom:1px solid #e7e2ef">${esc(a)}</td><td align="right" style="padding:9px 0 9px 12px;border-bottom:1px solid #e7e2ef;white-space:nowrap">${esc(b)}</td></tr>`).join('')
}${total ? `<tr><td style="padding:12px 0 0;font-weight:bold">Celkem</td><td align="right" style="padding:12px 0 0;font-weight:bold;font-size:18px;white-space:nowrap">${esc(total)}</td></tr>` : ''}</table>`;

// ── šablony: každá vrací { subject, text, html } ──

// Obecná zpráva (poukazy, odstoupení): odstavce oddělené prázdným řádkem
function notice(subject, message) {
  const paras = String(message).split(/\n{2,}/);
  return {
    subject,
    text: `${message}\n\n${FOOTER}`,
    html: layout(subject, h2(subject) + paras.map(para).join('')),
  };
}

function loginCode({ code, device, time, validMinutes }) {
  const subject = `Kód pro přihlášení do administrace: ${code}`;
  const text = `Váš kód pro přihlášení do administrace Sága Art je:\n\n${code}\n\nPlatí ${validMinutes} minut.\nZařízení: ${device}\nČas: ${time}\n\nPokud jste se nepřihlašoval(a), nikomu kód neříkejte a změňte si heslo.`;
  const html = layout(subject,
    para('Váš kód pro přihlášení do administrace:') +
    `<p style="margin:6px 0 18px;font-family:'Courier New',monospace;font-size:34px;letter-spacing:8px;font-weight:bold;color:#3e3a52">${esc(code)}</p>` +
    para(`Platí ${validMinutes} minut.\nZařízení: ${device}\nČas: ${time}`) +
    para('Pokud jste se nepřihlašoval(a), nikomu kód neříkejte a změňte si heslo.'));
  return { subject, text, html };
}

// v = { number, name, email, phone, address, note, lines:[[popis, částka]], total, shippingLabel, paymentLabel,
//       payment, bank:{account, iban}, giftMessage }
function orderCustomer(v) {
  const subject = `Děkuji za objednávku č. ${v.number}`;
  const transfer = v.payment === 'transfer';
  const pay = transfer
    ? `Prosím o úhradu ${v.total} Kč na účet ${v.bank.account || '(číslo účtu doplním)'}${v.bank.iban ? ' (IBAN ' + v.bank.iban + ')' : ''}, variabilní symbol ${v.number}. Platbu čekám do 7 dnů, jinak objednávku zruším. Jakmile peníze dorazí, začnu balit.`
    : 'Platbu jsem přijala, děkuji.';
  const ship = 'Zásilku odesílám nejpozději do 5 pracovních dnů od přijetí platby.';
  const lines = v.lines.map(([a, b]) => `${a}: ${b}`).join('\n');
  const text = [
    `Dobrý den, ${v.name},`, '',
    `děkuji za vaši objednávku č. ${v.number}. Tady je její shrnutí.`, '',
    lines, `Celkem: ${v.total} Kč`, '',
    `Doprava: ${v.shippingLabel}`, `Platba: ${v.paymentLabel}`, `Doručovací údaje: ${v.address}`,
    ...(v.giftMessage ? ['', `Vzkaz na kartičku: ${v.giftMessage}`] : []),
    '', pay, ship, '',
    `Vrátit zboží do 14 dnů můžete podle obchodních podmínek (${SITE_URL}/obchodni-podminky). Kdyby cokoli nesedělo, stačí odpovědět na tento e-mail.`, '',
    SIGN,
  ].join('\n');
  const html = layout(subject,
    h2(`Děkuji za objednávku č. ${v.number}`) +
    para(`Dobrý den, ${v.name},\nděkuji za vaši objednávku. Tady je její shrnutí.`) +
    rowsTable(v.lines, `${v.total} Kč`) +
    para(`Doprava: ${v.shippingLabel}\nPlatba: ${v.paymentLabel}\nDoručovací údaje: ${v.address}`) +
    (v.giftMessage ? para(`Vzkaz na kartičku: ${v.giftMessage}`) : '') +
    (transfer ? `<div style="margin:0 0 14px;padding:14px 16px;background:#f1ebf7;border-radius:8px;line-height:1.65">${esc(pay)}</div>` : para(pay)) +
    para(ship) +
    para(`Vrátit zboží do 14 dnů můžete podle obchodních podmínek. Kdyby cokoli nesedělo, stačí odpovědět na tento e-mail.`) +
    para(SIGN));
  return { subject, text, html };
}

function orderOwner(v) {
  const subject = `Nová objednávka č. ${v.number}, ${v.total} Kč`;
  const text = [
    `Nová objednávka č. ${v.number}`, '',
    `Zákazník: ${v.name}`, `E-mail: ${v.email}`, `Telefon: ${v.phone}`, `Adresa: ${v.address}`,
    `Poznámka: ${v.note || '—'}`, '',
    ...v.lines.map(([a, b]) => `${a}: ${b}`), `Celkem: ${v.total} Kč`, '',
    `Doprava: ${v.shippingLabel}`, `Platba: ${v.paymentLabel}`,
    ...(v.payment === 'transfer' ? [`Čeká na platbu, variabilní symbol ${v.number}.`] : ['Zaplaceno.']),
    ...(v.giftMessage ? [`Dárkové balení, vzkaz: ${v.giftMessage}`] : []),
    '', `Administrace: ${SITE_URL}/admin`,
  ].join('\n');
  const html = layout(subject,
    h2(`Nová objednávka č. ${v.number}`) +
    para(`Zákazník: ${v.name}\nE-mail: ${v.email}\nTelefon: ${v.phone}\nAdresa: ${v.address}\nPoznámka: ${v.note || '—'}`) +
    rowsTable(v.lines, `${v.total} Kč`) +
    para(`Doprava: ${v.shippingLabel}\nPlatba: ${v.paymentLabel}\n${v.payment === 'transfer' ? 'Čeká na platbu, variabilní symbol ' + v.number + '.' : 'Zaplaceno.'}`) +
    (v.giftMessage ? para(`Dárkové balení, vzkaz: ${v.giftMessage}`) : '') +
    `<p style="margin:6px 0 0"><a href="${esc(SITE_URL)}/admin" style="color:#83639f">Otevřít administraci</a></p>`);
  return { subject, text, html };
}

module.exports = { sendMail, notice, loginCode, orderCustomer, orderOwner, kc, esc };
