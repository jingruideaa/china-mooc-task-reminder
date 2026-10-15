const path = require('node:path');
const { spawn } = require('node:child_process');
const { ROOT, LOCAL } = require('./config');
function sendMail(reportPath) {
  if (process.platform !== 'win32') return Promise.reject(new Error('The email bridge currently requires Windows Credential Manager.'));
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts/send-report.ps1'), '-ReportPath', reportPath, '-ConfigPath', path.join(LOCAL, 'config.json')], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('邮件发送超时，请检查网络或 SMTP 设置')); }, 20000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('邮件发送程序无法启动')); });
    // Keep SMTP diagnostic output local; raw server messages may include addresses.
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('邮件发送失败，请检查邮箱配置和 Windows 中保存的授权码')); });
  });
}
module.exports = { sendMail };
