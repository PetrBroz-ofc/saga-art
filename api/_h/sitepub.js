const { fail, guard } = require('../_utils');
const S = require('../_site');

// GET /api/site — veřejné nastavení vzhledu a textů pro web (jen pro čtení, krátce v keši).
module.exports = async function handler(req, res) {
  if (!guard(req, res, ['GET'])) return;
  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=20');
  try {
    return res.status(200).json(S.publicView(await S.load()));
  } catch (err) {
    console.error('site public error:', err.message);
    return fail(res, 500, 'Interní chyba serveru');
  }
};
