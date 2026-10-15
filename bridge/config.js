const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const LOCAL = path.join(ROOT, '.local');
function validateConfig(config) {
  if (!config || !/^[a-f0-9]{64}$/.test(config.token || '')) throw new Error('Run npm run setup to generate the local connection token.');
  const smtp = config.smtp;
  const email = value => typeof value === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
  if (!smtp || !smtp.host || !Number.isInteger(smtp.port) || smtp.port < 1 || smtp.port > 65535 || smtp.enableSsl !== true) throw new Error('SMTP host, port and TLS settings are invalid.');
  if (!email(smtp.username) || !email(smtp.from) || !Array.isArray(smtp.to) || !smtp.to.length || !smtp.to.every(email)) throw new Error('Configure sender, username and recipient email addresses in .local/config.json.');
  if (typeof smtp.credentialTarget !== 'string' || !smtp.credentialTarget.trim()) throw new Error('A Windows credential target is required.');
  return config;
}
function loadConfig(filePath = path.join(LOCAL, 'config.json')) {
  if (!fs.existsSync(filePath)) throw new Error('Local configuration is missing. Run npm run setup first.');
  return validateConfig(JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')));
}
module.exports = { ROOT, LOCAL, validateConfig, loadConfig };
