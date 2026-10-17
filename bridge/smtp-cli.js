const { sendSmtp } = require('./smtp');
(async () => {
  const chunks = []; let length = 0;
  for await (const chunk of process.stdin) { length += chunk.length; if (length > 2000000) throw new Error('Mail input is too large'); chunks.push(chunk); }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''));
  try { await sendSmtp(input); console.log('Mail sent successfully.'); }
  finally { input.password = ''; chunks.length = 0; }
})().catch(error => {
  const diagnostic = /^(?:SMTP response rejected: \d{3}|SMTP (?:configuration is incomplete|server does not offer TLS|certificate verification failed|connection closed or failed|timed out)|TLS connection closed|Invalid mail address|Invalid mail content)$/.test(error.message) ? error.message : ['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'].includes(error.code) ? error.code : 'Check SMTP configuration and network.';
  console.error('Mail delivery failed. ' + diagnostic); process.exitCode = 1;
});
