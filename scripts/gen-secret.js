// Vypíše náhodný tajný klíč pro ADMIN_JWT_SECRET. Nikam se neukládá, jen se zobrazí v terminálu.
console.log('\nVložte do Vercelu jako ADMIN_JWT_SECRET (typ Sensitive):\n');
console.log(require('crypto').randomBytes(48).toString('hex') + '\n');
