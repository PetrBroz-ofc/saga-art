// Údaje provozovatelky e-shopu — jeden zdroj pro faktury (ověřeno v ARES 9. 11. 2026).
const SELLER = {
  name: 'Petra Miklušáková',
  brand: 'Sága Art',
  street: 'Městečko 212',
  zip: '270 23',
  city: 'Křivoklát',
  country: 'Česká republika',
  ico: '47055723',
  vatPayer: false,
  register: 'Fyzická osoba podnikající podle živnostenského zákona',
};

// Kontakt a bankovní spojení jsou v proměnných prostředí Vercelu (stejné jako u plateb převodem)
const seller = () => ({
  ...SELLER,
  email: process.env.INVOICE_EMAIL || '',
  web: (process.env.SITE_URL || '').replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
});
const bank = () => ({ account: process.env.BANK_ACCOUNT || '', iban: process.env.BANK_IBAN || '' });

module.exports = { SELLER, seller, bank };
