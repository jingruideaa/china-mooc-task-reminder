const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '../extension');
async function scenario(options = {}) {
  const { loggedOut = false, quizFails = false, examFails = false, withExam = false } = options;
  const state = { ...options.initialState }, visited = [], removed = [], reports = [], alarms = [];
  let now = options.now || Date.parse('2026-10-16T09:00:00+08:00');
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  let url = '', serial = 0;
  const courses = [1, 2, 3].map(n => ({ name: `新课程${n}`, href: `https://www.icourse163.org/learn/TEST-${n}?tid=${n}`, kind: 'MOOC' }));
  const handlers = {};
  const event = name => ({ addListener(handler) { handlers[name] = handler; } });
  const context = vm.createContext({ console, URL, Date: Clock, AbortSignal,
    setTimeout: callback => { callback(); return ++serial; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    fetch: async (url, request) => {
      if (url.endsWith('/hello')) return { ok: true, json: async () => ({ ok: true }) };
      const report = JSON.parse(request.body); reports.push(report);
      if (options.onDeliver) await options.onDeliver(report, state);
      if (options.mailFails) throw new Error('mail offline');
      return { ok: true, json: async () => ({ sent: true }) };
    },
    chrome: {
      runtime: { id: 'test', onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message'), getPlatformInfo: async () => ({}), getURL: p => `chrome-extension://test/${p}`, getManifest: () => ({ version: '0.5.0' }) },
      storage: { local: { set: async v => Object.assign(state, v), get: async () => ({ ...state }), remove: async key => { delete state[key]; }, setAccessLevel: async () => {} } },
      notifications: { create: async () => {} }, alarms: { get: async () => undefined, clear: async () => {}, create: async (...args) => alarms.push(args), onAlarm: event('alarm') },
      tabs: {
        create: async options => { assert.equal(options.active, false); return { id: 555 }; },
        update: async (id, options) => { assert.equal(id, 555); assert.equal(options.active, false); url = options.url; visited.push(url); },
        reload: async id => { assert.equal(id, 555); },
        get: async () => ({ status: 'complete' }), remove: async id => removed.push(id),
        sendMessage: async (_id, message) => {
          if (options.onRead) await options.onRead(message, state, value => { now = value; });
          if (loggedOut) return { loggedOut: true };
          if (message.type === 'ping') return { homeUrl: 'https://www.icourse163.org/home.htm?userId=123' };
          if (message.type === 'dashboard') return { courses: url.includes('spocCourse') ? [] : courses, warnings: [] };
          if (message.type === 'tasks') {
            if (quizFails) throw new Error('Quiz layout unavailable');
            if (options.assignment) return { tasks: [{ ...options.assignment, index: 0 }], hasExamMenu: false };
            return { tasks: [{ name: '新测验', kind: '测验', count: '0/2', deadline: '2026/10/18 23:30' }], hasExamMenu: false };
          }
          if (message.type === 'assignment') return { ...options.assignment, url: url.split('#')[0] + '#/learn/hw?id=111' };
          if (message.type === 'reviewPrepare') return options.prepareResult || { ready: true, signature: 'synthetic-form', total: 20, criteria: 4 };
          if (message.type === 'reviewSubmit') {
            assert.ok(Object.values(state.autoReviewJournal || {}).some(entry => entry.state === 'submitting'));
            if (options.reviewFails) throw new Error('Synthetic ambiguous send');
            options.assignment.selfDone = true;
            return { submitted: true, total: 20, criteria: 4 };
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
  if (options.run !== false) await vm.runInContext('runCheck("scheduled")', context);
  return { state, visited, removed, reports, alarms, handlers, evaluate: code => vm.runInContext(code, context),
    settle: async () => { await new Promise(resolve => setImmediate(resolve)); assert.equal(vm.runInContext('running || mailSending', context), false); } };
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
test('mail retry reuses the saved report without reading courses again', async () => {
  const options = { mailFails: true };
  const result = await scenario(options);
  const savedId = result.state.pendingMail.id;
  const visited = result.visited.length;
  options.mailFails = false;
  assert.equal((await result.evaluate('retryMail()')).sent, true);
  assert.equal(result.reports[1].id, savedId);
  assert.equal(result.visited.length, visited);
  assert.equal(result.state.pendingMail, null);
  assert.equal(result.state.nextMailRetryAt, null);
  assert.equal(result.state.mailState, 'sent');
});
test('reports are persisted before sending and the old pending report survives until scanning finishes', async () => {
  const previous = { id: 'old-report', body: 'Synthetic old report' };
  await scenario({ initialState: { pendingMail: previous }, onRead: (_message, state) => { assert.equal(state.pendingMail.id, previous.id); },
    onDeliver: (report, state) => { assert.equal(state.pendingMail.id, report.id); assert.notEqual(report.id, previous.id); } });
});
test('startup retries interrupted scheduled mail instead of scanning and sending another daily report', async () => {
  const result = await scenario({ run: false, initialState: { installedAt: Date.parse('2026-10-14T10:00:00+08:00'), running: true, checkTabId: 321, mailState: 'sending', pendingMailSlot: '2026-10-15', pendingMail: { id: 'interrupted-report', body: 'Synthetic report' } } });
  await result.evaluate('startup()');
  await result.settle();
  assert.equal(result.state.running, false);
  assert.equal(result.state.checkTabId, undefined);
  assert.equal(result.visited.length, 0);
  assert.deepEqual(result.removed, []);
  await result.evaluate('retryMail()');
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].id, 'interrupted-report');
  assert.equal(result.state.lastScheduledSlot, '2026-10-15');
});
test('a scan crossing 20:00 records the slot captured at its start', async () => {
  const result = await scenario({ now: Date.parse('2026-10-16T19:59:00+08:00'), onRead: (_message, _state, setNow) => setNow(Date.parse('2026-10-16T20:01:00+08:00')) });
  assert.equal(result.state.lastScheduledSlot, '2026-10-15');
});
test('sending an older pending report never moves the completed daily slot backwards', async () => {
  const result = await scenario({ run: false, initialState: { lastScheduledSlot: '2026-10-15', pendingMailSlot: '2026-10-14', pendingMail: { id: 'old-schedule', body: 'Synthetic report' } } });
  await result.evaluate('retryMail()');
  assert.equal(result.state.lastScheduledSlot, '2026-10-15');
});
test('manual and automatic mail retries share a lock and scans cannot start while sending', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const result = await scenario({ run: false, initialState: { pendingMail: { id: 'one-report', body: 'Synthetic report' } }, onDeliver: async () => wait });
  const first = result.evaluate('retryMail()');
  assert.equal((await result.evaluate('retryMail()')).busy, true);
  assert.equal(await result.evaluate('runCheck()'), false);
  release(); await first;
  assert.equal(result.reports.length, 1);
  assert.equal(result.visited.length, 0);
});
test('watchdog catches an overdue daily check and leaves a completed slot quiet', async () => {
  const result = await scenario({ run: false, initialState: { installedAt: Date.parse('2026-10-14T10:00:00+08:00'), lastScheduledSlot: '2026-10-14' } });
  await result.evaluate('recoverState()'); await result.settle();
  assert.equal(result.reports.length, 1);
  assert.equal(result.state.lastScheduledSlot, '2026-10-15');
  await result.evaluate('recoverState()'); await result.settle();
  assert.equal(result.reports.length, 1);
});
const reviewTask = () => ({ name: '示例作业', kind: '作业', taskId: '111', submitted: true, reviewRequired: true, selfRequired: true, peerRequired: true, selfDone: false, peerDone: true, reviewDeadline: '2026/10/18 23:30' });
test('automatic reviews are disabled by default', async () => {
  let prepares = 0;
  const result = await scenario({ assignment: reviewTask(), onRead: message => { if (message.type === 'reviewPrepare') prepares++; } });
  assert.equal(prepares, 0);
  assert.equal(result.state.lastReport.autoReviews.length, 0);
});
test('enabled automatic self review submits once and rereads the website state', async () => {
  const result = await scenario({ assignment: reviewTask(), initialState: { autoReviewEnabled: true } });
  assert.equal(result.state.lastReport.autoReviews.length, 1);
  assert.equal(result.state.lastReport.autoReviews[0].stage, '自评');
  assert.equal(result.state.lastReport.pending.length, 0);
  assert.equal(Object.values(result.state.autoReviewJournal)[0].state, 'confirmed');
});
test('an ambiguous review send stays in the journal and cannot be submitted again', async () => {
  let submits = 0;
  const result = await scenario({ assignment: reviewTask(), initialState: { autoReviewEnabled: true }, reviewFails: true, onRead: message => { if (message.type === 'reviewSubmit') submits++; } });
  assert.equal(result.state.lastReport.autoReviews.length, 0);
  assert.equal(submits, 3);
  await result.evaluate('runCheck()');
  assert.equal(submits, 3);
  assert.match(result.state.lastReport.body, /上次评分提交结果待核实/);
  assert.equal(Object.values(result.state.autoReviewJournal)[0].state, 'submitting');
});
test('an unknown or unavailable review form does not trigger a submission', async () => {
  const result = await scenario({ assignment: reviewTask(), initialState: { autoReviewEnabled: true }, prepareResult: { ready: false, skipped: true, reason: '当前没有可评价的作业' }, onRead: message => { assert.notEqual(message.type, 'reviewSubmit'); } });
  assert.equal(result.state.lastReport.autoReviews.length, 0);
  assert.match(result.state.lastReport.body, /当前没有可评价的作业/);
});
