# Bezpečnost — Sága Art

Hlášení zranitelností: **info.pebmedia@gmail.com** (PEBMedia) (prosím neveřejně, dokud nebude oprava).

## Jak je e-shop chráněný

### Objednávky a platby
- **Ceny, doprava, součty i číslo objednávky určuje jen server** (`api/_shop.js`). Prohlížeč posílá pouze id šperku + počet kusů.
- Ceny se čtou **jen z databáze** — smazaný nebo prodaný šperk koupit nejde.
- Každá objednávka se uloží do databáze dřív, než se cokoli zaplatí nebo odešle.
- Platba kartou se označí jako zaplacená **jen webhookem se Stripe podpisem**, a jen když sedí částka i měna. Webhook je idempotentní (opakované doručení nic nerozbije).
- Údaje zákaznice prochází přísnou validací (whitelist polí, délky, formát e-mailu, telefonu, PSČ, země, odstranění řídicích znaků).
- Ochrana proti spamu: rate limit 5 objednávek / 10 min na IP (sdílený přes databázi) + honeypot pole proti botům.
- **E-maily posílá jen server** (EmailJS REST API s privátním klíčem). Z prohlížeče už e-mail poslat nejde.

### Admin
- Přihlášení **jménem + heslem**, na každém novém zařízení navíc **jednorázovým kódem z e-mailu** (6 číslic, platí 10 min, jde použít jen jednou, po 5 špatných pokusech propadne).
- Ověřené zařízení platí **30 dní**, pak se musí ověřit znovu. Zařízení je uložené v databázi (`admin_devices`) a každý požadavek adminu ho kontroluje, takže odebrání zařízení v sekci Zabezpečení ho **okamžitě odhlásí**.
- Kód se v databázi drží jen jako HMAC, ne v čitelné podobě. E-mailů s kódem odejde nejvýš 8 za hodinu.
- Heslo je uložené jen jako **scrypt hash** (`ADMIN_PASSWORD_HASH`), nikdy v čitelné podobě.
- **Dva účty:** hlavní (Vercel, patří vývojáři, funguje vždy) a majitelky (databáze, jen scrypt otisk hesla se solí). Majitelka si jméno, e-mail pro kódy i heslo mění sama po zadání současného hesla (omezení 5 pokusů / 15 min), hlavní účet jí přístup smí obnovit. Po změně se ostatní zařízení majitelky odhlásí. Ověřená zařízení patří vždy jednomu účtu: zařízení hlavního účtu nepřeskočí kód u účtu majitelky. Každý účet vidí a odebírá jen svá zařízení.
- Limit pokusů: 5 / 15 min na IP a 20 / hod celkově — sdílený přes databázi, platí napříč servery. Když databáze neodpoví, přihlášení se odmítne (fail-closed).
- Session = podepsaný JWT (HS256, issuer/audience, 2 h) v **HttpOnly; Secure; SameSite=Strict** cookie s prefixem `__Host-`. JavaScript na stránce k ní nemá přístup.
- Okamžité odhlášení všech zařízení: změň `ADMIN_SESSION_VERSION` (např. z `1` na `2`).
- CSRF: zapisující requesty musí mít Origin vlastní domény a `Content-Type: application/json`.
- Fotky se nahrávají **podepsaně** přes `/api/upload-sign` — nahrávat smí jen přihlášený admin, Cloudinary secret neopustí server. Uložit lze jen URL z vlastního Cloudinary účtu.

### Prohlížeč
- Přísná **Content-Security-Policy**: skripty jen z vlastní domény, žádný inline JavaScript, žádné cizí skripty.
- HSTS (2 roky, preload), `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, COOP/CORP.
- Veškerý dynamický obsah se escapuje proti XSS; URL obrázků jen `https`.
- Admin má `noindex` a `no-store`.

### Databáze a infrastruktura
- Databáze je **Postgres (Neon)**. Nemá žádný veřejný přístup z prohlížeče, připojit se k ní smí jen server přes tajný `DATABASE_URL`. Všechny dotazy jdou s parametry (žádné lepení SQL).
- Na Vercel se nasazuje jen `public/` + `api/`; skripty a dokumentace ne (`.vercelignore`).
- Závislosti mají pevné verze + `package-lock.json`. Kontrola: `npm audit --omit=dev`.
- Chyby se logují bez osobních údajů a klientovi se nevrací detaily serveru.

## Nastavení — environment proměnné (Vercel → Settings → Environment Variables)

| Proměnná | Jak získat |
| --- | --- |
| `SITE_URL` | `https://sagaart.cz` (přesně, bez lomítka na konci) |
| `ADMIN_PASSWORD_HASH` | `npm run hash-password` (heslo min. 14 znaků) |
| `ADMIN_USERNAME` | přihlašovací jméno do adminu (velikost písmen nehraje roli) |
| `ADMIN_EMAIL` | kam chodí kódy pro ověření nového zařízení |
| `EMAILJS_TEMPLATE_LOGIN` | šablona EmailJS s proměnnými `{{to_email}}`, `{{code}}`, `{{device}}`, `{{time}}`, `{{valid_minutes}}` |
| `ADMIN_JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ADMIN_SESSION_VERSION` | `1` (zvýšením odhlásíš a zapomeneš všechna zařízení) |
| `STRIPE_SECRET_KEY` | Stripe → **Restricted key** jen s právy Checkout Sessions (write) |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → endpoint `https://sagaart.cz/api/stripe-webhook`, události `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` |
| `DATABASE_URL` | vytvoří se sama, když ve Vercelu přidáš databázi Neon (Storage → Create Database → Neon) |
| `EMAILJS_SERVICE_ID`, `EMAILJS_PUBLIC_KEY`, `EMAILJS_PRIVATE_KEY`, `EMAILJS_TEMPLATE_CUSTOMER`, `EMAILJS_TEMPLATE_OWNER` | EmailJS → Account → Security: zapnout *API access from non-browser*, **vypnout** přístup z prohlížeče |
| `OWNER_EMAIL` | kam chodí upozornění na objednávky |
| `BANK_ACCOUNT`, `BANK_IBAN` | účet pro platby převodem |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary → Settings → API Keys. **Smaž všechny unsigned upload presety.** |

Secrety ukládej na Vercelu jako **Sensitive**, nikdy do repozitáře (je veřejný).

## Kontrolní seznam před spuštěním
1. Databáze: ve Vercelu přidat Neon (tabulka se vytvoří sama, úklid prošlých záznamů probíhá automaticky).
2. Databáze: `npm run seed` (s `.env.local`, kde je `DATABASE_URL`) nahraje výchozí šperky.
3. Neon: zapnout 2FA na účtu a nikde nesdílet `DATABASE_URL`.
4. Stripe: webhook + restricted key, zapnout Radar.
5. EmailJS: šablony nepoužívají `{{{trojité}}}` závorky (ty vypínají escapování).
6. Vercel: Settings → Deployment Protection pro Preview deploymenty; zapnout **Firewall / Bot protection**.
7. Účty Vercel, GitHub, Stripe, Neon, Cloudinary, EmailJS: všude **2FA**.
8. Doména: po ověření HTTPS přidat na https://hstspreload.org.
