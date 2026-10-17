(() => {
  const text = node => (node?.innerText || '').trim();
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = node => !!node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  async function until(read, timeout = 18000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = read(); if (value) return value; await wait(250); }
    throw new Error('页面内容没有加载完成，需要稍后重试');
  }
  function loggedOut() {
    return /登录\s*[|｜]\s*注册/.test(text(document.body)) && !document.querySelector('.course-card-wrapper') && !document.querySelector('.m-chapterQuizHwItem');
  }
  function homeUrl() {
    const current = new URL(location.href);
    if (current.pathname === '/home.htm' && current.searchParams.has('userId')) return `${current.origin}/home.htm?userId=${current.searchParams.get('userId')}`;
    return [...document.querySelectorAll('a[href*="home.htm"]')].map(a => a.href).find(h => /[?&]userId=\d+/.test(h))?.split('#')[0] || '';
  }
  function cards() {
    return [...document.querySelectorAll('.course-card-wrapper')].map(card => ({
      name: (card.querySelector('img[alt]')?.alt || text(card.querySelector('.title .text'))).trim(),
      status: text(card.querySelector('.course-status')),
      href: [...card.querySelectorAll('a')].map(a => a.href).find(h => /\/(?:spoc\/)?(?:course|learn)\//.test(h)) || '',
      kind: location.hash.includes('spocCourse') ? 'SPOC' : 'MOOC'
    }));
  }
  function activeCourse(card) {
    if (/已结束|距离开课|即将开始/.test(card.status)) return false;
    if (/学期结束|正在进行|在学|进行中/.test(card.status)) return true;
    return null;
  }
  async function dashboard() {
    await until(() => loggedOut() || cards().length || /暂无课程|还没有(?:参加|加入|学习)|没有符合条件的课程/.test(text(document.body)));
    if (loggedOut()) return { loggedOut: true };
    const courses = [], warnings = [], seen = new Set();
    for (let page = 0; page < 50; page++) {
      const all = cards();
      const signature = all.map(c => c.href + c.name).join('|');
      if (seen.has(signature)) throw new Error('课程分页未成功切换，未能检查所有课程');
      seen.add(signature);
      for (const card of all) {
        const active = activeCourse(card);
        if (active && card.name && card.href) courses.push(card);
        else if (active === null || (active && !card.href)) warnings.push(`${card.name || '一门课程'}：未能识别课程状态或入口`);
      }
      const next = document.querySelector('.ux-pager_btn__next a');
      if (!next || /disable/.test(next.className + ' ' + next.parentElement.className)) return { courses, warnings, homeUrl: homeUrl(), loggedOut: false };
      next.click();
      await until(() => cards().map(c => c.href + c.name).join('|') !== signature);
    }
    throw new Error('课程分页数量超出检查范围');
  }
  async function resolveCourse() {
    await until(() => loggedOut() || /termId\s*[=:]\s*["']?\d+/.test(document.documentElement.outerHTML) || document.querySelector('a[href*="/learn/"]'));
    const link = [...document.querySelectorAll('a[href*="/learn/"]')].map(a => a.href).find(h => h.startsWith(location.origin) && h.includes('tid='));
    const termId = document.documentElement.outerHTML.match(/termId\s*[=:]\s*["']?(\d+)/)?.[1] || '';
    const courseCode = location.pathname.match(/\/(?:course|learn)\/([^/]+)/)?.[1] || '';
    return { loggedOut: loggedOut(), learnUrl: link || (termId && courseCode ? `${location.origin}/learn/${courseCode}?tid=${termId}#/learn/testlist` : '') };
  }
  async function taskList() {
    await until(() => loggedOut() || document.querySelector('.u-quizHwListItem') || /还没有发布(?:测试和作业|考试)|暂无(?:测验|作业|考试)|没有考试/.test(text(document.body)));
    if (loggedOut()) return { loggedOut: true };
    const rows = [...document.querySelectorAll('.u-quizHwListItem')];
    for (const row of rows) {
      // MOOC marks expanded summaries with `down`; its caret class is reversed.
      if (!row.classList.contains('down')) row.querySelector('.j-titleBox')?.click();
    }
    // Expansion only reads submission summaries; it never starts a quiz attempt.
    if (rows.length) await wait(800);
    const sourceHeading = [...document.querySelectorAll('.u-moocbl .j-tips')].find(node => text(node).includes('源课程内容'));
    const sourceRoot = sourceHeading?.parentElement?.nextElementSibling;
    const tasks = rows.map((row, index) => {
      const button = row.querySelector('.j-quizBtn');
      const kind = /作业/.test(text(button)) ? '作业' : location.hash.includes('examlist') ? '考试' : '测验';
      const recordLink = [...row.querySelectorAll('a[href]')].map(a => a.href).find(h => /\/learn\/(?:quizscore|quiz|hw)\?id=\d+/.test(h));
      return { index, name: text(row.querySelector('.j-name')), deadline: text(row.querySelector('.j-submitTime')), kind,
        taskId: recordLink?.match(/[?&]id=(\d+)/)?.[1] || '', inherited: !!sourceRoot?.contains(row),
        count: text(row.querySelector('.j-submitCount')), score: text(row.querySelector('.j-titleBox .j-validScore')),
        reviewDeadline: text(row.querySelector('.j-evalEnd')), reviewStart: text(row.querySelector('.j-evalStart')),
        href: button?.getAttribute('href') && !button.getAttribute('href').startsWith('javascript:') ? button.href : '' };
    }).filter(t => t.name);
    return { loggedOut: false, tasks, hasExamMenu: !!document.querySelector('[id$="/learn/examlist"],a[href*="/learn/examlist"]') };
  }
  async function examList() {
    await until(() => loggedOut() || MoocExams.inspect(document).tasks.length || MoocExams.inspect(document).empty);
    if (loggedOut()) return { loggedOut: true };
    // Exam lists are read without clicking entry, start, or submission controls.
    await wait(900);
    const result = MoocExams.inspect(document);
    return { ...result, loggedOut: false, url: location.href };
  }
  async function assignment(task) {
    const row = [...document.querySelectorAll('.u-quizHwListItem')][task.index];
    if (!row || text(row.querySelector('.j-name')) !== task.name) throw new Error('作业列表发生变化，需要重新检查');
    const button = row.querySelector('a.j-quizBtn');
    if (!button) throw new Error('无法读取作业入口');
    button.click();
    await until(() => loggedOut() || document.querySelector('.jd1'));
    if (loggedOut()) return { loggedOut: true };
    const submission = document.querySelector('.jd1');
    const review = document.querySelector('.jd2');
    const phases = [...document.querySelectorAll('.jd')].map(p => ({ cls: p.className, title: p.querySelector('.j-bar')?.title || '', tabs: [...p.querySelectorAll('.jdtab')].map(t => ({ text: text(t), status: t.querySelector('.j-status')?.className || '', visible: visible(t) })) }));
    const peer = [...(review?.querySelectorAll('.jdtab') || [])].find(t => visible(t) && /互评/.test(text(t)) && !/训练/.test(text(t)));
    const self = [...(review?.querySelectorAll('.jdtab') || [])].find(t => visible(t) && /自评/.test(text(t)));
    const reviewFuture = !!review?.classList.contains('feature');
    const reviewDeadline = (review?.querySelector('.j-bar')?.title || '').split(/~|～/).pop() || task.reviewDeadline;
    const submitted = MoocModel.phaseDone([...submission.querySelectorAll('.j-status')].map(t => t.className).join(' '));
    const selfDone = self ? MoocModel.phaseDone(self.querySelector('.j-status')?.className) : true;
    // A completed status is enough; opening the optional review list is unnecessary.
    let peerEvidence = { text: '', status: peer?.querySelector('.j-status')?.className || '' };
    if (peer && !reviewFuture && !MoocModel.hasClass(peer.className, 'disabled') && !MoocModel.hasClass(peerEvidence.status, 'done')) {
      peer.click();
      await wait(900);
      // View the existing review list without requesting a new review assignment.
      peerEvidence.text = text(document.querySelector('.m-homework') || document.querySelector('.m-hw') || document.querySelector('.g-mn2') || document.querySelector('main') || document.body);
      peerEvidence.status = peer.querySelector('.j-status')?.className || '';
    }
    const peerResult = MoocModel.peerState(peerEvidence);
    return { loggedOut: false, submitted,
      reviewRequired: !!(peer || self), peerRequired: !!peer, selfRequired: !!self, reviewFuture,
      peerDone: peer ? peerResult.done : true, selfDone, reviewDeadline, peerEvidence: peerResult.evidence,
      phases, taskId: location.hash.match(/[?&]id=(\d+)/)?.[1] || task.taskId, url: location.href };
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    (async () => {
      if (message.type === 'ping') return { ok: true, loggedOut: loggedOut(), homeUrl: homeUrl() };
      if (message.type === 'dashboard') return dashboard();
      if (message.type === 'resolve') return resolveCourse();
      if (message.type === 'tasks') return taskList();
      if (message.type === 'exams') return examList();
      if (message.type === 'assignment') return assignment(message.task);
      if (message.type === 'reviewPrepare' || message.type === 'reviewSubmit') {
        if (loggedOut()) return { loggedOut: true };
        if (!/^#\/learn\/hw\?/.test(location.hash)) throw new Error('自动评价仅适用于作业评价页面');
        if (message.type === 'reviewPrepare') return MoocReviews.prepare(document, message.task, message.stage, { until, wait });
        return MoocReviews.submit(document, message.signature, { until });
      }
      throw new Error('未知检查指令');
    })().then(respond).catch(error => respond({ error: error.message }));
    return true;
  });
})();
