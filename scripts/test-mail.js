const crypto = require('node:crypto');
const { loadConfig } = require('../bridge/config');
(async () => {
  const config = loadConfig();
  const response = await fetch('http://127.0.0.1:8765/report', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MOOC-Token': config.token },
    body: JSON.stringify({ id: 'mail-test-' + crypto.randomUUID(), body: '中国大学 MOOC 邮件通道测试\n\n这封邮件只用于确认邮件服务可用，未读取实时课程任务。' }), signal: AbortSignal.timeout(25000)
  });
  const result = await response.json();
  if (!response.ok || !result.sent) throw new Error(result.error || 'Mail service did not confirm delivery to SMTP.');
  console.log('Test email accepted by SMTP. Check your inbox.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
