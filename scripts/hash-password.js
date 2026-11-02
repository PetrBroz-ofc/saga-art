// Vygeneruje ADMIN_PASSWORD_HASH (scrypt). Heslo se nikam neukládá ani neodesílá
// a při psaní se nezobrazuje. Použití: npm run hash-password
const crypto = require('crypto');
const readline = require('readline');

function askHidden(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (!rl.muted) rl.output.write(s); };
    rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer); });
    rl.muted = true;
  });
}

(async () => {
  const password = await askHidden('Nové heslo do adminu (min. 14 znaků): ');
  if (password.length < 14) {
    console.error('Heslo je moc krátké. Použijte aspoň 14 znaků, nejlépe větu nebo heslo ze správce hesel.');
    process.exit(1);
  }
  if (new Set(password).size < 6) {
    console.error('Heslo má málo různých znaků. Zvolte prosím jiné.');
    process.exit(1);
  }
  const again = await askHidden('Zopakujte heslo: ');
  if (again !== password) {
    console.error('Hesla se neshodují, nic se nevygenerovalo.');
    process.exit(1);
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  console.log('\nVložte do Vercelu jako ADMIN_PASSWORD_HASH (typ Sensitive):\n');
  console.log(`scrypt$${salt.toString('hex')}$${hash.toString('hex')}\n`);
})();
