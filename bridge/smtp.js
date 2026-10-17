const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');
function mailbox(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)) throw new Error('Invalid mail address');
  return value;
}
function message({ from, to, body, subject = 'MOOC daily report' }) {
  from = mailbox(from); to = to.map(mailbox);
  if (typeof body !== 'string' || typeof subject !== 'string' || /[\r\n]/.test(subject)) throw new Error('Invalid mail content');
  const encoded = Buffer.from(body, 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
  return [`From: <${from}>`, `To: ${to.map(address => '<' + address + '>').join(', ')}`, `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@${from.split('@')[1]}>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encoded, ''].join('\r\n');
}
function replies(socket) {
  let buffer = '', lines = [], failure, waiting;
  const queue = [];
  function flush() {
    if (!waiting) return;
    if (failure) { const next = waiting; waiting = null; next.reject(failure); }
    else if (queue.length) { const next = waiting; waiting = null; next.resolve(queue.shift()); }
  }
  const fail = () => { failure = new Error('SMTP connection closed or failed'); flush(); };
  const data = chunk => {
    buffer += chunk.toString('utf8');
    if (buffer.length > 64000) { fail(); socket.destroy(); return; }
    for (let index; (index = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1);
      const match = line.match(/^(\d{3})([ -])(.*)$/);
      if (!match) { fail(); return; }
      lines.push(line);
      if (match[2] === ' ') { queue.push({ code: Number(match[1]), text: lines.join('\n') }); lines = []; flush(); }
    }
  };
  socket.on('data', data); socket.on('error', fail); socket.on('close', fail);
  return {
    next: () => new Promise((resolve, reject) => { if (waiting) return reject(new Error('Concurrent SMTP reads')); waiting = { resolve, reject }; flush(); }),
    detach: () => { socket.off('data', data); socket.off('error', fail); socket.off('close', fail); }
  };
}
async function sendSmtp({ smtp, password, body, subject }, { connect = options => net.createConnection(options), upgrade = options => tls.connect(options), verifyOnly = false } = {}) {
  if (!smtp?.enableSsl || !password || /[\r\n]/.test(smtp.username || '') || !Array.isArray(smtp.to) || !smtp.to.length) throw new Error('SMTP configuration is incomplete');
  const contents = message({ from: smtp.from, to: smtp.to, body, subject });
  let socket = connect({ host: smtp.host, port: smtp.port, family: 4 }), reader = replies(socket);
  const timer = setTimeout(() => socket.destroy(new Error('SMTP timed out')), 12000);
  const expect = async codes => { const response = await reader.next(); if (!codes.includes(response.code)) throw new Error('SMTP response rejected: ' + response.code); return response; };
  const command = async (line, codes) => { socket.write(line + '\r\n'); return expect(codes); };
  try {
    await expect([220]);
    const greeting = await command('EHLO localhost', [250]);
    if (!/\bSTARTTLS\b/i.test(greeting.text)) throw new Error('SMTP server does not offer TLS');
    await command('STARTTLS', [220]);
    reader.detach();
    socket = upgrade({ socket, servername: smtp.host, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
    reader = replies(socket);
    await new Promise((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject); socket.once('close', () => reject(new Error('TLS connection closed'))); });
    if (!socket.authorized) throw new Error('SMTP certificate verification failed');
    await command('EHLO localhost', [250]);
    await command('AUTH LOGIN', [334]);
    await command(Buffer.from(smtp.username).toString('base64'), [334]);
    await command(Buffer.from(password).toString('base64'), [235]);
    if (verifyOnly) { socket.end('QUIT\r\n'); return { authenticated: true }; }
    await command(`MAIL FROM:<${mailbox(smtp.from)}>`, [250]);
    for (const recipient of smtp.to) await command(`RCPT TO:<${mailbox(recipient)}>`, [250, 251]);
    await command('DATA', [354]);
    socket.write(contents + '.\r\n');
    await expect([250]);
    socket.end('QUIT\r\n');
    return { sent: true };
  } finally { clearTimeout(timer); reader.detach(); socket.destroy(); }
}
module.exports = { message, sendSmtp };
