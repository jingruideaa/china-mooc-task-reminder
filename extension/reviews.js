(function (scope) {
  const text = node => (node?.innerText ?? node?.textContent ?? '').trim();
  const visible = node => !!node && node.getClientRects().length > 0 && node.ownerDocument.defaultView.getComputedStyle(node).visibility !== 'hidden';
  const model = () => scope.MoocModel || require('./model');
  function highest(options) {
    if (!options.length || options.some(o => o.type !== 'radio' || o.disabled || !/^\d+(?:\.\d+)?$/.test(String(o.value)))) throw new Error('评分选项无法确认，未自动提交');
    const max = Math.max(...options.map(o => Number(o.value)));
    const matches = options.map((o, index) => ({ ...o, index })).filter(o => Number(o.value) === max);
    if (matches.length !== 1) throw new Error('最高分选项不唯一，未自动提交');
    return { index: matches[0].index, score: max };
  }
  function allowed(task, stage, now = Date.now()) {
    if (task.kind !== '作业' || task.submitted !== true || !task.reviewRequired) return false;
    if (!['自评', '互评'].includes(stage) || !task[stage === '自评' ? 'selfRequired' : 'peerRequired']) return false;
    if (task[stage === '自评' ? 'selfDone' : 'peerDone'] === true || task.reviewFuture) return false;
    const due = model().timestamp(task.reviewDeadline);
    const start = model().timestamp(task.reviewStart);
    return Number.isFinite(due) && due >= now && (!Number.isFinite(start) || start <= now);
  }
  function stageNode(root, stage) {
    return [...root.querySelectorAll('.jd2 .jdtab')].find(node => visible(node) && text(node).includes(stage) && !text(node).includes('训练'));
  }
  function state(root, stage) {
    const node = stageNode(root, stage);
    if (!node) return null;
    const status = node.querySelector('.j-status')?.className || '';
    if (stage === '自评') return model().phaseDone(status);
    const evidence = model().peerState({ status, text: text(root.querySelector('.m-homework') || root.querySelector('.m-hw') || root.body) });
    return evidence.done === null ? model().phaseDone(status) : evidence.done;
  }
  function form(root) { return [...root.querySelectorAll('.u-homework-evaAction')].find(visible); }
  function success(root) {
    const action = form(root), notice = action?.querySelector('.xlinfo');
    return visible(notice) && /(?:已经|已)提交.*评分|评分提交成功|评价成功|提交成功/.test(text(notice));
  }
  function plan(root) {
    const action = form(root);
    if (!action || success(root)) throw new Error('未找到待提交的评价表单');
    const questions = [...action.querySelectorAll('.u-questionItem.u-analysisQuestion.analysisMode')].filter(visible);
    if (!questions.length) throw new Error('评分题目尚未识别');
    const selections = [];
    for (const question of questions) {
      const groups = [...question.querySelectorAll('.s')].filter(visible);
      if (!groups.length) throw new Error('有题目缺少可识别评分项');
      for (const group of groups) {
        const inputs = [...group.querySelectorAll('input')];
        const choice = highest(inputs.map(input => ({ type: input.type, value: input.value, disabled: input.disabled })));
        selections.push({ input: inputs[choice.index], score: choice.score, group: inputs.map(i => [i.name, i.value]) });
      }
      for (const comment of question.querySelectorAll('textarea')) {
        if (comment.required && !comment.value.trim()) throw new Error('课程要求填写评语，请手动完成此项评价');
      }
    }
    const submit = [...action.querySelectorAll('.bottombtnwrap .j-submitbtn')].find(visible);
    if (!submit || submit.disabled || submit.classList.contains('disabled')) throw new Error('评分提交按钮不可用');
    const signature = JSON.stringify(selections.map(item => [item.group, item.score]));
    return { selections, submit, signature, total: selections.reduce((sum, item) => sum + item.score, 0), questions: questions.length };
  }
  async function prepare(root, task, stage, { until, wait }) {
    if (!allowed(task, stage)) return { ready: false, skipped: true, reason: '评价已完成、未开放或已截止' };
    if (state(root, stage) === true) return { ready: false, done: true };
    if (state(root, stage) !== false) throw new Error('评价完成状态不明确，未自动提交');
    const review = root.querySelector('.jd2');
    if (!review || review.classList.contains('feature') || review.classList.contains('disabled') || stageNode(root, stage)?.classList.contains('disabled')) throw new Error('评价阶段尚未开放');
    if (![...root.querySelectorAll('.jd1 .j-status')].some(n => model().hasClass(n.className, 'done'))) throw new Error('没有确认作业已提交');
    const selector = stage === '自评' ? '.j-selfevabtn' : '.j-evabtn';
    const entry = [...root.querySelectorAll(selector)].find(node => visible(node) && !/^\d+(?:\.\d+)?$/.test(text(node)) && /自评|互评|评分|评价|评阅/.test(text(node)));
    if (!entry) throw new Error('未找到待完成的评价入口');
    entry.click();
    await until(() => form(root) || [...root.querySelectorAll('.j-getnextbtn')].some(visible) || /暂无可(?:评|互评)|没有可(?:评|互评)|暂时没有.*作业/.test(text(root.body)), 12000);
    if (!form(root)) {
      const start = [...root.querySelectorAll('.j-getnextbtn')].find(visible);
      if (!start) return { ready: false, skipped: true, reason: '当前没有可评价的作业' };
      start.click();
      await until(() => form(root), 10000);
    }
    await wait(250);
    const prepared = plan(root);
    for (const item of prepared.selections) {
      item.input.click();
      item.input.dispatchEvent(new root.defaultView.Event('input', { bubbles: true }));
      item.input.dispatchEvent(new root.defaultView.Event('change', { bubbles: true }));
    }
    if (prepared.selections.some(item => !item.input.checked)) throw new Error('最高分选项未全部选中');
    return { ready: true, signature: prepared.signature, total: prepared.total, questions: prepared.questions, criteria: prepared.selections.length };
  }
  async function submit(root, expected, { until }) {
    const prepared = plan(root);
    if (prepared.signature !== expected || prepared.selections.some(item => !item.input.checked)) throw new Error('评价表单已变化，未提交评分');
    prepared.submit.click();
    await until(() => success(root), 15000);
    return { submitted: true, total: prepared.total, questions: prepared.questions, criteria: prepared.selections.length };
  }
  scope.MoocReviews = { highest, allowed, state, plan, prepare, submit };
  if (typeof module !== 'undefined') module.exports = scope.MoocReviews;
})(globalThis);
