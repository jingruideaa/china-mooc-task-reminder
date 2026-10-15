(function (scope) {
  const DATE = String.raw`\d{4}[年/.-]\d{1,2}[月/.-]\d{1,2}日?(?:\s*[/（(]?(?:周|星期)[一二三四五六日天][）)]?)?\s+\d{1,2}:\d{2}(?::\d{2})?`;
  const text = node => (node?.innerText ?? node?.textContent ?? '').trim();
  const compact = value => String(value || '').replace(/\s+/g, '');
  function timeFields(value) {
    const read = label => String(value || '').match(new RegExp(`${label}\\s*[：:]?\\s*(${DATE})`))?.[1] || '';
    const range = String(value || '').match(new RegExp(`(${DATE})\\s*[~～至—]\\s*(${DATE})`));
    return {
      startTime: read('(?:考试|答题)?(?:开始|开放)时间') || range?.[1] || '',
      deadline: read('(?:考试|提交|作答)?(?:截止|结束)时间') || range?.[2] || (/无截止时间/.test(value) ? '无截止时间' : ''),
      duration: String(value || '').match(/(?:考试|答题|作答)时长\s*[：:]?\s*(不限时|不限|\d+\s*(?:分钟|小时|分|秒))/)?.[1] || ''
    };
  }
  function completion(task) {
    if (typeof task.submitted === 'boolean') return task.submitted;
    const count = String(task.count || '').match(/(\d+)\s*\/\s*\d+/);
    if (count) return Number(count[1]) > 0;
    const status = compact(task.statusText);
    if (/未(?:完成|提交|交卷|参加)|尚未(?:参加|交卷)|继续(?:考试|答题|作答)|正在(?:考试|答题)|答题中/.test(status)) return false;
    if (/已(?:完成|提交|交卷|参加)|交卷成功|提交成功|待(?:批改|评分|阅卷)/.test(status)) return true;
    if (/^(?:考试|测验)?得分[：:]?\d+(?:\.\d+)?分/.test(compact(task.score))) return true;
    if (/^(?:开始|进入|参加)(?:考试|答题|作答)$/.test(status)) return false;
    return null;
  }
  function inspect(root) {
    const body = text(root.body || root);
    const warnings = [], tasks = [], candidates = new Set();
    const visible = node => !!node && (!node.ownerDocument?.defaultView || node.getClientRects().length > 0) && !node.closest('[hidden],[aria-hidden="true"]');
    const moduleHeading = [...root.querySelectorAll('.j-moduleName')].find(visible);
    if (moduleHeading && text(moduleHeading) !== '考试') return { tasks: [], complete: false, empty: false, warnings: ['页面尚未切换到考试列表'], evidence: { moduleName: text(moduleHeading) } };
    const add = node => { if (node && node !== root && visible(node)) candidates.add(node); };
    root.querySelectorAll('.u-quizHwListItem,.u-examListItem,.m-examListItem,.j-examItem,.exam-item,[data-exam-id],[data-paper-id],[class*="exam" i][class*="item" i],[class*="paper" i][class*="item" i]').forEach(add);
    // Discover newer exam cards from their visible titles and schedule/status.
    for (const heading of root.querySelectorAll('h2,h3,h4,[class*="title" i],[class*="name" i]')) {
      const name = text(heading);
      if (!name || name.length > 180 || /^(?:新版考试|考试|查看帮助)$/.test(name)) continue;
      let parent = heading.parentElement;
      for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
        const value = text(parent);
        if (value.length > 5000 || parent === root) break;
        if (/考试|试卷|客观题|主观题/.test(value) && /开始时间|开放时间|截止时间|结束时间|已交卷|未交卷|已提交|未提交|未参加|待批改/.test(value)) { add(parent); break; }
      }
    }
    const rows = [...candidates].filter(row => ![...candidates].some(other => row !== other && row.contains(other)));
    const sourceHeading = [...root.querySelectorAll('.j-tips')].find(node => text(node).includes('源课程内容'));
    const sourceRoot = sourceHeading?.parentElement?.nextElementSibling;
    for (const row of rows) {
      const value = text(row);
      if (row.matches('.u-quizHwListItem') && !/考试|试卷|客观题|主观题/.test(value)) continue;
      let name = text(row.querySelector('.j-name,.exam-name,.paper-name,h4,h3,h2,[class*="title" i],[class*="name" i]'));
      const actionNodes = [...row.querySelectorAll('a,button,[role="button"]')].filter(visible);
      if (!name) name = value.split('\n').map(v => v.trim()).find(v => v && !/^(?:开始|进入|参加|继续|查看|考试时间|开始时间|结束时间|截止时间|新版考试)/.test(v)) || '';
      if (!name || name.length > 180) { warnings.push('有一条考试记录未能识别名称'); continue; }
      const fields = timeFields(value);
      const explicitDeadline = text(row.querySelector('.j-submitTime,.j-endTime,.exam-deadline'));
      const explicitStart = text(row.querySelector('.j-startTime,.exam-start'));
      const href = actionNodes.map(a => a.getAttribute('href')).find(h => h && !/^javascript:|^#$/.test(h)) || '';
      const part = name.match(/客观题|主观题/)?.[0] || '';
      const statusNodes = row.querySelectorAll('.j-status,.exam-status,.paper-status,[class*="status" i]');
      const statusText = [...statusNodes].map(text).filter(Boolean).join('；') || actionNodes.map(text).filter(v => /已提交|已交卷|待批改|未提交|未交卷|未参加|开始考试|进入考试|参加考试|继续考试|答题中|已完成/.test(v)).join('；') || value.match(/(?:尚未|未|已)(?:完成|提交|交卷|参加)|待批改|答题中|考试已结束|尚未开放|未开始/)?.[0] || '';
      const task = { kind: '考试', name, part, ...fields,
        startTime: explicitStart || fields.startTime,
        deadline: explicitDeadline || fields.deadline,
        count: text(row.querySelector('.j-submitCount')),
        score: text(row.querySelector('.j-validScore,.exam-score,.paper-score')),
        statusText, taskId: row.getAttribute('data-exam-id') || row.getAttribute('data-paper-id') || href.match(/[?&]id=(\d+)/)?.[1] || '',
        inherited: !!sourceRoot?.contains(row), href };
      if (!task.deadline) warnings.push(`${name}：没有读到截止时间`);
      tasks.push(task);
    }
    const legacyEmpty = /期中\s*[/／]\s*期末考试(?:还|尚)?未开放|老师(?:还|尚)?没有发布考试|暂无考试/.test(body);
    const modernEmpty = /暂无新版考试|(?:还|尚)?未发布新版考试/.test(body);
    const hasModern = /新版考试/.test(body);
    // Empty placeholders for one section must not hide exams in another section.
    const empty = !tasks.length && legacyEmpty && (!hasModern || modernEmpty);
    const recognized = tasks.length > 0 || empty;
    if (!recognized) warnings.push('考试页面内容尚未加载或版式未识别，不能确认是否有考试');
    if (tasks.length && hasModern && !modernEmpty && !rows.some(r => /新版考试/.test(text(r.parentElement)))) warnings.push('新版考试区域需要核实');
    return { tasks, complete: recognized && !warnings.length, empty, warnings,
      evidence: { legacyEmpty, modernEmpty, hasModern, rowCount: rows.length } };
  }
  scope.MoocExams = { timeFields, completion, inspect };
  if (typeof module !== 'undefined') module.exports = scope.MoocExams;
})(globalThis);
