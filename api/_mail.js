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

const { SITE_URL, getDb } = require('./_utils');
const { RULES } = require('./_rules');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kc = n => `${Number(n || 0).toLocaleString('cs-CZ')} Kč`;
const oneLine = s => String(s ?? '').replace(/[\r\n]+/g, ' ');

// Texty e-mailů, které si majitelka upravuje v administraci (Obchod, E-maily). V textech jde použít {cislo} (číslo
// objednávky) a {jmeno}. Výchozí znění je tady, upravené v databázi (settings/mail).
const DEFAULT_TEXTS = {
  orderIntro: 'děkuji za vaši objednávku č. {cislo}. Tady je její shrnutí.',
  transferNote: 'Platbu čekám do 7 dnů, jinak objednávku zruším. Jakmile peníze dorazí, začnu balit.',
  paidNote: 'Platbu jsem přijala, děkuji.',
  shipNote: 'Zásilku odesílám nejpozději do 5 pracovních dnů od přijetí platby.',
  returnNote: 'Vrátit zboží do 14 dnů můžete podle obchodních podmínek. Kdyby cokoli nesedělo, stačí odpovědět na tento e-mail.',
  voucherIntro: 'děkuji za nákup. Tady je váš dárkový poukaz:',
  voucherIntroMany: 'děkuji za nákup. Tady jsou vaše dárkové poukazy:',
  sign: 'Petra, Sága Art',
};
const TEXT_KEYS = Object.keys(DEFAULT_TEXTS);
const TEXTS = { ...DEFAULT_TEXTS };
const fill = (t, v = {}) => String(t).replace(/\{(cislo|jmeno)\}/g, (_, k) => (v[k] ?? ''));
const clean1 = t => String(t ?? '').normalize('NFC').replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);

function validateTexts(b) {
  if (!b || typeof b !== 'object') return { error: 'Chybí data' };
  const out = {};
  for (const k of TEXT_KEYS) {
    const v = b[k] === undefined ? '' : clean1(b[k]);
    if (v && v !== DEFAULT_TEXTS[k]) out[k] = v;
  }
  if (out.orderIntro && !out.orderIntro.includes('{cislo}')) return { error: 'Úvod e-mailu k objednávce musí obsahovat {cislo} (číslo objednávky).' };
  return { data: out };
}
function applyTexts(doc) { for (const k of TEXT_KEYS) TEXTS[k] = typeof doc?.[k] === 'string' && doc[k] ? doc[k] : DEFAULT_TEXTS[k]; }
let loadedAt = 0;
async function refresh(force = false) {
  if (!force && Date.now() - loadedAt < 20000) return;
  try {
    const snap = await getDb().collection('settings').doc('mail').get();
    applyTexts(snap.exists ? snap.data() : null); loadedAt = Date.now();
  } catch (err) { console.error('Texty e-mailů se nenačetly:', err.message); }
}
const SIGN = () => TEXTS.sign;
const FOOTER = 'Sága Art · Petra Miklušáková · IČO 47055723 · Hříměždice vedle č74, 262 14 Hříměždice';

// ── odeslání ──
// attachments = [{ filename, content }], content je Buffer (do Resend jde jako base64)
async function sendMail({ to, subject, text, html, replyTo, attachments }) {
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  if (!key || !from || !from.includes('@')) throw new Error('Odesílání e-mailů není nakonfigurováno (RESEND_API_KEY, MAIL_FROM)');
  if (!to || !String(to).includes('@')) throw new Error('Chybí příjemce e-mailu');
  const body = { from, to: [String(to)], subject: oneLine(subject).slice(0, 200), text, html };
  const rt = replyTo || process.env.MAIL_REPLY_TO || process.env.OWNER_EMAIL;
  if (rt) body.reply_to = String(rt);
  if (Array.isArray(attachments) && attachments.length) {
    body.attachments = attachments.map(a => ({
      filename: String(a.filename).replace(/[^\w.-]/g, '_'),
      content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : String(a.content),
      // vložený obrázek v těle e-mailu (<img src="cid:...">)
      ...(a.contentId ? { content_id: String(a.contentId).replace(/[^\w.-]/g, '') } : {}),
    }));
  }
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

// Dárkový poukaz v podobě karty podle návrhu: pozadí je obrázek (poukaz-base.jpg), text je HTML,
// takže kód a datum jdou vyplnit u každého poukazu zvlášť. Bez obrázků zůstane světle modré pozadí.
// issued = [{ value, code }], expires = "31. 12. 2026"
function voucherCard({ value, code, expires }) {
  const bg = `${SITE_URL}/img/poukaz-base.jpg`;
  const navy = '#263558', serif = "Georgia,'Times New Roman',serif", sans = 'Arial,Helvetica,sans-serif';
  const label = t => `<div style="font-family:${sans};font-size:10px;color:${navy};padding:0 0 3px">${esc(t)}</div>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" background="${esc(bg)}" bgcolor="#b9c0de" style="margin:0 0 16px;background-color:#b9c0de;background-image:url('${esc(bg)}');background-size:100% 100%;background-repeat:no-repeat;border-radius:12px">
<tr><td valign="top" style="padding:7% 4% 6% 7%">
<table role="presentation" width="64%" cellpadding="0" cellspacing="0"><tr><td>
<div style="font-family:${sans};font-size:11px;letter-spacing:4px;color:${navy};padding:0 0 8px;border-bottom:1px solid #ffffff">SÁGA ART</div>
<div style="font-family:${serif};font-size:27px;line-height:1.1;color:${navy};padding:14px 0 0">Dárkový poukaz</div>
<div style="font-family:${serif};font-style:italic;font-size:12px;color:${navy};padding:4px 0 14px">Na šperk podle vlastního výběru</div>
<div style="font-family:${sans};font-size:8px;letter-spacing:2px;color:${navy}">HODNOTA POUKAZU</div>
<div style="font-family:${serif};font-size:40px;line-height:1.1;color:${navy};padding:2px 0 12px">${esc(Number(value).toLocaleString('cs-CZ'))} <span style="font-size:20px">Kč</span></div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="58%" valign="bottom" style="padding-right:10px">${label('Kód poukazu')}<div style="font-family:'Courier New',monospace;font-weight:bold;font-size:13px;letter-spacing:1px;color:${navy};border-bottom:1px solid ${navy};padding:0 0 3px;white-space:nowrap">${esc(code)}</div></td>
<td width="42%" valign="bottom">${label('Platí do')}<div style="font-family:${sans};font-weight:bold;font-size:13px;color:${navy};border-bottom:1px solid ${navy};padding:0 0 3px;white-space:nowrap">${esc(expires)}</div></td>
</tr></table>
<div style="font-family:${sans};font-size:10px;color:${navy};padding:10px 0 0">Uplatnění v pokladně na sagaart.cz</div>
</td></tr></table>
</td></tr></table>`;
}

function voucherMail({ issued, expires }) {
  const many = issued.length > 1;
  const subject = many ? 'Vaše dárkové poukazy Sága Art' : 'Váš dárkový poukaz Sága Art';
  const rules = `Platí do ${expires}. Kód stačí zadat v pokladně na sagaart.cz a jeho hodnota se odečte od ceny zboží. ${many ? 'Každý poukaz jde využít jednou' : 'Poukaz jde využít jednou'} a nelze jím platit dopravu. Nevyčerpaná část hodnoty se nevrací.`;
  const text = [
    'Dobrý den,', many ? TEXTS.voucherIntroMany : TEXTS.voucherIntro,
    issued.map(i => `Dárkový poukaz ${Number(i.value).toLocaleString('cs-CZ')} Kč\nKód: ${i.code}`).join('\n\n'),
    rules, SIGN(), FOOTER,
  ].join('\n\n');
  const html = layout(subject,
    para(`Dobrý den,\n${many ? TEXTS.voucherIntroMany : TEXTS.voucherIntro}`) +
    issued.map(i => voucherCard({ value: i.value, code: i.code, expires })).join('') +
    para(rules) + para(SIGN()));
  return { subject, text, html };
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
  const vars = { cislo: v.number, jmeno: v.name };
  const pay = transfer
    ? `Prosím o úhradu ${v.total} Kč na účet ${v.bank.account || '(číslo účtu doplním)'}${v.bank.iban ? ' (IBAN ' + v.bank.iban + ')' : ''}, variabilní symbol ${v.number}. ${fill(TEXTS.transferNote, vars)}`
    : fill(TEXTS.paidNote, vars);
  const ship = fill(TEXTS.shipNote, vars) + (RULES.vacation.on && RULES.vacation.message ? ' ' + RULES.vacation.message : '');
  const lines = v.lines.map(([a, b]) => `${a}: ${b}`).join('\n');
  const text = [
    `Dobrý den, ${v.name},`, '',
    fill(TEXTS.orderIntro, vars), '',
    lines, `Celkem: ${v.total} Kč`, '',
    `Doprava: ${v.shippingLabel}`, `Platba: ${v.paymentLabel}`, `Doručovací údaje: ${v.address}`,
    ...(v.giftMessage ? ['', `Vzkaz na kartičku: ${v.giftMessage}`] : []),
    '', pay, ...(transfer && v.qrCid ? ['QR kód pro platbu najdete v HTML verzi e-mailu i na faktuře v příloze.'] : []), ship, '',
    ...(v.invoiceNumber ? [`Fakturu č. ${v.invoiceNumber} najdete v příloze tohoto e-mailu.`, ''] : []),
    `${fill(TEXTS.returnNote, vars)} Obchodní podmínky: ${SITE_URL}/obchodni-podminky`,
    `Odstoupit od smlouvy můžete do 14 dnů od převzetí zásilky tady: ${SITE_URL}/odstoupeni?order=${v.number}`, '',
    SIGN(),
  ].join('\n');
  const html = layout(subject,
    h2(`Děkuji za objednávku č. ${v.number}`) +
    para(`Dobrý den, ${v.name},\n${fill(TEXTS.orderIntro, vars)}`) +
    rowsTable(v.lines, `${v.total} Kč`) +
    para(`Doprava: ${v.shippingLabel}\nPlatba: ${v.paymentLabel}\nDoručovací údaje: ${v.address}`) +
    (v.giftMessage ? para(`Vzkaz na kartičku: ${v.giftMessage}`) : '') +
    (transfer ? `<div style="margin:0 0 14px;padding:14px 16px;background:#f1ebf7;border-radius:8px;line-height:1.65">${esc(pay)}${v.qrCid
      ? `<div style="margin-top:14px;text-align:center"><img src="cid:${esc(v.qrCid)}" width="180" height="180" alt="QR platba" style="display:inline-block;width:180px;height:180px;border:0;background:#ffffff;border-radius:6px"><br><span style="font-size:13px;color:#6c6782">QR platba: naskenujte kód v aplikaci své banky, údaje se vyplní samy.</span></div>`
      : ''}</div>` : para(pay)) +
    para(ship) +
    (v.invoiceNumber ? para(`Fakturu č. ${v.invoiceNumber} najdete v příloze tohoto e-mailu.`) : '') +
    para(fill(TEXTS.returnNote, vars)) +
    `<p style="margin:0 0 18px;line-height:1.65">Od smlouvy můžete odstoupit do 14 dnů od převzetí zásilky:<br><a href="${esc(SITE_URL)}/odstoupeni?order=${esc(String(v.number).replace(/\D/g, ''))}" style="display:inline-block;margin-top:8px;padding:11px 22px;background:#3e3a52;color:#ffffff;text-decoration:none;border-radius:6px">Odstoupit od smlouvy</a></p>` +
    para(SIGN()));
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

module.exports = { refresh, validateTexts, applyTexts, DEFAULT_TEXTS, TEXTS, TEXT_KEYS, sendMail, notice, voucherMail, loginCode, orderCustomer, orderOwner, kc, esc };
