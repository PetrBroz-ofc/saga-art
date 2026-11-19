'use strict';
// Faktury k objednávkám: vznikají automaticky, číslo faktury = číslo objednávky (= variabilní symbol).
// Sdílené mezi e-maily (příloha PDF), administrací a zpracováním plateb.

const path = require('path');
const fs = require('fs');
const { getDb, sha256 } = require('./_utils');
const { SELLER, seller, bank } = require('./_business');

const PAYMENTS = {
  prevod: 'Bankovním převodem', karta: 'Platební kartou', hotove: 'V hotovosti',
  dobirka: 'Na dobírku', poukaz: 'Dárkovým poukazem',
};
const ORDER_PAYMENT = { card: 'karta', transfer: 'prevod', voucher: 'poukaz' };
const COUNTRY = { CZ: 'Česká republika', SK: 'Slovensko' };

const idOf = number => sha256('invoice:' + number).slice(0, 40);
const iso = v => (v && typeof v.toDate === 'function' ? v.toDate() : v instanceof Date ? v : null)?.toISOString() || null;
const pragueDay = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' }); // YYYY-MM-DD
const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Jak faktura vypadá navenek (do administrace a do PDF). Nic tajného v ní není.
function publicInvoice(d) {
  return {
    number: String(d.number || ''), issueDate: d.issueDate || '', dueDate: d.dueDate || '', taxDate: d.taxDate || '',
    payment: d.payment || '', paymentLabel: PAYMENTS[d.payment] || '', vs: d.vs || '',
    customer: d.customer || {}, items: Array.isArray(d.items) ? d.items : [], total: Number(d.total) || 0,
    note: d.note || '', orderNumber: d.orderNumber || '', paid: d.paid === true, paidAt: iso(d.paidAt),
    storno: d.storno === true, stornoAt: iso(d.stornoAt), createdAt: iso(d.createdAt), editedAt: iso(d.editedAt),
    seller: d.seller || SELLER, bank: d.bank || {},
  };
}

// Z objednávky (jak je uložená v databázi) udělá data faktury.
function fromOrder(order, shippingName, wrapName) {
  const c = order.customer || {};
  const items = [
    ...(order.lines || []).map(l => ({ name: String(l.name), qty: Number(l.qty), unit: 'ks', price: Number(l.price), sum: Number(l.price) * Number(l.qty) })),
  ];
  const add = (name, price) => items.push({ name, qty: 1, unit: 'ks', price, sum: price });
  if (order.shippingPrice) add('Doprava: ' + shippingName, Number(order.shippingPrice));
  if (order.giftWrap && order.giftWrapPrice) add(wrapName, Number(order.giftWrapPrice));
  if (order.discount) add('Sleva dárkovým poukazem' + (order.voucher?.last4 ? ' …' + order.voucher.last4 : ''), -Number(order.discount));
  const total = items.reduce((s, i) => s + i.sum, 0);
  const paid = order.payment !== 'transfer'; // karta se potvrzuje až po zaplacení, poukaz je platba hned
  const today = pragueDay();
  return {
    number: order.number,
    issueDate: today, taxDate: today, dueDate: paid ? today : addDays(today, 7),
    payment: ORDER_PAYMENT[order.payment] || 'prevod',
    vs: order.number,
    customer: {
      name: `${c.jmeno || ''} ${c.prijmeni || ''}`.trim(), street: c.ulice || '', city: c.mesto || '', zip: c.psc || '',
      country: COUNTRY[c.zeme] || c.zeme || '', ico: '', dic: '', email: c.email || '',
    },
    items, total, currency: 'CZK',
    note: `Objednávka z e-shopu č. ${order.number}.`,
    orderNumber: order.number, paid,
  };
}

// Vytvoří fakturu k objednávce (číslo = číslo objednávky). Bezpečné volat opakovaně:
// když už faktura (i ruční) existuje, vrátí tu existující.
async function ensureForOrder(order, shippingName, wrapName) {
  const db = getDb();
  const oRef = db.collection('orders').doc(order.number);
  const data = fromOrder(order, shippingName, wrapName);
  const ref = db.collection('invoices').doc(idOf(data.number));
  return db.runTransaction(async tx => {
    const o = await tx.get(oRef);
    const existingNumber = o.exists ? o.data().invoiceNumber : '';
    const cur = await tx.get(ref);
    if (cur.exists) return publicInvoice(cur.data());
    if (existingNumber && existingNumber !== data.number) {
      const other = await tx.get(db.collection('invoices').doc(idOf(existingNumber)));
      if (other.exists) return publicInvoice(other.data());
    }
    const now = new Date();
    const inv = { ...data, paidAt: data.paid ? now : null, storno: false, createdAt: now, seller: seller(), bank: bank() };
    tx.create(ref, inv);
    if (o.exists) tx.update(oRef, { invoiceNumber: data.number, updatedAt: now });
    return publicInvoice(inv);
  });
}

// Objednávka byla zaplacena / zrušena: faktura to následuje. Když faktura neexistuje, nic se neděje.
async function setPaidForOrder(orderNumber) {
  const ref = getDb().collection('invoices').doc(idOf(orderNumber));
  await getDb().runTransaction(async tx => {
    const s = await tx.get(ref);
    if (!s.exists || s.data().storno || s.data().paid) return;
    tx.update(ref, { paid: true, paidAt: new Date() });
  });
}
async function stornoForOrder(orderNumber) {
  const ref = getDb().collection('invoices').doc(idOf(orderNumber));
  await getDb().runTransaction(async tx => {
    const s = await tx.get(ref);
    if (!s.exists || s.data().storno) return;
    tx.update(ref, { storno: true, stornoAt: new Date() });
    const oRef = getDb().collection('orders').doc(orderNumber);
    const o = await tx.get(oRef);
    if (o.exists && o.data().invoiceNumber === orderNumber) tx.update(oRef, { invoiceNumber: '', updatedAt: new Date() });
  });
}

// ── PDF ──
const FONT = path.join(__dirname, '_fonts', 'DejaVuSansCondensed.ttf');
const FONT_B = path.join(__dirname, '_fonts', 'DejaVuSansCondensed-Bold.ttf');
const INK = '#3e3a52', MUTED = '#6c6782', ACCENT = '#83639f', LINE = '#e7e2ef';
const kc = n => (Math.round(Number(n) * 100) / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).replace(/ /g, ' ') + ' Kč';
const czDate = day => day ? day.split('-').reverse().map((p, i) => (i < 2 ? String(Number(p)) : p)).join('. ') : '';

function pdf(invoice) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    const inv = publicInvoice(invoice);
    const doc = new PDFDocument({ size: 'A4', margin: 50, font: FONT, info: { Title: 'Faktura ' + inv.number, Author: SELLER.brand } });
    doc.registerFont('b', FONT_B);
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 50, R = 545, W = R - L;
    const s = { ...SELLER, ...(inv.seller || {}) };

    // záhlaví
    doc.fillColor(INK).font('b').fontSize(24).text('Faktura', L, 48);
    doc.font(FONT).fontSize(12).fillColor(MUTED).text('č. ' + inv.number, L, 78);
    doc.font('b').fontSize(18);
    const wSaga = doc.widthOfString('Sága '), wArt = doc.widthOfString('Art');
    doc.fillColor(INK).text('Sága ', R - wSaga - wArt, 50, { lineBreak: false });
    doc.fillColor(ACCENT).text('Art', R - wArt, 50, { lineBreak: false });
    if (inv.storno) doc.font('b').fontSize(13).fillColor('#9b2c3a').text('STORNOVÁNO', L, 82, { width: W, align: 'right' });
    else if (inv.paid) doc.font('b').fontSize(13).fillColor('#2f6b4f').text('UHRAZENO', L, 82, { width: W, align: 'right' });
    doc.moveTo(L, 108).lineTo(R, 108).strokeColor(LINE).lineWidth(1).stroke();

    // dodavatel a odběratel
    const box = (x, y, title, lines) => {
      doc.font('b').fontSize(8.5).fillColor(MUTED).text(title.toUpperCase(), x, y, { characterSpacing: 1 });
      doc.font('b').fontSize(11).fillColor(INK).text(lines[0] || '', x, y + 14, { width: 230 });
      doc.font(FONT).fontSize(10).fillColor(INK);
      let yy = doc.y + 2;
      lines.slice(1).filter(Boolean).forEach(t => { doc.text(t, x, yy, { width: 230 }); yy = doc.y + 1; });
      return yy;
    };
    const sellerLines = [s.name, s.street, `${s.zip} ${s.city}`, s.country, 'IČO: ' + s.ico, 'Nejsem plátce DPH.', s.register, s.email, s.web].filter(Boolean);
    const c = inv.customer || {};
    const custLines = [c.name, c.street, [c.zip, c.city].filter(Boolean).join(' '), c.country, c.ico ? 'IČO: ' + c.ico : '', c.dic ? 'DIČ: ' + c.dic : '', c.email];
    const y1 = box(L, 124, 'Dodavatel', sellerLines);
    const y2 = box(310, 124, 'Odběratel', custLines);
    let y = Math.max(y1, y2) + 14;

    // údaje o platbě
    doc.moveTo(L, y).lineTo(R, y).strokeColor(LINE).stroke();
    y += 12;
    const meta = [
      ['Datum vystavení', czDate(inv.issueDate)],
      ['Datum splatnosti', czDate(inv.dueDate)],
      ['Způsob úhrady', inv.paymentLabel],
      ['Variabilní symbol', inv.vs],
    ];
    const b = inv.bank || {};
    if (!inv.paid && inv.payment === 'prevod' && (b.account || b.iban)) {
      if (b.account) meta.push(['Číslo účtu', b.account]);
      if (b.iban) meta.push(['IBAN', b.iban]);
    }
    meta.forEach(([k, v], i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = L + col * 250, yy = y + row * 30;
      doc.font(FONT).fontSize(8.5).fillColor(MUTED).text(k, x, yy);
      doc.font('b').fontSize(10.5).fillColor(INK).text(String(v || '—'), x, yy + 11, { width: 235 });
    });
    y += Math.ceil(meta.length / 2) * 30 + 8;

    // položky
    const cols = { name: L, qty: 330, price: 400, sum: 480 };
    doc.rect(L, y, W, 22).fill('#f1ebf7');
    doc.font('b').fontSize(9).fillColor(INK);
    doc.text('Položka', cols.name + 8, y + 7);
    doc.text('Množství', cols.qty, y + 7, { width: 60, align: 'right' });
    doc.text('Cena za jedn.', cols.price, y + 7, { width: 75, align: 'right' });
    doc.text('Celkem', cols.sum, y + 7, { width: R - cols.sum - 8, align: 'right' });
    y += 22;
    doc.font(FONT).fontSize(10).fillColor(INK);
    for (const it of inv.items) {
      const h = Math.max(doc.heightOfString(it.name, { width: 265 }), 12) + 12;
      if (y + h > 740) { doc.addPage(); y = 50; doc.font(FONT).fontSize(10).fillColor(INK); }
      doc.text(it.name, cols.name + 8, y + 6, { width: 265 });
      doc.text(`${String(it.qty).replace('.', ',')} ${it.unit || ''}`, cols.qty, y + 6, { width: 60, align: 'right' });
      doc.text(kc(it.price), cols.price, y + 6, { width: 75, align: 'right' });
      doc.text(kc(it.sum), cols.sum, y + 6, { width: R - cols.sum - 8, align: 'right' });
      y += h;
      doc.moveTo(L, y).lineTo(R, y).strokeColor(LINE).stroke();
    }

    // celkem
    y += 14;
    if (y > 700) { doc.addPage(); y = 50; }
    doc.font(FONT).fontSize(10).fillColor(MUTED).text('Celkem k úhradě', 330, y + 5, { width: 100 });
    doc.font('b').fontSize(17).fillColor(INK).text(kc(inv.total), 400, y, { width: R - 400, align: 'right' });
    y += 34;
    if (inv.paid) {
      doc.font(FONT).fontSize(10).fillColor('#2f6b4f').text('Uhrazeno' + (inv.paidAt ? ' dne ' + czDate(inv.paidAt.slice(0, 10)) : '') + '. K úhradě nezbývá nic.', L, y, { width: W, align: 'right' });
      y += 20;
    }
    if (inv.note) {
      doc.font(FONT).fontSize(9.5).fillColor(MUTED).text(inv.note, L, y + 6, { width: W });
      y = doc.y + 6;
    }
    if (inv.editedAt) {
      doc.font(FONT).fontSize(8.5).fillColor(MUTED).text('Faktura byla upravena dne ' + czDate(pragueDay(new Date(inv.editedAt))) + '.', L, y + 4, { width: W });
    }

    // patička (dolní okraj se vypne, jinak by text na 790 vyrobil prázdnou druhou stranu)
    doc.page.margins.bottom = 0;
    doc.font(FONT).fontSize(8.5).fillColor(MUTED).text(
      `${s.brand} · ${s.name} · IČO ${s.ico} · ${s.street}, ${s.zip} ${s.city}`, L, 790, { width: W, align: 'center', lineBreak: false });
    doc.end();
  });
}

module.exports = { PAYMENTS, idOf, publicInvoice, fromOrder, ensureForOrder, setPaidForOrder, stornoForOrder, pdf, pragueDay };
