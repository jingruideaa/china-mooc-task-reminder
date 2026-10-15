const statusNode = document.querySelector('#status');
const run = document.querySelector('#run');
async function refresh() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'status' });
    run.disabled = !!state.running;
    const report = state.lastReport;
    const lines = [];
    if (state.running) lines.push(state.progress || '检查中…');
    if (report) {
      lines.push(`上次检查：${report.checkedAt}`);
      if (report.error) lines.push(report.error);
      else lines.push(`确认未完成 ${report.pending.length} 项；7 天内到期 ${report.near.length} 项；待核实 ${report.uncertain.length + (report.warnings || []).length} 项。`);
      if (report.examChecks) lines.push(`考试页面已确认 ${report.examChecks.filter(c => c.ok).length}/${report.examChecks.length} 门；7 天内开放 ${report.examOpeningSoon?.length || 0} 场，7 天内截止 ${report.examDueSoon?.length || 0} 场。`);
      document.querySelector('#report').textContent = report.body;
    }
    if (state.mailState === 'sent') lines.push('上次报告邮件：发送成功');
    if (state.lastError) lines.push(state.lastError);
    if (!report && !state.running) lines.push('尚未试运行，请点击上方按钮。');
    if (state.nextCheckAt) lines.push(`下次检查：${new Date(state.nextCheckAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）`);
    statusNode.textContent = lines.join('\n');
  } catch (e) { statusNode.textContent = `无法读取扩展状态：${e.message}`; }
}
run.addEventListener('click', async () => { run.disabled = true; await chrome.runtime.sendMessage({ type: 'runNow' }); await refresh(); });
void refresh(); setInterval(refresh, 1500);
