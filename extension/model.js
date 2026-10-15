(function (scope) {
  const DAY = 86400000;
  const Exams = scope.MoocExams || (typeof require === 'function' ? require('./exams') : null);
  function timestamp(value) {
    const m = String(value || '').match(/(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?(?:\s*[/（(]?(?:周|星期)[一二三四五六日天][）)]?)?\s+(\d{1,2}):(\d{2})/);
    return m ? Date.parse(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}:00+08:00`) : NaN;
  }
  function chinaDate(now = Date.now()) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }
  function nextRun(now = Date.now()) {
    const today = Date.parse(`${chinaDate(now)}T20:00:00+08:00`);
    return today > now ? today : today + DAY;
  }
  function lastSlot(now = Date.now()) { return chinaDate(now >= Date.parse(`${chinaDate(now)}T20:00:00+08:00`) ? now : now - DAY); }
  function hasClass(value, name) { return String(value || '').split(/\s+/).includes(name); }
  function peerState(evidence = {}) {
    const body = String(evidence.text || '').replace(/\s+/g, '');
    // Extra reviews may still be offered after the required quota is met.
    const count = body.match(/已(?:经)?(?:完成|评阅|批改|互评)(\d+)(?:份|个|篇)?[\/／](\d+)/)
      || body.match(/(?:互评|批改)(?:进度|数量|作业)?[：:]?(\d+)\/(\d+)/);
    if (count) return { done: Number(count[1]) >= Number(count[2]), evidence: count[0] };
    const completed = body.match(/已(?:经)?(?:完成|评阅|批改|互评)(\d+)(?:份|个|篇)/);
    const required = body.match(/(?:至少|需(?:要)?|要求)(?:完成|评阅|批改|互评)?(\d+)(?:份|个|篇)/);
    if (completed && required) return { done: Number(completed[1]) >= Number(required[1]), evidence: `${completed[0]}；${required[0]}` };
    if (/(?:尚未|未|没有)(?:完成|参与)(?:本次|要求的|全部)?互评|还(?:需|差)(?:要)?(?:完成|评阅|批改|互评)?[1-9]\d*(?:份|个|篇)/.test(body)) return { done: false, evidence: '页面明确提示尚未达到互评要求' };
    if (/已完成(?:全部|本次|要求的)?互评|互评(?:任务)?已完成|已达到互评要求|(?:已完成|完成了)要求的(?:评阅|批改)/.test(body)) return { done: true, evidence: '页面明确提示互评完成' };
    // MOOC adds a separate done token when the required reviews are complete.
    if (hasClass(evidence.status, 'done')) return { done: true, evidence: '网站互评状态明确标记 done' };
    // An undone icon or the absence of a button does not prove completion.
    return { done: null, evidence: '未读到明确的互评完成记录，需要核实' };
  }
  function quizDone(task) {
    const count = String(task.count || '').match(/(\d+)\s*\/\s*\d+/);
    if (count) return Number(count[1]) > 0;
    if (/(?:测验|考试)得分[：:]\s*\d+(?:\.\d+)?\s*分/.test(task.score || '')) return true;
    return null;
  }
  function uniqueTasks(rawTasks) {
    const tasks = rawTasks.map(t => ({ ...t }));
    const originals = tasks.filter(t => !/\/spoc\//.test(t.courseKey || ''));
    const inheritedGroups = new Map();
    for (const task of tasks.filter(t => t.inherited)) {
      const group = inheritedGroups.get(task.courseKey) || [];
      group.push(task); inheritedGroups.set(task.courseKey, group);
    }
    // Only map an inherited block after a matching task ID proves its source.
    for (const group of inheritedGroups.values()) {
      const candidates = new Set();
      for (const task of group.filter(t => t.taskId)) {
        for (const original of originals) {
          if (original.taskId === task.taskId && original.kind === task.kind && original.deadline === task.deadline) candidates.add(original.courseKey);
        }
      }
      if (candidates.size !== 1) continue;
      const sourceKey = [...candidates][0];
      for (const task of group) {
        const source = originals.find(t => t.courseKey === sourceKey && t.kind === task.kind && t.name === task.name && t.deadline === task.deadline && (!task.taskId || !t.taskId || t.taskId === task.taskId));
        if (source) { task.canonicalCourseKey = sourceKey; task.canonicalCourse = source.course; }
      }
    }
    const grouped = new Map();
    for (const task of tasks) {
      const key = [task.canonicalCourseKey || task.courseKey || task.course, task.kind, task.name, task.deadline, ...(task.kind === '考试' ? [task.taskId || '', task.part || '', task.startTime || ''] : [])].join('|');
      const group = grouped.get(key) || []; group.push(task); grouped.set(key, group);
    }
    return [...grouped.values()].map(group => {
      const first = group.find(t => !t.inherited) || group[0];
      const merged = { ...first, course: first.canonicalCourse || first.course, sources: [...new Set(group.map(t => t.course))] };
      for (const field of ['submitted', 'peerDone', 'selfDone']) {
        const values = new Set(group.map(t => t[field]).filter(v => typeof v === 'boolean'));
        if (values.size > 1) { merged[field] = null; merged.error = '同源任务状态不一致，需要核实'; }
        else if (values.size === 1) merged[field] = [...values][0];
      }
      if (group.length > 1 && first.kind !== '作业' && new Set(group.map(t => t.kind === '考试' ? Exams.completion(t) : quizDone(t)).filter(v => v !== null)).size > 1) merged.error = '同源任务提交记录不一致，需要核实';
      return merged;
    });
  }
  function makeReport(courses, tasks, warnings = [], now = Date.now(), examChecks = []) {
    const rawTasks = tasks;
    tasks = uniqueTasks(tasks);
    const pending = [], uncertain = [], upcoming = [], exams = [];
    const add = (task, stage, done, deadline, future = false) => {
      const dueAt = timestamp(deadline);
      const item = { course: task.course, name: task.name, stage, deadline: deadline || '未读到截止时间', url: task.url || '', dueAt: Number.isFinite(dueAt) ? dueAt : null, overdue: Number.isFinite(dueAt) && dueAt < now };
      if (future) upcoming.push(item);
      else if (done === false) pending.push(item);
      else if (done !== true) uncertain.push(item);
    };
    for (const task of tasks) {
      if (task.error) { uncertain.push({ course: task.course, name: task.name, stage: task.error, deadline: task.deadline || '' }); continue; }
      if (task.kind === '考试') {
        const done = Exams.completion(task), startsAt = timestamp(task.startTime), dueAt = timestamp(task.deadline);
        const future = Number.isFinite(startsAt) && startsAt > now;
        const status = done === true ? '已提交／已完成' : future ? '尚未开放' : done === false ? dueAt < now ? '已逾期，未完成' : '未完成' : '完成状态待核实';
        exams.push({ ...task, done, status, startsAt: Number.isFinite(startsAt) ? startsAt : null, dueAt: Number.isFinite(dueAt) ? dueAt : null,
          opensSoon: done !== true && future && startsAt - now <= 7 * DAY,
          dueSoon: done !== true && Number.isFinite(dueAt) && dueAt >= now && dueAt - now <= 7 * DAY });
        if (!future) add(task, '考试', done, task.deadline);
        continue;
      }
      if (task.kind !== '作业') { add(task, task.kind, quizDone(task), task.deadline); continue; }
      add(task, '作业提交', task.submitted, task.deadline);
      if (task.submitted !== true || !task.reviewRequired) continue;
      if (task.peerRequired) add(task, '互评', task.peerDone, task.reviewDeadline, task.reviewFuture === true);
      if (task.selfRequired) add(task, '自评', task.selfDone, task.reviewDeadline, task.reviewFuture === true);
    }
    const near = pending.filter(t => t.dueAt !== null && t.dueAt >= now && t.dueAt - now <= 7 * DAY);
    const checkedAt = new Date(now).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    const examOpeningSoon = exams.filter(t => t.opensSoon), examDueSoon = exams.filter(t => t.dueSoon);
    const line = t => `- ${t.course}｜${t.name}｜${t.stage}｜${t.deadline}${t.overdue ? '｜已逾期' : ''}`;
    const examLine = t => `- ${t.course}｜${t.name}${t.part && !t.name.includes(t.part) ? '（' + t.part + '）' : ''}｜${t.status}｜开放：${t.startTime || '未读到开放时间'}｜截止：${t.deadline || '未读到截止时间'}${t.duration ? '｜时长：' + t.duration : ''}`;
    const failedExamChecks = examChecks.filter(check => !check.ok);
    const emptyExamSummary = failedExamChecks.length ? '部分课程考试页面未能确认，请查看“需要核实”。' : examChecks.length ? `已检查 ${examChecks.length} 门课程的考试页面，当前未发现已发布考试；页面显示未开放或暂无考试。` : '本次尚未确认考试列表。';
    const body = [
      '中国大学 MOOC 每日任务报告', `检查时间：${checkedAt}（北京时间）`,
      `发现 ${courses.length} 门在学课程：`, ...courses.map(c => `- ${c.kind}：${c.name}`), '',
      '确认未完成：', ...(pending.length ? pending.map(line) : ['无已确认的未完成任务']), '',
      '7 天内到期：', ...(near.length ? near.map(line) : ['无已确认的即将到期任务']), '',
      '考试提醒：', ...(exams.length ? exams.map(examLine) : [emptyExamSummary]),
      '7 天内开放的考试：', ...(examOpeningSoon.length ? examOpeningSoon.map(examLine) : ['无已识别项目']),
      '7 天内截止的未完成考试（含状态待核实）：', ...(examDueSoon.length ? examDueSoon.map(examLine) : ['无已识别项目']), '',
      '需要核实：', ...(uncertain.length ? uncertain.map(line) : warnings.length ? [] : ['无']), ...warnings.map(w => `- ${w}`), '',
      '尚未开放的评价阶段：', ...(upcoming.length ? upcoming.map(line) : ['无']), '',
      `确认未完成 ${pending.length} 项，7 天内到期 ${near.length} 项，待核实 ${uncertain.length + warnings.length} 项。`,
      warnings.length || uncertain.length ? '本次存在未能确认的项目，不能据此认定所有任务均已完成。' : '',
      `共读取 ${rawTasks.length} 条任务记录，合并同源记录后 ${tasks.length} 项。`
    ].join('\n');
    return { id: `mooc-${now}`, checkedAt, courses, tasks, rawTaskCount: rawTasks.length, pending, near, uncertain, upcoming, exams, examChecks, examOpeningSoon, examDueSoon, warnings, body };
  }
  scope.MoocModel = { timestamp, chinaDate, nextRun, lastSlot, hasClass, peerState, quizDone, uniqueTasks, makeReport };
  if (typeof module !== 'undefined') module.exports = scope.MoocModel;
})(globalThis);
