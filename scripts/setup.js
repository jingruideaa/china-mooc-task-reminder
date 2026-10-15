const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ROOT, LOCAL, validateConfig } = require('../bridge/config');
function setup({ root = ROOT, local = LOCAL, email } = {}) {
  fs.mkdirSync(local, { recursive: true });
  const file = path.join(local, 'config.json');
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : JSON.parse(fs.readFileSync(path.join(root, 'config.example.json'), 'utf8'));
  if (!config.token) config.token = crypto.randomBytes(32).toString('hex');
  if (email) { config.smtp.username = email; config.smtp.from = email; config.smtp.to = [email]; }
  validateConfig(config);
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(path.join(root, 'extension/bridge_config.js'), `// Generated locally; never commit this file.\nconst MOOC_BRIDGE_TOKEN = ${JSON.stringify(config.token)};\n`, { encoding: 'utf8', mode: 0o600 });
  return { configured: true };
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length && !(args.length === 2 && args[0] === '--email')) throw new Error('Usage: npm run setup -- --email YOUR_EMAIL');
    setup({ email: args[1] });
    console.log('Created .local/config.json and extension/bridge_config.js. Configure your email, then run scripts/save-credential.ps1. Local settings are ignored by Git.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { setup };
