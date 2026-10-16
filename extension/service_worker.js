importScripts('exams.js', 'model.js', 'bridge_config.js');
const ALARM = 'mooc-daily-check';
const RETRY = 'mooc-check-retry';
const WATCH = 'mooc-check-watchdog';
const BASE = 'https://www.icourse163.org';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let running = false;
let mailSending = false;
let recovering;

async function send(tabId, message) {
  const result = await chrome.tabs.sendMessage(tabId, message);
  if (result?.loggedOut) throw Object.assign(new Error('当前 MOOC 登录已失效，请在平时使用的浏览器中登录后重试。'), { authRequired: true });
  if (result?.error) throw new Error(result.error);
  return result;
}
async function navigate(tabId, url) {
  if (new URL(url).origin !== BASE) throw new Error('课程入口不是中国大学 MOOC 页面');
  await chrome.tabs.update(tabId, { url, active: false });
  await sleep(900);
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') {
      try { await sleep(350); return await send(tabId, { type: 'ping' }); }
      catch (e) { if (e.authRequired) throw e; }
    }
    await sleep(300);
  }
  throw new Error('MOOC 页面加载超时');
}
async function deliver(report) {
  const response = await fetch('http://127.0.0.1:8765/report', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MOOC-Token': MOOC_BRIDGE_TOKEN },
    body: JSON.stringify(report), signal: AbortSignal.timeout(25000)
  });
  const result = await response.json();
  if (!response.ok || !result.sent) throw new Error(result.error || '邮件服务未确认发送成功');
  return result;
}
async function notify(title, message) {
  try { await chrome.notifications.create({ type: 'basic', iconUrl: 'icon128.png', title, message }); } catch (_) {}
}
async function scan() {
  // A separate background tab preserves the user's page and login session.
  const created = await chrome.tabs.create({ url: BASE + '/home.htm', active: false });
  const tabId = created.id;
  await chrome.storage.local.set({ checkTabId: tabId });
  const courses = [], tasks = [], warnings = [], examChecks = [];
  try {
    let home = (await navigate(tabId, BASE + '/home.htm')).homeUrl;
    if (!home) home = (await chrome.storage.local.get('homeUrl')).homeUrl || BASE + '/home.htm';
    for (const route of ['course', 'spocCourse']) {
      await navigate(tabId, home + '#/home/' + route);
      const dashboard = await send(tabId, { type: 'dashboard' });
      courses.push(...dashboard.courses);
      warnings.push(...(dashboard.warnings || []));
      if (dashboard.homeUrl) { home = dashboard.homeUrl; await chrome.storage.local.set({ homeUrl: home }); }
    }
    const unique = [...new Map(courses.map(c => [c.href, c])).values()];
    for (let index = 0; index < unique.length; index++) {
      const course = unique[index];
      await chrome.storage.local.set({ progress: `正在检查 ${index + 1}/${unique.length}：${course.name}` });
      try {
        let listUrl;
        if (/\/(?:spoc\/)?learn\//.test(course.href)) listUrl = course.href.split('#')[0] + '#/learn/testlist';
        else if (/\/spoc\/course\//.test(course.href)) listUrl = course.href.replace('/spoc/course/', '/spoc/learn/').split('#')[0] + '#/learn/testlist';
        else {
          await navigate(tabId, course.href);
          const resolved = await send(tabId, { type: 'resolve' });
          if (!resolved.learnUrl) throw new Error('无法识别当前学期的学习入口');
          listUrl = resolved.learnUrl.split('#')[0] + '#/learn/testlist';
        }
        try {
          await navigate(tabId, listUrl);
          const listing = await send(tabId, { type: 'tasks' });
          for (const task of listing.tasks) {
            let detail = {};
            if (task.kind === '作业') {
              try { detail = await send(tabId, { type: 'assignment', task }); }
              catch (e) { if (e.authRequired) throw e; detail = { error: e.message }; }
              await navigate(tabId, listUrl);
              await send(tabId, { type: 'tasks' });
            }
            tasks.push({ ...task, ...detail, course: course.name, courseKey: course.href, url: detail.url || listUrl });
          }
        } catch (e) { if (e.authRequired) throw e; warnings.push(`${course.name}：测验与作业检查不完整（${e.message}）`); }
        // Always check exams, even when the menu is hidden or quiz reading fails.
        const examUrl = listUrl.replace('/learn/testlist', '/learn/examlist');
        try {
          await chrome.storage.local.set({ progress: `正在检查考试 ${index + 1}/${unique.length}：${course.name}` });
          await navigate(tabId, examUrl);
          const exams = await send(tabId, { type: 'exams' });
          tasks.push(...exams.tasks.map(task => ({ ...task, course: course.name, courseKey: course.href, url: examUrl })));
          examChecks.push({ course: course.name, url: examUrl, ok: !!exams.complete, count: exams.tasks.length, evidence: exams.evidence });
          warnings.push(...(exams.warnings || []).map(w => `${course.name}：${w}`));
        } catch (e) {
          if (e.authRequired) throw e;
          examChecks.push({ course: course.name, url: examUrl, ok: false, error: e.message });
          warnings.push(`${course.name}：考试列表未能确认（${e.message}）`);
        }
      } catch (e) {
        if (e.authRequired) throw e;
        examChecks.push({ course: course.name, ok: false, error: e.message });
        warnings.push(`${course.name}：课程入口未能确认，作业和考试均未完整检查（${e.message}）`);
      }
    }
    if (!unique.length && warnings.length) throw new Error('未能确认在学课程列表，不能生成任务完成结论');
    return MoocModel.makeReport(unique, tasks, warnings, Date.now(), examChecks);
  } finally {
    await chrome.tabs.remove(tabId).catch(() => {});
    await chrome.storage.local.remove('checkTabId');
  }
}
async function runCheck(reason = 'manual') {
  if (running || mailSending) return false;
  running = true;
  // Capture the due day before scanning, which can cross the next 20:00 slot.
  const slot = reason === 'manual' ? null : MoocModel.lastSlot();
  const heartbeat = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
  let report;
  try {
    await chrome.alarms.clear(RETRY);
    await chrome.storage.local.set({ running: true, progress: '正在读取在学课程…', runStartedAt: Date.now() });
    try { report = await scan(); }
    catch (e) {
      report = { id: `mooc-${Date.now()}`, checkedAtMs: Date.now(), checkedAt: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }), authRequired: !!e.authRequired, error: e.message,
        body: `中国大学 MOOC 每日检查未完成\n\n${e.message}\n\n本次未能确认任务状态，请勿将其理解为没有未完成任务。` };
    }
    // Save before sending, so a worker restart can retry the same report ID.
    // Keep the previous pending mail until a replacement report is ready.
    await chrome.storage.local.set({ lastReport: report, pendingMail: report, pendingMailSlot: slot, mailRetryAttempts: 0, progress: '正在发送邮件…', lastCheckError: report.error || null });
    await retryMail(true);
  } catch (e) {
    await chrome.storage.local.set({ lastError: `检查未能完成：${e.message}` });
    const { pendingMail } = await chrome.storage.local.get('pendingMail');
    if (pendingMail) await scheduleRetry(5);
  } finally {
    clearInterval(heartbeat); running = false;
    await chrome.storage.local.set({ running: false, progress: '' });
    await armAlarm();
  }
  return true;
}
async function scheduleRetry(minutes) {
  const when = Date.now() + minutes * 60000;
  await chrome.storage.local.set({ nextMailRetryAt: when });
  await chrome.alarms.create(RETRY, { when });
}
async function updateBadge(report) {
  if (!chrome.action) return;
  const count = (report.pending?.length || 0) + (report.uncertain?.length || 0) + (report.warnings?.length || 0);
  try {
    await chrome.action.setBadgeText({ text: report.error ? '!' : count ? String(Math.min(count, 99)) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: report.error || report.urgent?.length ? '#a53030' : '#24644b' });
  } catch (_) {}
}
async function retryMail(duringCheck = false) {
  if (mailSending || (running && !duringCheck)) return { started: false, busy: true };
  mailSending = true;
  let pendingMail, pendingMailSlot, mailRetryAttempts;
  try {
    ({ pendingMail, pendingMailSlot, mailRetryAttempts = 0 } = await chrome.storage.local.get(['pendingMail', 'pendingMailSlot', 'mailRetryAttempts']));
    if (!pendingMail) return { started: false };
    await chrome.alarms.clear(RETRY);
    await chrome.storage.local.set({ mailState: 'sending', nextMailRetryAt: null });
    await deliver(pendingMail);
    const current = await chrome.storage.local.get(['pendingMail', 'lastScheduledSlot']);
    if (current.pendingMail?.id !== pendingMail.id) return { started: true, sent: false };
    // Sending an older saved report must not move the completed day backwards.
    const slot = [current.lastScheduledSlot, pendingMailSlot].filter(Boolean).sort().pop();
    await chrome.storage.local.set({ pendingMail: null, pendingMailSlot: null, mailState: 'sent', lastError: null, lastSentAt: Date.now(), mailRetryAttempts: 0, nextMailRetryAt: null, ...(slot ? { lastScheduledSlot: slot } : {}) });
    await updateBadge(pendingMail);
    await notify(pendingMail.error ? 'MOOC 检查需要处理' : 'MOOC 报告已发送', pendingMail.error || `未完成 ${pendingMail.pending?.length || 0} 项，7 天内到期 ${pendingMail.near?.length || 0} 项。邮件已发送。`);
    return { started: true, sent: true };
  } catch (e) {
    if (pendingMail && (await chrome.storage.local.get('pendingMail')).pendingMail?.id === pendingMail.id) {
      const attempts = mailRetryAttempts + 1;
      const minutes = Math.min(60, attempts === 1 ? 5 : 15 * 2 ** Math.min(attempts - 2, 2));
      await chrome.storage.local.set({ mailState: 'failed', mailRetryAttempts: attempts, lastError: `邮件未发送：${e.message}` });
      await scheduleRetry(minutes);
      await updateBadge(pendingMail);
      if (attempts === 1) await notify('MOOC 报告邮件尚未发送', '报告已保存在扩展中，可点击“重发报告邮件”，也会自动重试。');
    }
    return { started: true, sent: false };
  } finally { mailSending = false; }
}
async function armAlarm() {
  const when = MoocModel.nextRun();
  await chrome.alarms.create(ALARM, { when });
  await chrome.alarms.create(WATCH, { periodInMinutes: 1 });
  await chrome.storage.local.set({ nextCheckAt: when });
}
async function ensureAlarms() {
  const daily = await chrome.alarms.get(ALARM);
  if (!daily) {
    const when = MoocModel.nextRun();
    await chrome.alarms.create(ALARM, { when });
    await chrome.storage.local.set({ nextCheckAt: when });
  }
  if (!await chrome.alarms.get(WATCH)) await chrome.alarms.create(WATCH, { periodInMinutes: 1 });
}
async function recoverState() {
  if (recovering) return recovering;
  recovering = (async () => {
    const state = await chrome.storage.local.get(['installedAt', 'lastScheduledSlot', 'running', 'pendingMail', 'pendingMailSlot', 'nextMailRetryAt']);
    if (state.running && !running) {
      // Old tab IDs cannot prove ownership after a browser restart.
      await chrome.storage.local.remove('checkTabId');
      await chrome.storage.local.set({ running: false, progress: '', lastError: '上次检查被中断，可重新检查；已保存的报告仍会重发。' });
    }
    if (state.pendingMail && !running && !mailSending) {
      const when = Math.max(Date.now() + 1000, state.nextMailRetryAt || Date.now() + 60000);
      await chrome.alarms.create(RETRY, { when });
      await chrome.storage.local.set({ nextMailRetryAt: when });
    }
    const slot = MoocModel.lastSlot();
    if (!running && !mailSending && state.installedAt && state.lastScheduledSlot !== slot && !(state.pendingMail && state.pendingMailSlot === slot) && Date.parse(slot + 'T20:00:00+08:00') >= state.installedAt) void runCheck('catchup');
  })();
  try { await recovering; } finally { recovering = null; }
}
async function startup() {
  try {
    await fetch('http://127.0.0.1:8765/hello', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MOOC-Token': MOOC_BRIDGE_TOKEN }, body: JSON.stringify({ extensionId: chrome.runtime.id, version: chrome.runtime.getManifest().version }), signal: AbortSignal.timeout(5000) });
  } catch (_) {}
  await armAlarm();
  await recoverState();
}
chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    const { installedAt } = await chrome.storage.local.get('installedAt');
    if (!installedAt) await chrome.storage.local.set({ installedAt: Date.now() });
    await startup();
  })();
});
chrome.runtime.onStartup.addListener(() => { void startup(); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) void runCheck('scheduled');
  if (alarm.name === RETRY) void retryMail();
  if (alarm.name === WATCH) void recoverState();
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return;
  if (message.type === 'runNow') { const started = !running && !mailSending; if (started) void runCheck(); respond({ started }); }
  if (message.type === 'retryMail') { retryMail().then(respond); return true; }
  if (message.type === 'status') {
    (async () => {
      await recoverState();
      const { pendingMail, ...state } = await chrome.storage.local.get(['lastReport', 'pendingMail', 'lastError', 'mailState', 'progress', 'nextCheckAt', 'lastSentAt', 'nextMailRetryAt', 'mailRetryAttempts']);
      return { ...state, hasPendingMail: !!pendingMail, running, mailSending };
    })().then(respond).catch(error => respond({ error: error.message })); return true;
  }
});
// Check alarm persistence on every cold worker start without postponing an existing alarm.
void ensureAlarms().catch(() => {});
