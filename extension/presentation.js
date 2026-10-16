(function (scope) {
  const DAY = 86400000;
  function taskLink(value) {
    try {
      const url = new URL(value);
      return url.origin === 'https://www.icourse163.org' && !url.username && !url.password ? url.href : '';
    } catch (_) { return ''; }
  }
  function relativeDeadline(dueAt, now = Date.now()) {
    if (!Number.isFinite(dueAt)) return '截止时间待核实';
    const diff = dueAt - now;
    if (diff < 0) return `已逾期 ${Math.max(1, Math.ceil(-diff / DAY))} 天`;
    if (diff < 3600000) return `${Math.max(1, Math.ceil(diff / 60000))} 分钟内截止`;
    if (diff <= DAY) return `${Math.ceil(diff / 3600000)} 小时内截止`;
    return `${Math.ceil(diff / DAY)} 天内截止`;
  }
  function counts(report = {}) {
    return {
      pending: report.pending?.length || 0,
      urgent: report.urgent?.length ?? report.near?.filter(t => t.dueAt - report.checkedAtMs <= DAY).length ?? 0,
      near: report.near?.length || 0,
      uncertain: (report.uncertain?.length || 0) + (report.warnings?.length || 0)
    };
  }
  function items(report = {}, filter = 'pending') {
    if (filter === 'exams') return (report.exams || []).map(t => ({ ...t, stage: '考试', detail: `${t.status}｜开放：${t.startTime || '时间待核实'}${t.duration ? '｜时长：' + t.duration : ''}`, done: t.done === true }));
    if (filter === 'uncertain') return [...(report.uncertain || []), ...(report.warnings || []).map(w => ({ name: w, stage: '页面读取需要核实' }))];
    if (filter === 'near') return [...(report.near || []), ...(report.uncertainNear || []).map(t => ({ ...t, detail: '完成状态待核实' }))].sort((a, b) => a.dueAt - b.dueAt);
    return report.pending || [];
  }
  scope.MoocView = { taskLink, relativeDeadline, counts, items };
  if (typeof module !== 'undefined') module.exports = scope.MoocView;
})(globalThis);
