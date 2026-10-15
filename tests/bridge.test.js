const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMailBridge } = require('../bridge/server');
const { setup } = require('../scripts/setup');
const { checkPrivacy } = require('../scripts/check-privacy');
async function bridge(t, sender = async () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mooc-bridge-test-'));
  const token = 'a'.repeat(64);
  const server = createMailBridge({ config: { token }, reportDir: dir, sendMail: sender });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, url: 'http://127.0.0.1:' + server.address().port, headers: { 'Content-Type': 'application/json', 'X-MOOC-Token': token } };
}
test('mail bridge rejects missing credentials, untrusted webpages and invalid report paths', async t => {
  const b = await bridge(t);
  assert.equal((await fetch(b.url + '/report', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await fetch(b.url + '/report', { method: 'POST', headers: { ...b.headers, Origin: 'https://example.org' }, body: '{}' })).status, 403);
  assert.equal((await fetch(b.url + '/report', { method: 'POST', headers: b.headers, body: JSON.stringify({ id: '../escape', body: 'Synthetic report' }) })).status, 400);
  assert.equal((await fetch(b.url + '/report', { method: 'POST', headers: b.headers, body: '{' })).status, 400);
  assert.equal(fs.readdirSync(b.dir).length, 0);
});
test('bridge waits for actual send success, persists a receipt and prevents duplicate mail', async t => {
  let calls = 0;
  const b = await bridge(t, async file => { calls++; assert.equal(fs.readFileSync(file, 'utf8'), '虚构课程日报'); });
  const request = () => fetch(b.url + '/report', { method: 'POST', headers: b.headers, body: JSON.stringify({ id: 'synthetic-1', body: '虚构课程日报' }) });
  assert.equal((await (await request()).json()).sent, true);
  assert.equal((await (await request()).json()).duplicate, true);
  assert.equal(calls, 1);
  assert.ok(fs.existsSync(path.join(b.dir, 'extension-synthetic-1.sent.json')));
});
test('failed sends do not create receipts or expose raw SMTP errors', async t => {
  const b = await bridge(t, async () => { throw new Error('Synthetic internal diagnostic'); });
  const response = await fetch(b.url + '/report', { method: 'POST', headers: b.headers, body: JSON.stringify({ id: 'synthetic-2', body: 'Synthetic report' }) });
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /Synthetic internal diagnostic/);
  assert.equal(fs.existsSync(path.join(b.dir, 'extension-synthetic-2.sent.json')), false);
});
test('setup creates a per-install token, preserves it and never adds a password field', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mooc-setup-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'extension'));
  fs.copyFileSync(path.join(__dirname, '../config.example.json'), path.join(root, 'config.example.json'));
  const local = path.join(root, '.local');
  setup({ root, local, email: 'learner@example.com' });
  const first = JSON.parse(fs.readFileSync(path.join(local, 'config.json'), 'utf8'));
  setup({ root, local });
  const second = JSON.parse(fs.readFileSync(path.join(local, 'config.json'), 'utf8'));
  assert.match(first.token, /^[a-f0-9]{64}$/);
  assert.equal(first.token, second.token);
  assert.equal(first.smtp.from, 'learner@example.com');
  assert.equal(first.smtp.password, undefined);
  assert.ok(fs.readFileSync(path.join(root, 'extension/bridge_config.js'), 'utf8').includes(first.token));
});
test('privacy checks reject generated data paths and permit fictional examples', () => {
  assert.equal(checkPrivacy(['.local/config.json'], () => Buffer.from('{}')).length, 1);
  assert.equal(checkPrivacy(['extension/bridge_config.js'], () => Buffer.from('')).length, 1);
  assert.equal(checkPrivacy(['examples/report.txt'], () => Buffer.from('student@example.com')).length, 0);
});
