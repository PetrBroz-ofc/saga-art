'use strict';
// Sága Art · ukázkový režim administrace (/admin?demo, jen localhost a *.vercel.app).
// Šperky jsou skutečné z /data/products.json, objednávky jsou smyšlené. Nic se neukládá.

(() => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];

  const FIRST = ['Jana', 'Petra', 'Lucie', 'Kateřina', 'Tereza', 'Veronika', 'Markéta', 'Eva', 'Barbora', 'Klára', 'Zuzana', 'Michaela', 'Hana', 'Adéla', 'Nikola'];
  const LAST = ['Nováková', 'Svobodová', 'Dvořáková', 'Černá', 'Procházková', 'Kučerová', 'Veselá', 'Horáková', 'Němcová', 'Marková', 'Pokorná', 'Králová', 'Benešová'];
  const PLACES = [['Praha 3', '130 00'], ['Brno', '602 00'], ['Olomouc', '779 00'], ['Plzeň', '301 00'], ['Liberec', '460 01'], ['České Budějovice', '370 01'], ['Hradec Králové', '500 02'], ['Zlín', '760 01']];
  const STREETS = ['Lipová 12', 'Husova 5', 'Na Výsluní 1840', 'Masarykova 33', 'Polní 7', 'Dlouhá 21', 'Zahradní 402'];
  const SHIP = { zasilkovna: 109, balikovna: 109, posta: 130 };
  const NOTES = ['Prosím o dárkové balení, je to pro maminku.', 'Můžete přibalit malou kartičku? Děkuji!', ''];
  const TRANSITIONS = {
    awaiting_transfer: ['paid', 'cancelled'], awaiting_payment: ['cancelled'], amount_mismatch: ['paid', 'cancelled'],
    paid: ['shipped', 'cancelled'], shipped: ['paid'], cancelled: [],
  };

  let products = [];
  let orders = [];
  let loggedIn = true;
  const day = n => new Date(Date.now() - n * 864e5).toISOString();
  let devices = [
    { id: 'a'.repeat(32), label: 'Chrome · Windows', current: true, createdAt: day(12), lastUsedAt: day(0), expiresAt: day(-18) },
    { id: 'b'.repeat(32), label: 'Safari · iPhone / iPad', current: false, createdAt: day(20), lastUsedAt: day(2), expiresAt: day(-10) },
  ];
  const clone = v => JSON.parse(JSON.stringify(v));
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function makeOrders() {
    const now = Date.now(), DAY = 864e5, out = [];
    for (let i = 0; i < 52; i++) {
      const age = i < 6 ? rnd() * 2.5 : Math.pow(rnd(), 1.4) * 95;
      const created = now - age * DAY - rnd() * 3600e3;
      const n = rnd() < .75 ? 1 : 2;
      const lines = [];
      for (let k = 0; k < n; k++) {
        const p = pick(products);
        if (!lines.some(l => l.id === p.id)) lines.push({ id: p.id, name: p.name, price: p.price, qty: rnd() < .9 ? 1 : 2 });
      }
      const shipping = pick(Object.keys(SHIP));
      const payment = rnd() < .62 ? 'card' : 'transfer';
      const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
      let status = age > 5 ? 'shipped' : age > 1.5 ? (rnd() < .5 ? 'shipped' : 'paid') : 'paid';
      if (payment === 'transfer' && age < 6 && rnd() < .7) status = 'awaiting_transfer';
      if (i === 9) status = 'cancelled';
      if (i === 3) status = 'awaiting_payment';
      const [mesto, psc] = pick(PLACES);
      const d = new Date(created);
      const number = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + String(1000 + i * 137 % 9000).padStart(4, '0');
      const jmeno = pick(FIRST), prijmeni = pick(LAST);
      const iso = t => new Date(t).toISOString();
      out.push({
        number, status, payment, shipping, shippingPrice: SHIP[shipping], subtotal, total: subtotal + SHIP[shipping], lines,
        customer: {
          jmeno, prijmeni,
          email: (jmeno + '.' + prijmeni).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '@email.cz',
          telefon: '+420 ' + (600 + Math.floor(rnd() * 199)) + ' ' + String(Math.floor(rnd() * 1e3)).padStart(3, '0') + ' ' + String(Math.floor(rnd() * 1e3)).padStart(3, '0'),
          ulice: pick(STREETS), mesto, psc, zeme: 'CZ', poznamka: i < 8 ? pick(NOTES) : '',
        },
        tracking: status === 'shipped' && shipping === 'zasilkovna' ? 'Z' + Math.floor(1e9 + rnd() * 9e9) : '',
        adminNote: '',
        emailsSent: status !== 'awaiting_payment',
        createdAt: iso(created),
        paidAt: ['paid', 'shipped'].includes(status) ? iso(created + (payment === 'card' ? 60e3 : DAY * rnd())) : null,
        shippedAt: status === 'shipped' ? iso(created + DAY * (1 + rnd() * 2)) : null,
        cancelledAt: status === 'cancelled' ? iso(created + DAY) : null,
      });
    }
    // ukázka dárkového balení a poukazu
    const g = out.find(o => o.status === 'paid');
    if (g) { g.giftWrap = true; g.giftWrapPrice = 59; g.giftMessage = 'Všechno nejlepší, mami!'; g.total += 59; }
    const v = out.find(o => o.status === 'shipped' && o !== g);
    if (v) { v.discount = 500; v.voucherLast4 = 'K7QM'; v.total -= 500; }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // Faktury v ukázce drží localStorage, aby je viděla i tisková stránka v novém okně
  const INV_KEY = 'sa_demo_invoices';
  const loadInv = () => { try { return JSON.parse(localStorage.getItem(INV_KEY)) || null; } catch { return null; } };
  const saveInv = () => { try { localStorage.setItem(INV_KEY, JSON.stringify(invoices)); } catch {} };
  let invoices = [];
  const SELLER = { name: 'Petra Miklušáková', brand: 'Sága Art', street: 'Městečko 212', zip: '270 23', city: 'Křivoklát', country: 'Česká republika', ico: '47055723', vatPayer: false, register: 'Fyzická osoba podnikající podle živnostenského zákona', email: '', web: location.host };
  const PAY = { prevod: 'Bankovním převodem', karta: 'Platební kartou', hotove: 'V hotovosti', dobirka: 'Na dobírku', poukaz: 'Dárkovým poukazem' };
  function sampleInvoices() {
    const y = new Date().getFullYear(), d = n => new Date(Date.now() - n * 864e5).toLocaleDateString('sv-SE');
    const mk = (n, days, cust, items, extra) => {
      const it = items.map(([name, qty, price]) => ({ name, qty, unit: 'ks', price, sum: qty * price }));
      return { number: y + n, issueDate: d(days), taxDate: d(days), dueDate: d(days - 14), payment: 'prevod', paymentLabel: PAY.prevod, vs: String(y) + n,
        customer: { country: 'Česká republika', ...cust }, items: it, total: it.reduce((s, i) => s + i.sum, 0), note: '', orderNumber: '',
        paid: false, storno: false, createdAt: new Date(Date.now() - days * 864e5).toISOString(), seller: SELLER, bank: { account: '123456789/0800', iban: '' }, ...extra };
    };
    return [
      mk('003', 3, { name: 'Kavárna U Lípy s.r.o.', street: 'Náměstí 4', zip: '270 23', city: 'Křivoklát', ico: '12345678' }, [['Náušnice z říčních perel, zakázka', 4, 690], ['Dárková krabička', 4, 40]], {}),
      mk('002', 20, { name: 'Jana Nováková', street: 'Lipová 12', zip: '130 00', city: 'Praha 3' }, [['Náhrdelník Charlotte, na míru', 1, 1490]], { dueDate: d(6) }),
      mk('001', 41, { name: 'Eva Veselá', street: 'Polní 7', zip: '602 00', city: 'Brno' }, [['Náramek z ametystu (trh Křivoklát)', 2, 450]], { payment: 'hotove', paymentLabel: PAY.hotove, paid: true, paidAt: d(41) }),
    ];
  }

  function invoicesApi(method, body) {
    if (method === 'GET') return clone(invoices);
    if (method === 'POST') {
      if (invoices.some(i => i.number === body.number)) throw new Error(`Faktura číslo ${body.number} už existuje`);
      const items = body.items.map(i => ({ ...i, sum: Math.round(i.qty * i.price * 100) / 100 }));
      const now = new Date().toISOString();
      const created = { ...body, items, total: Math.round(items.reduce((s, i) => s + i.sum, 0) * 100) / 100, paymentLabel: PAY[body.payment],
        vs: body.number.replace(/\D/g, '').slice(-10), storno: false, paidAt: body.paid ? now : null, createdAt: now, seller: SELLER, bank: { account: '123456789/0800', iban: '' } };
      if (body.orderNumber) {
        const o = orders.find(x => x.number === body.orderNumber);
        if (!o) throw new Error('Objednávka neexistuje');
        if (o.invoiceNumber) throw new Error(`K objednávce už je faktura ${o.invoiceNumber}`);
        o.invoiceNumber = body.number;
      }
      invoices.unshift(created); saveInv();
      return clone(created);
    }
    const i = invoices.find(x => x.number === body.number);
    if (!i) throw new Error('Faktura neexistuje');
    if (i.storno) throw new Error('Stornovanou fakturu nejde měnit');
    if (body.storno) {
      i.storno = true; i.stornoAt = new Date().toISOString();
      const o = orders.find(x => x.invoiceNumber === i.number);
      if (o) o.invoiceNumber = '';
    } else { i.paid = !!body.paid; i.paidAt = i.paid ? new Date().toISOString() : null; }
    saveInv();
    return clone(i);
  }

  const ready = fetch('/data/products.json').then(r => r.json()).then(list => {
    products = list.map(p => ({ inStock: true, ...p }));
    products[4].inStock = false;
    products[11].inStock = false;
    orders = makeOrders();
    invoices = loadInv() || sampleInvoices();
    saveInv();
  });

  async function api(path, method, body) {
    await wait(180 + Math.random() * 220);
    // přihlášení v ukázce: jakékoli jméno a heslo, pak jakýkoli šestimístný kód
    if (path === '/api/auth?devices=1') return { devices: clone(devices) };
    if (path === '/api/auth') {
      if (method === 'GET') return { authenticated: loggedIn };
      if (method === 'DELETE') {
        if (body.revoke && body.revoke !== devices[0].id) { devices = devices.filter(d => d.id !== body.revoke); return { ok: true }; }
        loggedIn = false;
        return { ok: true, loggedOut: true };
      }
      if (body.code !== undefined) {
        if (!/^\d{6}$/.test(body.code)) throw new Error('Kód má 6 číslic.');
        loggedIn = true;
        return { ok: true };
      }
      if (!body.username || !body.password) throw new Error('Špatné jméno nebo heslo');
      return { needCode: true, email: 'i•••o@gmail.com' };
    }
    if (path === '/api/upload-sign') throw new Error('v ukázce se fotky nenahrávají');

    if (path === '/api/products') {
      if (method === 'GET') return clone(products).sort((a, b) => a.name.localeCompare(b.name, 'cs'));
      if (method === 'POST') { const id = 'demo-' + Date.now(); products.push({ id, ...body }); return { id }; }
      const p = products.find(x => x.id === body.id);
      if (!p) throw new Error('Šperk neexistuje');
      if (method === 'PUT') Object.assign(p, body);
      if (method === 'PATCH') p.inStock = body.inStock;
      if (method === 'DELETE') products = products.filter(x => x !== p);
      return { ok: true };
    }

    if (path === '/api/orders') {
      if (method === 'GET') return clone(orders);
      const o = orders.find(x => x.number === body.number);
      if (!o) throw new Error('Objednávka neexistuje');
      if (body.status && body.status !== o.status) {
        if (!TRANSITIONS[o.status].includes(body.status)) throw new Error('Tuhle změnu stavu nejde udělat');
        o.status = body.status;
        if (!o[body.status + 'At']) o[body.status + 'At'] = new Date().toISOString();
      }
      if (body.tracking !== undefined) o.tracking = String(body.tracking).slice(0, 40);
      if (body.adminNote !== undefined) o.adminNote = String(body.adminNote).slice(0, 1000);
      return clone(o);
    }
    if (path === '/api/invoices') return invoicesApi(method, body);
    throw new Error('Neznámá adresa');
  }

  window.SA_DEMO = { api, ready };
})();
