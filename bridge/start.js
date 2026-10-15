const fs = require('node:fs');
const path = require('node:path');
const { LOCAL, loadConfig } = require('./config');
const { createMailBridge } = require('./server');
const { sendMail } = require('./mailer');
try {
  const config = loadConfig();
  const server = createMailBridge({ config, reportDir: path.join(LOCAL, 'reports'), sendMail,
    onStatus: status => fs.writeFileSync(path.join(LOCAL, 'bridge-status.json'), JSON.stringify(status, null, 2), 'utf8') });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Port 8765 is occupied. Stop the other MOOC mail bridge before starting this one.' : 'The local mail bridge could not start.'); process.exitCode = 1; });
  server.listen(8765, '127.0.0.1', () => console.log('MOOC mail bridge listening on 127.0.0.1:8765.'));
} catch (error) { console.error(error.message); process.exitCode = 1; }
