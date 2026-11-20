'use strict';
// QR platba (český standard SPAYD, umí ho všechny tuzemské bankovní aplikace).
// Zákazník QR kód naskenuje v aplikaci banky a má předvyplněný účet, částku i variabilní symbol.

const QRCode = require('qrcode');

const ascii = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .,:/-]/g, ' ').replace(/\s+/g, ' ').trim();
const vsOf = n => String(n ?? '').replace(/\D/g, '').slice(-10);

// { iban, amount, vs, msg } → text pro QR kód, nebo '' když chybí IBAN či částka
function spayd({ iban, amount, vs, msg }) {
  const acc = String(iban || '').replace(/\s+/g, '').toUpperCase();
  const am = Number(amount);
  if (!/^CZ\d{22}$/.test(acc) || !(am > 0)) return '';
  const parts = ['SPD', '1.0', 'ACC:' + acc, 'AM:' + am.toFixed(2), 'CC:CZK'];
  const v = vsOf(vs);
  if (v) parts.push('X-VS:' + v);
  const m = ascii(msg).slice(0, 60);
  if (m) parts.push('MSG:' + m);
  parts.push('RN:' + ascii('Petra Miklusakova'));
  return parts.join('*');
}

const OPTS = { errorCorrectionLevel: 'M', margin: 2, width: 360, color: { dark: '#000000', light: '#ffffff' } };
const png = text => QRCode.toBuffer(text, { ...OPTS, type: 'png' });
const dataUrl = text => QRCode.toDataURL(text, OPTS);

// Pohodlná varianta k objednávce: vrací { text, png } nebo null
async function forOrder({ iban, total, number }) {
  const text = spayd({ iban, amount: total, vs: number, msg: 'Saga Art objednavka ' + vsOf(number) });
  if (!text) return null;
  return { text, png: await png(text) };
}

module.exports = { spayd, png, dataUrl, forOrder, vsOf };
