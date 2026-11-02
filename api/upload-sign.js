const crypto = require('crypto');
const { fail, requireAdmin } = require('./_utils');

// POST /api/upload-sign — podpis pro nahrání fotky do Cloudinary.
// Nahrávat smí JEN přihlášený admin; API secret nikdy neopustí server.
export default async function handler(req, res) {
  if (!(await requireAdmin(req, res, ['POST']))) return;

  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = process.env;
  if (!cloud || !apiKey || !apiSecret) return fail(res, 500, 'Cloudinary není nakonfigurován');

  const params = {
    allowed_formats: 'jpg,jpeg,png,webp',
    folder: 'sagaart',
    timestamp: Math.floor(Date.now() / 1000),
  };
  // Cloudinary podpis: parametry seřazené abecedně + secret, SHA-256
  const toSign = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  const signature = crypto.createHash('sha256').update(toSign + apiSecret).digest('hex');

  res.status(200).json({ cloud, apiKey, signature, signatureAlgorithm: 'sha256', ...params });
}
