'use strict';
// Slevy přímo u šperku. Zákazník platí `salePrice`, dokud sleva běží (volitelně do `saleTo` včetně).
// Přeškrtnutá cena se nezadává ručně: podle zákona o ochraně spotřebitele (§ 12a, směrnice Omnibus) to musí
// být nejnižší cena za 30 dní před začátkem slevy. Proto se při ukládání vede historie cen (`priceHistory`)
// a na začátku slevy se spočítá `saleRef`. Nový šperk dřívější cenu nemá, takže se u něj nic nepřeškrtává.

const DAY = 864e5;
const pragueDay = (t = Date.now()) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
const daysBefore = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') - n * DAY).toISOString().slice(0, 10);
const isPrice = n => Number.isInteger(n) && n > 0 && n <= 1000000;

function saleActive(p, today = pragueDay()) {
  return !!p && isPrice(p.salePrice) && p.salePrice < Number(p.price) && (!p.saleTo || today <= p.saleTo);
}
const effectivePrice = (p, today) => (saleActive(p, today) ? p.salePrice : Number(p?.price));

// Co vidí zákazník: { price, was, percent }. `was` jen když jde slevu poctivě ukázat.
function shown(p, today) {
  const price = effectivePrice(p, today);
  if (!saleActive(p, today) || !isPrice(p.saleRef) || p.saleRef <= price) return { price, was: 0, percent: 0 };
  return { price, was: p.saleRef, percent: Math.floor((p.saleRef - price) * 100 / p.saleRef) };
}

// Nejnižší cena za 30 dní před dnem `today`
function lowest30(regular, history, today) {
  const from = daysBefore(today, 30);
  return Math.min(Number(regular), ...history.filter(h => h.until >= from && isPrice(h.price)).map(h => h.price));
}

// Vrátí pole k uložení. `prev` = uložený šperk (null u nového), `next` = { price, salePrice, saleTo }.
function priceFields(prev, next, today = pragueDay()) {
  let history = Array.isArray(prev?.priceHistory) ? prev.priceHistory.slice() : [];
  const running = !!prev && saleActive(prev, today);
  const salePrice = isPrice(next.salePrice) ? next.salePrice : 0;
  const saleTo = salePrice ? next.saleTo || '' : '';

  if (prev) {
    // sleva, která skončila datem nebo se teď mění či ruší, patří do historie
    if (isPrice(prev.salePrice) && (!running || prev.salePrice !== salePrice)) {
      const until = running ? today : (prev.saleTo && prev.saleTo < today ? prev.saleTo : today);
      history.push({ price: prev.salePrice, until });
    }
    if (isPrice(Number(prev.price)) && Number(prev.price) !== next.price) history.push({ price: Number(prev.price), until: today });
  }

  let saleRef = 0, saleFrom = '';
  if (salePrice) {
    if (running) {
      // sleva běží dál (i prohloubená): srovnává se pořád s cenou před jejím začátkem
      saleRef = prev.saleRef || 0;
      saleFrom = prev.saleFrom || today;
    } else {
      saleFrom = today;
      if (prev) saleRef = lowest30(prev.price, history, today);
    }
  }

  // stará historie se zahazuje (stačí 30 dní, pro jistotu 90)
  history = history.filter(h => h.until >= daysBefore(today, 90)).slice(-60);
  return { salePrice, saleTo, saleFrom, saleRef, priceHistory: history };
}

// Kontrola vstupu z administrace
function validateSale(body, price, today = pragueDay()) {
  const raw = body.salePrice;
  if (raw === undefined || raw === null || raw === '' || Number(raw) === 0) return { salePrice: 0, saleTo: '' };
  const salePrice = Number(raw);
  if (!isPrice(salePrice)) return { error: 'Cena ve slevě musí být celé číslo v Kč' };
  if (salePrice >= price) return { error: 'Cena ve slevě musí být nižší než běžná cena' };
  const saleTo = String(body.saleTo || '');
  if (saleTo) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(saleTo) || isNaN(Date.parse(saleTo + 'T00:00:00Z'))) return { error: 'Neplatné datum konce slevy' };
    if (saleTo < today) return { error: 'Konec slevy už uplynul. Vyberte dnešní nebo pozdější datum.' };
  }
  return { salePrice, saleTo };
}

module.exports = { pragueDay, saleActive, effectivePrice, shown, priceFields, validateSale, lowest30 };
