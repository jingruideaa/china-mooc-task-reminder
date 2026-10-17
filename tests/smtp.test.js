const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { message, sendSmtp } = require('../bridge/smtp');
const smtp = { host: 'smtp.example.com', port: 587, enableSsl: true, username: 'learner@example.com', from: 'learner@example.com', to: ['student@example.com'] };
function server({ tlsOffered = true, authorized = true, authFails = false } = {}) {
  const writes = []; let phase = 'commands', upgraded = false, connection, secureOptions;
  class Socket extends EventEmitter {
    write(value) {
      writes.push(value);
      let reply;
      if (phase === 'username') { phase = 'password'; reply = '334 Password'; }
      else if (phase === 'password') { phase = 'commands'; reply = authFails ? '535 Authentication failed' : '235 Authenticated'; }
      else if (phase === 'data') { phase = 'commands'; reply = '250 Accepted'; }
      else if (value.startsWith('EHLO')) reply = tlsOffered && !upgraded ? '250-localhost\r\n250 STARTTLS' : '250 localhost';
      else if (value.startsWith('STARTTLS')) reply = '220 Ready for TLS';
      else if (value.startsWith('AUTH LOGIN')) { assert.equal(upgraded, true); phase = 'username'; reply = '334 Username'; }
      else if (value.startsWith('DATA')) { phase = 'data'; reply = '354 Send message'; }
      else reply = '250 OK';
      queueMicrotask(() => this.emit('data', Buffer.from(reply + '\r\n')));
    }
    end() {}
    destroy() { this.destroyed = true; }
  }
  return {
    writes,
    options: () => ({ connection, secureOptions }),
    transport: {
      connect(options) { connection = options; const socket = new Socket(); queueMicrotask(() => socket.emit('data', Buffer.from('220 Synthetic server\r\n'))); return socket; },
      upgrade(options) { secureOptions = options; upgraded = true; const socket = new Socket(); socket.authorized = authorized; queueMicrotask(() => socket.emit('secureConnect')); return socket; }
    }
  };
}
test('mail transport uses IPv4, validates TLS and waits for message acceptance', async () => {
  const fake = server();
  assert.equal((await sendSmtp({ smtp, password: 'synthetic-secret', body: '虚构日报' }, fake.transport)).sent, true);
  assert.equal(fake.options().connection.family, 4);
  assert.equal(fake.options().secureOptions.servername, smtp.host);
  assert.equal(fake.options().secureOptions.rejectUnauthorized, true);
  assert.ok(fake.writes.find(value => value.startsWith('MAIL FROM:')));
  const data = fake.writes.find(value => value.startsWith('From:'));
  assert.match(data, /Content-Transfer-Encoding: base64/);
  assert.ok(data.includes(Buffer.from('虚构日报').toString('base64')));
});
test('credentials are never sent when TLS is unavailable or unverified', async () => {
  for (const options of [{ tlsOffered: false }, { authorized: false }]) {
    const fake = server(options);
    await assert.rejects(sendSmtp({ smtp, password: 'synthetic-secret', body: 'Synthetic report' }, fake.transport));
    assert.equal(fake.writes.some(value => value.startsWith('AUTH LOGIN')), false);
  }
});
test('SMTP authentication rejection prevents mail submission', async () => {
  const fake = server({ authFails: true });
  await assert.rejects(sendSmtp({ smtp, password: 'synthetic-secret', body: 'Synthetic report' }, fake.transport), /535/);
  assert.equal(fake.writes.some(value => value.startsWith('MAIL FROM:')), false);
});
test('connection verification authenticates without submitting a message', async () => {
  const fake = server();
  assert.equal((await sendSmtp({ smtp, password: 'synthetic-secret', body: 'Synthetic report' }, { ...fake.transport, verifyOnly: true })).authenticated, true);
  assert.equal(fake.writes.some(value => value.startsWith('MAIL FROM:')), false);
});
test('mail formatting rejects header injection and preserves Unicode body text', () => {
  assert.throws(() => message({ from: 'student@example.com\r\nBcc: other@example.com', to: smtp.to, body: 'Synthetic' }));
  assert.throws(() => message({ from: smtp.from, to: smtp.to, body: 'Synthetic', subject: 'Test\r\nBcc: other@example.com' }));
  const output = message({ from: smtp.from, to: smtp.to, body: '自评与互评\n.示例内容' });
  const encoded = output.split('\r\n\r\n')[1].replace(/\s/g, '');
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), '自评与互评\n.示例内容');
});
test('Windows PowerShell passes plain report text without file metadata', { skip: process.platform !== 'win32' }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mooc-mail-input-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const body = '虚构日报：自评已完成，互评尚未完成。';
  fs.writeFileSync(path.join(dir, 'report.txt'), body, 'utf8');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ smtp: { ...smtp, credentialTarget: 'SyntheticCredential' } }), 'utf8');
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const script = `
    $ErrorActionPreference='Stop'
    $ProgressPreference='SilentlyContinue'
    [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
    Add-Type -TypeDefinition 'public static class MoocCredentialStore { public static string Read(string target,out string user){user="learner@example.com";return "synthetic-secret";} }'
    function global:node { param([Parameter(Position=0)]$CliPath,[Parameter(ValueFromPipeline=$true)]$InputObject) process { $global:CapturedPayload=$InputObject; $global:LASTEXITCODE=0 } }
    & ${quote(path.resolve(__dirname, '../scripts/send-report.ps1'))} -ReportPath ${quote(path.join(dir, 'report.txt'))} -ConfigPath ${quote(path.join(dir, 'config.json'))}
    [Console]::WriteLine($global:CapturedPayload)
  `;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, maxBuffer: 1000000, stdio: ['ignore', 'pipe', 'pipe'] });
  const payload = JSON.parse(output.trim());
  assert.equal(payload.body, body);
  assert.equal(typeof payload.body, 'string');
  assert.equal(payload.password, 'synthetic-secret');
  assert.ok(output.length < 2000);
});
