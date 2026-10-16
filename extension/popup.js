const $ = selector => document.querySelector(selector);
const run = $('#run'), retry = $('#retry');
let currentReport, filter = 'pending', renderKey = '', refreshing = false, requesting = false;
const chinaTime = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}
function renderTasks() {
  const key = `${currentReport?.id}|${filter}|${Math.floor(Date.now() / 60000)}`;
  if (key === renderKey) return;
  renderKey = key;
  const list = $('#tasks');
  list.replaceChildren();
  if (!currentReport || currentReport.error) return;
  const items = MoocView.items(currentReport, filter);
  if (!items.length) {
    const messages = { pending: '没有已确认的未完成任务。请同时留意“待核实”。', near: '没有已识别的 7 天内到期任务。', exams: '未发现已发布考试。请在完整报告中核对考试页面检查结果。', uncertain: '本次没有待核实项目。' };
    list.append(node('p', 'empty', messages[filter]));
  }
  for (const item of items) {
    const card = node('article', 'task'), head = node('div', 'task-head');
    const title = node('div', 'task-title');
    const href = MoocView.taskLink(item.url);
    if (href) {
      const link = node('a', '', item.name);
      link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.title = '打开 MOOC 页面核对任务'; title.append(link);
    } else title.textContent = item.name || '未命名任务';
    head.append(title, node('span', 'tag', item.stage || '任务'));
    card.append(head);
    if (item.course) card.append(node('p', 'task-course', item.course));
    if (item.detail) card.append(node('p', 'task-detail', item.detail));
    if (!item.done && Number.isFinite(item.dueAt)) {
      const diff = item.dueAt - Date.now();
      card.append(node('p', `deadline${diff < 0 ? ' overdue' : diff <= 86400000 ? ' urgent' : ''}`, `${MoocView.relativeDeadline(item.dueAt)} · ${item.deadline}`));
    } else if (item.deadline) card.append(node('p', 'deadline', `截止：${item.deadline}`));
    list.append(card);
  }
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const state = await chrome.runtime.sendMessage({ type: 'status' });
    if (!state || state.error) throw new Error(state?.error || '后台未返回状态');
    run.disabled = requesting || !!state.running || !!state.mailSending;
    run.textContent = state.running ? '正在检查…' : '立即检查并发邮件';
    retry.hidden = !state.hasPendingMail;
    retry.disabled = requesting || !!state.running || !!state.mailSending;
    retry.textContent = state.mailSending ? '正在发送…' : '重发报告邮件';
    currentReport = state.lastReport;
    $('#status').textContent = state.running ? state.progress || '正在检查…' : currentReport?.error ? '本次检查未能完成，需要处理。' : currentReport ? '上次检查已完成' : '尚未检查，点击下方按钮开始。';
    const error = [currentReport?.error, state.lastError].filter(Boolean);
    $('#error').hidden = !error.length;
    $('#error').textContent = [...new Set(error)].join('\n');
    const valid = !!currentReport && !currentReport.error;
    $('#summary').hidden = $('#filters').hidden = !valid;
    if (valid) {
      for (const [key, value] of Object.entries(MoocView.counts(currentReport))) $(`#count-${key}`).textContent = value;
    }
    const stale = currentReport?.checkedAtMs && Date.now() - currentReport.checkedAtMs >= 86400000;
    $('#snapshot').textContent = currentReport ? `${currentReport.checkedAt}（北京时间）${stale ? ' · 记录已超过 24 小时，建议重新检查' : ' · 检查时记录'}` : '';
    $('#report').textContent = currentReport?.body || '暂无报告';
    $('#copy').disabled = !currentReport?.body;
    $('#mail').textContent = state.mailState === 'sent' ? `报告邮件已发送${state.lastSentAt ? ' · ' + chinaTime(state.lastSentAt) : ''}` : state.mailState === 'sending' ? '报告邮件发送中…' : state.hasPendingMail ? `报告邮件尚未发送${state.nextMailRetryAt ? ' · 自动重试：' + chinaTime(state.nextMailRetryAt) : ''}` : '';
    $('#next').textContent = state.nextCheckAt ? `下次检查：${chinaTime(state.nextCheckAt)}（北京时间）` : '';
    renderTasks();
  } catch (e) {
    $('#status').textContent = `暂时无法读取状态：${e.message}`;
    run.disabled = retry.disabled = requesting;
  } finally { refreshing = false; }
}
async function request(type) {
  if (requesting) return;
  requesting = true; run.disabled = retry.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type });
    if (!result?.started) $('#status').textContent = '已有任务在进行，正在更新状态…';
  } catch (e) { $('#error').hidden = false; $('#error').textContent = `操作未完成：${e.message}`; }
  finally { requesting = false; await refresh(); }
}
run.addEventListener('click', () => { void request('runNow'); });
retry.addEventListener('click', () => { void request('retryMail'); });
$('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(currentReport.body); $('#copy').textContent = '已复制'; }
  catch (_) { $('#copy').textContent = '复制失败，请手动选择报告文字'; }
  setTimeout(() => { $('#copy').textContent = '复制报告'; }, 2500);
});
for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => {
  filter = button.dataset.filter;
  for (const tab of document.querySelectorAll('[data-filter]')) tab.setAttribute('aria-pressed', String(tab === button));
  renderTasks();
});
$('#version').textContent = `v${chrome.runtime.getManifest().version}`;
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
void refresh(); setInterval(() => { if (!document.hidden) void refresh(); }, 2000);
