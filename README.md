# Sága Art — e-shop

Ručně vyráběné šperky z pravých říčních perel, minerálů a nerezové oceli.

```
public/            statický web (jediné, co Vercel servíruje)
  index.html       obchod — kolekce, filtr, detail, košík, 4krokový checkout
  admin.html       správa šperků (heslo + 2FA)
  css/ js/         styly a skripty (žádný inline JS kvůli CSP)
  data/products.json  výchozí šperky (seed + náhled bez serveru)
api/               Vercel serverless funkce
  order.js         vytvoření objednávky (karta → Stripe, převod → e-mail)
  stripe-webhook.js  potvrzení platby
  auth.js          přihlášení / odhlášení adminu
  products.js      správa šperků (admin)
  upload-sign.js   podepsané nahrání fotek (admin)
scripts/           pomocné skripty (heslo, 2FA, seed) — nenasazují se
vercel.json        bezpečnostní hlavičky (CSP, HSTS…)
```

Nastavení a bezpečnost: viz [SECURITY.md](SECURITY.md).

Lokální náhled (bez API): `python -m http.server 5530 --directory public`
