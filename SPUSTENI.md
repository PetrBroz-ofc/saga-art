# Spuštění e-shopu Sága Art: kontrolní seznam

Stav k 13. 11. 2026: web běží na https://saga-art.vercel.app, ale ve Vercelu ještě nejsou klíče
ke službám. Proto katalog vrací chybu 500 a objednávky nefungují.

Všechny hodnoty se zadávají ve **Vercel → projekt saga-art → Settings → Environment Variables**,
prostředí **Production**. Tajné hodnoty nastavte jako **Sensitive**. Po zadání je potřeba udělat
**Redeploy** (Deployments → poslední → Redeploy), jinak se neprojeví.

Tajné klíče nikomu neposílejte e-mailem ani do chatu. Vkládají se jen přímo do Vercelu.

---

## 1. Doména (Forpsi → Vercel)

1. Vercel → saga-art → Settings → Domains → **Add** → `sagaart.cz` a pak i `www.sagaart.cz`.
2. Forpsi → Správa domény → DNS záznamy:
   - `A` pro `@` (sagaart.cz) → `76.76.21.21`
   - `CNAME` pro `www` → `cname.vercel-dns.com.`
   - staré `A`/`AAAA` záznamy pro `@` a `www` smazat (MX pro e-mail **nemazat**).
3. Ve Vercelu počkat, až domény svítí zeleně (minuty až hodiny).
4. Proměnná `SITE_URL` = `https://sagaart.cz`

## 2. Databáze (Firebase / Firestore)

1. https://console.firebase.google.com → Add project `saga-art` → Build → Firestore Database → Create (region `eur3`, production mode).
2. Firestore → Rules: vložit obsah souboru `firestore.rules` z repozitáře → Publish.
3. Project settings → Service accounts → **Generate new private key** (stáhne se JSON).
4. Z JSON souboru do Vercelu:
   - `FIREBASE_PROJECT_ID` = `project_id`
   - `FIREBASE_CLIENT_EMAIL` = `client_email`
   - `FIREBASE_PRIVATE_KEY` = `private_key` (celé, včetně `-----BEGIN…` a `\n`)
5. Stažený JSON potom smazat z počítače.
6. Nahrát šperky do databáze: vytvořit soubor `.env.local` se třemi FIREBASE_ řádky a spustit `npm run seed`. Soubor je v `.gitignore`, po nahrání ho smažte.

## 3. Administrace

1. V terminálu ve složce SagaArt: `npm run hash-password` → zadat heslo (min. 14 znaků).
2. Do Vercelu:
   - `ADMIN_USERNAME` = přihlašovací jméno
   - `ADMIN_PASSWORD_HASH` = vypsaný řádek `scrypt$…`
   - `ADMIN_EMAIL` = e-mail, kam chodí ověřovací kódy pro nové zařízení
   - `ADMIN_JWT_SECRET` = náhodný řetězec, vygenerujte ho příkazem
     `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
     (z něj se odvozuje i šifrování kódů poukazů, **po spuštění už neměnit**)

## 4. Platby

**Převodem:**
- `BANK_ACCOUNT` = např. `123456789/0800`
- `BANK_IBAN` = např. `CZ65 0800 0000 1920 0014 5399`

**Kartou (Stripe):**
1. https://dashboard.stripe.com → dokončit ověření firmy (fyzická osoba podnikající, IČO 47055723).
2. Developers → API keys → `STRIPE_SECRET_KEY` = `sk_live_…`
3. Developers → Webhooks → Add endpoint `https://sagaart.cz/api/stripe-webhook`,
   události: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`.
4. Signing secret → `STRIPE_WEBHOOK_SECRET` = `whsec_…`

## 5. E-maily (EmailJS)

1. https://www.emailjs.com → Email Services → připojit schránku (info@sagaart.cz).
2. Account → API keys: `EMAILJS_PUBLIC_KEY`, `EMAILJS_PRIVATE_KEY`; Security → zapnout
   „Allow EmailJS API for non-browser applications“.
3. `EMAILJS_SERVICE_ID` = ID služby.
4. Vytvořit 4 šablony. V každé nastavit **To Email** = `{{to_email}}`:

| Proměnná | K čemu | Proměnné v šabloně |
|---|---|---|
| `EMAILJS_TEMPLATE_CUSTOMER` | potvrzení objednávky zákazníkovi | `to_name`, `order_num`, `order_date`, `items`, `doprava`, `platba`, `total`, `variabilni_symbol`, `bank_account`, `bank_iban`, `adresa`, `poznamka` |
| `EMAILJS_TEMPLATE_OWNER` | nová objednávka pro Petru | totéž + `customer_name`, `customer_email`, `telefon` |
| `EMAILJS_TEMPLATE_LOGIN` | kód pro přihlášení do adminu | `code`, `device`, `time`, `valid_minutes` |
| `EMAILJS_TEMPLATE_NOTICE` | obecná zpráva (kódy poukazů, odstoupení) | předmět `{{subject}}`, text `{{message}}` |

5. `OWNER_EMAIL` = kam chodí upozornění na objednávky.
6. Nepovinné: `INVOICE_EMAIL` = e-mail uvedený na fakturách.

## 6. Fotky (Cloudinary)

- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (Dashboard → API Keys).

## 7. Obsah, který ještě dodá Petra

- [ ] cena dárkového balení (teď 59 Kč jen jako zástupná hodnota)
- [ ] odkazy na Instagram a Facebook
- [ ] kontrola obchodních podmínek právníkem

## 8. Test před spuštěním

- [ ] https://sagaart.cz se načte se zámkem (HTTPS) a ukáže šperky
- [ ] přihlášení do `/admin`, kód přijde e-mailem
- [ ] objednávka převodem: oba e-maily přijdou, v adminu je vidět
- [ ] platba kartou v testovacím režimu Stripe (klíče `sk_test_…`), potom přepnout na ostré
- [ ] koupě poukazu → po „Platba dorazila“ přijde kód e-mailem
- [ ] faktura k objednávce → PDF
