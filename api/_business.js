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

// Bankovní spojení pro platby převodem (účet majitelky, Air Bank). Proměnné prostředí BANK_ACCOUNT a BANK_IBAN
// ve Vercelu mají přednost, kdyby se účet někdy měnil.
const BANK = { account: '6922675319/0800', iban: 'CZ19 0800 0000 0069 2267 5319' };

// Kontakt je v proměnných prostředí Vercelu
const seller = () => ({
  ...SELLER,
  email: process.env.INVOICE_EMAIL || '',
  web: (process.env.SITE_URL || '').replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
});
const bank = () => ({ account: process.env.BANK_ACCOUNT || BANK.account, iban: process.env.BANK_IBAN || BANK.iban });

module.exports = { SELLER, BANK, seller, bank };
