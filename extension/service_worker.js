importScripts('exams.js', 'model.js', 'bridge_config.js');
const ALARM = 'mooc-daily-check';
const RETRY = 'mooc-check-retry';
const BASE = 'https://www.icourse163.org';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let running = false;

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
  if (running) return;
  running = true;
  await chrome.alarms.clear(RETRY);
  await chrome.storage.local.set({ pendingMail: null, pendingMailSlot: null });
  const heartbeat = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
  await chrome.storage.local.set({ running: true, progress: '正在读取在学课程…', lastError: null, runStartedAt: Date.now() });
  let report;
  try { report = await scan(); }
  catch (e) {
    report = { id: `mooc-${Date.now()}`, checkedAt: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }), authRequired: !!e.authRequired, error: e.message,
      body: `中国大学 MOOC 每日检查未完成\n\n${e.message}\n\n本次未能确认任务状态，请勿将其理解为没有未完成任务。` };
  }
  try {
    await chrome.storage.local.set({ lastReport: report, progress: '正在发送邮件…', mailState: 'sending' });
    await deliver(report);
    await chrome.storage.local.set({ mailState: 'sent', lastError: null, lastSentAt: Date.now(), pendingMail: null, pendingMailSlot: null, ...(reason !== 'manual' ? { lastScheduledSlot: MoocModel.lastSlot() } : {}) });
    await notify(report.error ? 'MOOC 检查需要处理' : 'MOOC 每日检查完成', report.error || `未完成 ${report.pending.length} 项，7 天内到期 ${report.near.length} 项，待核实 ${report.uncertain.length + (report.warnings || []).length} 项。邮件已发送。`);
  } catch (e) {
    await chrome.storage.local.set({ mailState: 'failed', pendingMail: report, pendingMailSlot: reason !== 'manual' ? MoocModel.lastSlot() : null, lastError: `邮件未发送：${e.message}` });
    await chrome.alarms.create(RETRY, { delayInMinutes: 5 });
    await notify('MOOC 报告邮件尚未发送', '报告已保存在扩展中，5 分钟后重试邮件发送。');
  } finally {
    clearInterval(heartbeat); running = false;
    await chrome.storage.local.set({ running: false, progress: '', ...(report.error ? { lastCheckError: report.error } : { lastCheckError: null }) });
    await armAlarm();
  }
}
async function armAlarm() {
  await chrome.alarms.create(ALARM, { when: MoocModel.nextRun() });
  await chrome.storage.local.set({ nextCheckAt: MoocModel.nextRun() });
}
async function startup() {
  try {
    await fetch('http://127.0.0.1:8765/hello', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MOOC-Token': MOOC_BRIDGE_TOKEN }, body: JSON.stringify({ extensionId: chrome.runtime.id, version: chrome.runtime.getManifest().version }), signal: AbortSignal.timeout(5000) });
  } catch (_) {}
  const state = await chrome.storage.local.get(['installedAt', 'lastScheduledSlot', 'running', 'checkTabId', 'pendingMail', 'mailState']);
  if (state.mailState === 'sent' && !state.pendingMail) await chrome.storage.local.set({ lastError: null });
  if (state.running && !running) {
    // Tab IDs from a previous browser session cannot prove present ownership.
    await chrome.storage.local.remove('checkTabId');
    await chrome.storage.local.set({ running: false, lastError: '上次检查被浏览器关闭中断，将重新检查。' });
  }
  await armAlarm();
  if (state.pendingMail) await chrome.alarms.create(RETRY, { delayInMinutes: 1 });
  if (state.installedAt && state.lastScheduledSlot !== MoocModel.lastSlot() && Date.parse(MoocModel.lastSlot() + 'T20:00:00+08:00') >= state.installedAt) void runCheck('catchup');
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
  if (alarm.name === RETRY) {
    void (async () => {
      const { pendingMail, pendingMailSlot } = await chrome.storage.local.get(['pendingMail', 'pendingMailSlot']);
      if (!pendingMail) return;
      try {
        await deliver(pendingMail);
        if ((await chrome.storage.local.get('pendingMail')).pendingMail?.id !== pendingMail.id) return;
        await chrome.storage.local.set({ pendingMail: null, pendingMailSlot: null, mailState: 'sent', lastError: null, lastSentAt: Date.now(), ...(pendingMailSlot ? { lastScheduledSlot: pendingMailSlot } : {}) });
      } catch (e) {
        if ((await chrome.storage.local.get('pendingMail')).pendingMail?.id !== pendingMail.id) return;
        await chrome.storage.local.set({ lastError: `邮件重试失败：${e.message}` });
        await chrome.alarms.create(RETRY, { delayInMinutes: 15 });
      }
    })();
  }
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return;
  if (message.type === 'runNow') { void runCheck(); respond({ started: true }); }
  if (message.type === 'status') { chrome.storage.local.get(['lastReport', 'lastError', 'mailState', 'running', 'progress', 'nextCheckAt', 'lastSentAt']).then(respond); return true; }
});
