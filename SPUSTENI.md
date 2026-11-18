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

## 2. Databáze (Neon, přímo ve Vercelu)

1. Vercel → projekt saga-art → záložka **Storage** → **Create Database** → **Neon** (Postgres) → plán **Free** → region **Frankfurt** (nebo nejbližší) → **Create**.
2. Připojit k projektu saga-art pro prostředí **Production** (a Preview). Vercel sám přidá proměnnou `DATABASE_URL`.
3. Tabulku si server vytvoří sám při prvním použití, nic nespouštíte ručně.
4. Nahrát šperky do databáze: ve Vercelu u databáze **Show secret** → zkopírovat `DATABASE_URL`, vložit do souboru `.env.local` jako řádek `DATABASE_URL=...` a spustit `npm run seed`. Soubor je v `.gitignore`, po nahrání ho smažte.

## 3. Administrace (dva účty)

**Hlavní účet (váš)** je ve Vercelu a funguje vždy. Heslo se mění jen tam:

1. Heslo napíšete přímo do Vercelu jako proměnnou `ADMIN_PASSWORD` (aspoň 10 znaků, lépe 14+; jako **Sensitive**). Změní se úpravou proměnné a **Redeploy**.
2. Do Vercelu (Production, tajné jako **Sensitive**):
   - `ADMIN_USERNAME` = vaše přihlašovací jméno
   - `ADMIN_PASSWORD` = vaše heslo (alternativa: `ADMIN_PASSWORD_HASH` = scrypt otisk z `npm run hash-password`, platí-li obě, vyhrává `ADMIN_PASSWORD`)
   - `ADMIN_EMAIL` = váš e-mail, kam chodí ověřovací kódy
   - `ADMIN_JWT_SECRET` = náhodný řetězec, vytvoří ho `node scripts/gen-secret.js`
     (odvozuje se z něj i šifrování kódů poukazů, **po spuštění už neměnit**)

**Účet Petry (majitelky)** je v databázi, ne ve Vercelu:

1. Přihlaste se hlavním účtem → **Zabezpečení** → **Přístup majitelky** → zadejte jméno, její e-mail (chodí na něj kódy) a první heslo → **Nastavit přístup**.
2. Petra se přihlásí svým jménem a heslem, kód jí přijde na její e-mail.
3. Heslo, jméno i e-mail si pak mění sama v **Zabezpečení → Moje jméno a heslo** (po zadání současného hesla). Po změně se odhlásí na ostatních zařízeních.
4. Zapomene-li heslo, obnovíte jí přístup stejným formulářem (hlavním účtem), starý heslo nepotřebujete.
5. Hlavní účet zůstává váš, Petra ho nemůže změnit ani odebrat.

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
