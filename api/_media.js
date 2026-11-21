'use strict';
// Fotky nahrané z administrace. Ukládají se do stejné databáze jako všechno ostatní (kolekce media) pod
// náhodným názvem a vydávají se z adresy /media/<název>. Nepotřebují žádnou cizí službu ani nastavení.
// Prohlížeč fotku před nahráním zmenší, server přesto ověří, že jde o skutečný JPEG, PNG nebo WebP (podle
// obsahu, ne podle názvu), a nepustí nic většího než MAX_BYTES.

const MAX_BYTES = 3 * 1024 * 1024;
const MEDIA_PATH_RE = /^\/media\/[a-f0-9]{24}\.(jpg|png|webp)$/;
const FILE_RE = /^([a-f0-9]{24})\.(jpg|png|webp)$/;
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// Pozná obrázek podle prvních bajtů. Vrací { ext, type } nebo null.
function detectImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: TYPES.jpg };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: TYPES.png };
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', type: TYPES.webp };
  return null;
}

module.exports = { MAX_BYTES, MEDIA_PATH_RE, FILE_RE, TYPES, detectImage };
