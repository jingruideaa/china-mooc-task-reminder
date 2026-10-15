const fixture = document.querySelector('#fixture');
const checks = [];
function check(name, html, verify) {
  fixture.innerHTML = html;
  for (const button of fixture.querySelectorAll('button,a')) button.addEventListener('click', () => { throw new Error('Exam controls must not be clicked'); });
  const result = MoocExams.inspect(fixture);
  try { verify(result); checks.push({ name, passed: true }); }
  catch (e) { checks.push({ name, passed: false, error: e.message, result }); }
}
function assert(condition, message) { if (!condition) throw new Error(message); }
check('两个区域均为空', '<h2>考试</h2><p>期中/期末考试还未开放</p><h2>新版考试</h2><p>暂无新版考试</p>', r => assert(r.complete && r.empty && r.tasks.length === 0, 'Expected both exam sections empty'));
check('单一区域为空不能代表全部无考试', '<h2>新版考试</h2><p>暂无新版考试</p>', r => assert(!r.complete && !r.empty, 'Must not claim legacy section empty'));
check('旧版空提示不能遮住新版考试', '<p>期中/期末考试还未开放</p><h2>新版考试</h2><article class="paper-item" data-paper-id="123"><h3>期末考试</h3><p>开放时间：2026/10/17 08:00</p><p>截止时间：2026/10/18 22:00</p><span class="paper-status">未交卷</span><button>开始考试</button></article>', r => assert(r.tasks.length === 1 && !r.empty && r.tasks[0].deadline === '2026/10/18 22:00', 'Expected published exam'));
check('已交卷但未出分仍可识别完成', '<div class="u-examListItem"><h4 class="j-name">期中考试</h4><p>开始时间：2026/10/17 08:00</p><p>截止时间：2026/10/18 22:00</p><span class="exam-status">已交卷，待批改</span><button>查看试卷</button></div>', r => assert(r.tasks.length === 1 && MoocExams.completion(r.tasks[0]) === true, 'Expected completed submission'));
check('无关页面不能判断为没有考试', '<h2>课程公告</h2><p>请注意未来发布的考试</p>', r => assert(!r.complete && !r.empty, 'Expected unknown layout'));
check('切换页面时残留的测验不计作考试', '<h2 class="j-moduleName">测验与作业</h2><div class="u-quizHwListItem"><h4 class="j-name">第一单元测试</h4><p>截止时间：2026/10/16 22:00</p></div>', r => assert(!r.complete && !r.empty && r.tasks.length === 0, 'Stale quiz content must not become an exam'));
check('隐藏空提示不能遮住可见考试', '<p hidden>期中/期末考试还未开放</p><h2>新版考试</h2><p hidden>暂无新版考试</p><div class="exam-item"><h3>期中考试</h3><p>开始时间：2026/10/15 08:00</p><p>截止时间：2026/10/16 22:00</p><span class="exam-status">未交卷</span></div>', r => assert(r.tasks.length === 1 && !r.empty, 'Expected visible exam'));
fixture.replaceChildren();
document.querySelector('#results').textContent = JSON.stringify({ passed: checks.filter(t => t.passed).length, total: checks.length, checks }, null, 2);
