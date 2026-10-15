const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { version } = require('../package.json');
function createMailBridge({ config, reportDir, sendMail, onStatus = () => {} }) {
  if (!config?.token || typeof sendMail !== 'function') throw new Error('Bridge configuration and a mail sender are required.');
  fs.mkdirSync(reportDir, { recursive: true });
  let busy = false;
  let status = { startedAt: new Date().toISOString(), version };
  const update = extra => { status = { ...status, ...extra }; onStatus(status); };
  const authorized = req => {
    const received = Buffer.from(String(req.headers['x-mooc-token'] || ''));
    const expected = Buffer.from(config.token);
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  };
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    const respond = (code, result) => {
      if (res.destroyed) return;
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(result));
    };
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return respond(403, { error: 'Origin rejected' });
    const port = req.socket.localPort;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return respond(403, { error: 'Host rejected' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-MOOC-Token');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'GET' && req.url === '/health') return respond(200, { ok: true, version });
    if (!authorized(req)) return respond(403, { error: '邮件服务连接配置不匹配' });
    if (req.method === 'GET' && req.url === '/status') return respond(200, status);
    if (req.method !== 'POST' || !['/report', '/hello'].includes(req.url)) return respond(404, { error: 'Unknown endpoint' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return respond(415, { error: 'Expected JSON' });
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > 1000000) req.destroy(); else chunks.push(chunk); });
    req.on('end', async () => {
      let ownsLock = false;
      try {
        let report;
        try { report = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch (_) { return respond(400, { error: 'Invalid JSON' }); }
        if (req.url === '/hello') {
          if (!/^[a-p]{32}$/.test(report.extensionId || '') || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(report.version || '')) return respond(400, { error: 'Invalid extension identity' });
          update({ extensionId: report.extensionId, extensionVersion: report.version, lastSeenAt: new Date().toISOString() });
          return respond(200, { ok: true });
        }
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(report.id || '') || typeof report.body !== 'string' || !report.body.trim() || report.body.length > 300000) return respond(400, { error: '报告内容无效' });
        const stem = path.join(reportDir, `extension-${report.id}`);
        if (fs.existsSync(stem + '.sent.json')) return respond(200, { sent: true, duplicate: true });
        if (busy) return respond(409, { error: '邮件服务正在发送上一份报告，请稍后重试' });
        busy = true; ownsLock = true;
        fs.writeFileSync(stem + '.json', JSON.stringify(report, null, 2), 'utf8');
        fs.writeFileSync(stem + '.txt', report.body, 'utf8');
        await sendMail(stem + '.txt');
        const sentAt = new Date().toISOString();
        fs.writeFileSync(stem + '.sent.json', JSON.stringify({ sentAt }), 'utf8');
        update({ lastSentAt: sentAt, lastReportId: report.id, lastMailError: null });
        respond(200, { sent: true });
      } catch (_) { update({ lastMailError: '邮件发送失败，请检查本地配置与网络' }); respond(500, { error: '邮件发送失败，请检查本地配置与网络' }); }
      finally { if (ownsLock) busy = false; }
    });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}
module.exports = { createMailBridge };
