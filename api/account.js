const { sleep, fail, noStore, clientIp, limitOrReject, requireAdmin, adminSession } = require('./_utils');
const A = require('./_account');

// Účet majitelky (jméno, e-mail pro kódy, heslo). Jen přihlášená administrace.
//
// GET  /api/account  – kdo jsem a jaký je účet majitelky (heslo se nikdy nevrací)
// POST /api/account  – {username, email, newPassword, current?}
//   - majitelka ("client") si účet mění sama a musí zadat současné heslo
//   - hlavní účet ("owner") ho smí nastavit nebo obnovit bez znalosti starého hesla
// Po změně se majitelce odhlásí ostatní zařízení (u obnovení hlavním účtem všechna).

export default async function handler(req, res) {
  if (!(await requireAdmin(req, res, ['GET', 'POST']))) return;
  try {
    const s = await adminSession(req);
    if (!s) return fail(res, 401, 'Neautorizováno');
    const acc = await A.getClientAccount();

    if (req.method === 'GET') {
      return res.status(200).json({
        who: s.who,
        client: { set: !!acc, username: acc?.username || '', email: acc?.email || '' },
        minPassword: A.MIN_PASSWORD,
      });
    }

    const b = req.body || {};
    const username = typeof b.username === 'string' ? b.username.trim() : '';
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const pass = b.newPassword;
    if (!A.validUsername(username)) return fail(res, 400, 'Jméno musí mít 3 až 40 znaků: písmena bez diakritiky, číslice, tečku, podtržítko, pomlčku nebo @.');
    if (!A.validEmail(email)) return fail(res, 400, 'Zkontrolujte prosím e-mail, na který budou chodit kódy.');
    const passErr = A.validatePassword(pass);
    if (passErr) return fail(res, 400, passErr);
    if (A.norm(username) === A.norm(process.env.ADMIN_USERNAME || '')) return fail(res, 400, 'Toto jméno nelze použít, zvolte jiné.');
    if (await A.ownerPasswordOk(pass)) return fail(res, 400, 'Toto heslo nelze použít, zvolte jiné.');

    if (s.who === 'client') {
      // majitelka potvrzuje současným heslem; pokusy se omezují
      if (!(await limitOrReject(res, 'pw_change', clientIp(req), 5, 15 * 60 * 1000))) return;
      const current = b.current;
      const ok = acc && typeof current === 'string' && current && current.length <= 200 && (await A.clientLogin(acc.username, current));
      if (!ok) {
        await sleep(400 + Math.random() * 400);
        return fail(res, 401, 'Současné heslo není správné.');
      }
    }

    await A.setClientAccount({ username, email, password: pass });
    await A.revokeDevices('client', s.who === 'client' ? s.did : null);
    noStore(res);
    return res.status(200).json({ ok: true, client: { set: true, username, email } });
  } catch (e) {
    console.error('account error:', e.message);
    return fail(res, 500, 'Účet se nepodařilo uložit. Zkuste to prosím znovu.');
  }
}
