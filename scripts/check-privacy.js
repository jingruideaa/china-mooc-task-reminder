const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const forbiddenPath = /(?:^|\/)(?:\.local|reports|node_modules|[^/]*profile[^/]*|User Data)(?:\/|$)|(?:^|\/)(?:Cookies|History|Login Data|Local State|bridge_config\.json|bridge-status\.json)$|^extension\/bridge_config\.js$/i;
function filesOnDisk(dir = ROOT) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (['.git', '.local', 'node_modules'].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) return [path.relative(ROOT, full).replaceAll('\\', '/')];
    return entry.isDirectory() ? filesOnDisk(full) : [path.relative(ROOT, full).replaceAll('\\', '/')];
  });
}
function checkPrivacy(files, read) {
  const issues = [];
  for (const file of files) {
    if (forbiddenPath.test(file)) { issues.push({ file, reason: 'Private or generated data path' }); continue; }
    const data = read(file);
    if (file.endsWith('.png')) continue;
    const source = data.toString('utf8');
    const emailAddresses = source.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    if (emailAddresses.some(address => !/@example\.(?:com|org|net)$/i.test(address))) issues.push({ file, reason: 'Non-example email address' });
    if (/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(source)) issues.push({ file, reason: 'Possible GitHub access token' });
    if (/\b[A-Za-z]:[\\/]Users[\\/][^\s"'<>]+/.test(source)) issues.push({ file, reason: 'Personal Windows profile path' });
    if (/[?&]userId=\d{6,}|\b[A-Z]{2,}-\d{5,}\b/.test(source)) issues.push({ file, reason: 'Possible real course or account identifier' });
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(source)) issues.push({ file, reason: 'Private key' });
  }
  return issues;
}
if (require.main === module) {
  const result = spawnSync('git', ['ls-files', '--cached', '-z'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  const staged = result.status === 0 ? result.stdout.split('\0').filter(Boolean) : [];
  const files = staged.length ? staged : filesOnDisk();
  const read = staged.length ? file => {
    const blob = spawnSync('git', ['show', ':' + file], { cwd: ROOT, windowsHide: true, maxBuffer: 3000000 });
    if (blob.status !== 0) throw new Error('Could not inspect staged file: ' + file);
    return blob.stdout;
  } : file => fs.readFileSync(path.join(ROOT, file));
  const issues = checkPrivacy(files, read);
  if (issues.length) { console.error(JSON.stringify(issues, null, 2)); process.exitCode = 1; }
  else console.log(`Privacy checks passed for ${files.length} source files. Review content and commit metadata before publishing.`);
}
module.exports = { checkPrivacy };
