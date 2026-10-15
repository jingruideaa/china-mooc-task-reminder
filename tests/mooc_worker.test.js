const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '../extension');
async function scenario({ loggedOut = false, mailFails = false, quizFails = false, examFails = false, withExam = false } = {}) {
  const state = {}, visited = [], removed = [], reports = [], alarms = [];
  let url = '', serial = 0;
  const courses = [1, 2, 3].map(n => ({ name: `新课程${n}`, href: `https://www.icourse163.org/learn/TEST-${n}?tid=${n}`, kind: 'MOOC' }));
  const event = () => ({ addListener() {} });
  const context = vm.createContext({ console, URL, Date, AbortSignal,
    setTimeout: callback => { callback(); return ++serial; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    fetch: async (_url, options) => { reports.push(JSON.parse(options.body)); if (mailFails) throw new Error('mail offline'); return { ok: true, json: async () => ({ sent: true }) }; },
    chrome: {
      runtime: { id: 'test', onInstalled: event(), onStartup: event(), onMessage: event(), getPlatformInfo: async () => ({}), getURL: p => `chrome-extension://test/${p}`, getManifest: () => ({ version: '0.2.0' }) },
      storage: { local: { set: async v => Object.assign(state, v), get: async () => ({ ...state }), remove: async key => { delete state[key]; }, setAccessLevel: async () => {} } },
      notifications: { create: async () => {} }, alarms: { clear: async () => {}, create: async (...args) => alarms.push(args), onAlarm: event() },
      tabs: {
        create: async options => { assert.equal(options.active, false); return { id: 555 }; },
        update: async (id, options) => { assert.equal(id, 555); assert.equal(options.active, false); url = options.url; visited.push(url); },
        reload: async id => { assert.equal(id, 555); },
        get: async () => ({ status: 'complete' }), remove: async id => removed.push(id),
        sendMessage: async (_id, message) => {
          if (loggedOut) return { loggedOut: true };
          if (message.type === 'ping') return { homeUrl: 'https://www.icourse163.org/home.htm?userId=123' };
          if (message.type === 'dashboard') return { courses: url.includes('spocCourse') ? [] : courses, warnings: [] };
          if (message.type === 'tasks') {
            if (quizFails) throw new Error('Quiz layout unavailable');
            return { tasks: [{ name: '新测验', kind: '测验', count: '0/2', deadline: '2026/10/18 23:30' }], hasExamMenu: false };
          }
          if (message.type === 'exams') {
            if (examFails) throw new Error('Exam layout unavailable');
            return { tasks: withExam ? [{ name: '期末考试', kind: '考试', statusText: '未交卷', deadline: '2026/12/18 23:30' }] : [], complete: true, warnings: [], evidence: { legacyEmpty: true, modernEmpty: true } };
          }
          throw new Error('Unexpected message');
        }
      }
    }
  });
  context.importScripts = (...names) => names.forEach(name => vm.runInContext(name === 'bridge_config.js' ? 'const MOOC_BRIDGE_TOKEN = "test-token";' : fs.readFileSync(path.join(root, name), 'utf8'), context));
  vm.runInContext(fs.readFileSync(path.join(root, 'service_worker.js'), 'utf8'), context);
  await vm.runInContext('runCheck("scheduled")', context);
  return { state, visited, removed, reports, alarms };
}
test('discovers all three arbitrary courses and closes only the created tab', async () => {
  const result = await scenario();
  assert.equal(result.state.lastReport.courses.length, 3);
  assert.equal(result.state.lastReport.pending.length, 3);
  assert.deepEqual(result.removed, [555]);
  assert.equal(result.state.mailState, 'sent');
  assert.equal(result.state.lastReport.examChecks.length, 3);
  assert.equal(result.visited.filter(url => url.includes('/learn/examlist')).length, 3);
});
test('exam lists are read even if the quiz page fails and the menu is hidden', async () => {
  const result = await scenario({ quizFails: true, withExam: true });
  assert.equal(result.state.lastReport.exams.length, 3);
  assert.equal(result.state.lastReport.pending.length, 3);
  assert.equal(result.state.lastReport.examChecks.filter(c => c.ok).length, 3);
});
test('exam loading failures remain visible instead of reporting no exams', async () => {
  const result = await scenario({ examFails: true });
  assert.equal(result.state.lastReport.examChecks.filter(c => !c.ok).length, 3);
  assert.match(result.state.lastReport.body, /考试页面未能确认/);
  assert.equal(result.state.lastReport.warnings.length, 3);
});
test('lost login sends a login notice without fabricated incomplete tasks', async () => {
  const result = await scenario({ loggedOut: true });
  assert.equal(result.state.lastReport.authRequired, true);
  assert.equal(result.state.lastReport.pending, undefined);
  assert.equal(result.reports.length, 1);
  assert.deepEqual(result.removed, [555]);
});
test('bridge failure is visible and the saved report is scheduled for retry', async () => {
  const result = await scenario({ mailFails: true });
  assert.equal(result.state.mailState, 'failed');
  assert.ok(result.state.pendingMail);
  assert.match(result.state.lastError, /邮件未发送/);
  assert.ok(result.alarms.some(a => a[0] === 'mooc-check-retry'));
});
