const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../extension/model');
test('Beijing 20:00 is independent of computer timezone and handles midnight', () => {
  assert.equal(new Date(M.nextRun(Date.parse('2026-10-15T01:00:00Z'))).toISOString(), '2026-10-15T12:00:00.000Z');
  assert.equal(new Date(M.nextRun(Date.parse('2026-10-15T12:00:00Z'))).toISOString(), '2026-10-16T12:00:00.000Z');
  assert.equal(M.lastSlot(Date.parse('2026-10-15T16:30:00Z')), '2026-10-15');
  assert.equal(M.lastSlot(Date.parse('2026-10-16T01:00:00Z')), '2026-10-15');
});
test('review quota overrides the optional continue-review button', () => {
  assert.equal(M.peerState({ text: '已完成5/5份 继续进行互评' }).done, true);
  assert.equal(M.peerState({ text: '已互评5份，至少互评5份。继续进行互评' }).done, true);
  assert.equal(M.peerState({ text: '已完成3/5份 继续进行互评' }).done, false);
});
test('missing and ambiguous review details remain unknown', () => {
  assert.equal(M.peerState({ text: '' }).done, null);
  assert.equal(M.peerState({ text: '继续进行互评' }).done, null);
  assert.equal(M.peerState({ text: '已完成互评，您可以继续互评' }).done, true);
  assert.equal(M.peerState({ text: '尚未完成互评' }).done, false);
  assert.equal(M.hasClass('status undone', 'done'), false);
  assert.equal(M.peerState({ status: 'status undone done' }).done, true);
  assert.equal(M.peerState({ status: 'status undone' }).done, null);
});
test('inherited tasks merge only after matching IDs establish their source', () => {
  const originals = [{ course: '基础课', courseKey: 'base', kind: '测验', name: '第一周', deadline: '2026/10/18 23:30', taskId: '777', count: '1/2' }, { course: '基础课', courseKey: 'base', kind: '测验', name: '第二周', deadline: '2026/11/01 23:30', count: '0/2' }];
  const inherited = originals.map(t => ({ ...t, course: '学校班级', courseKey: '/spoc/class', inherited: true }));
  assert.equal(M.uniqueTasks([...originals, ...inherited]).length, 2);
  assert.equal(M.uniqueTasks([...originals, ...inherited.map(t => ({ ...t, inherited: false }))]).length, 4);
  assert.equal(M.uniqueTasks([...originals, ...inherited.map(t => ({ ...t, taskId: '' }))]).length, 4);
  const conflict = M.uniqueTasks([...originals, { ...inherited[0], count: '0/2' }]);
  assert.ok(conflict.some(t => t.error));
});
test('zero score can be completed, but a default zero without submissions is not', () => {
  assert.equal(M.quizDone({ count: '1/2', score: '0.00/50.00' }), true);
  assert.equal(M.quizDone({ count: '0/2', score: '0.00/50.00' }), false);
  assert.equal(M.quizDone({ score: '测验得分：0.00分。' }), true);
  assert.equal(M.quizDone({ score: '0.00/50.00' }), null);
});
test('review uses its own deadline and self review is reported separately', () => {
  const now = Date.parse('2026-10-15T01:00:00Z');
  const task = { course: '任意新课程', name: '第二周作业', kind: '作业', deadline: '2026/10/11 23:30', submitted: true, reviewRequired: true, peerRequired: true, selfRequired: true, peerDone: true, selfDone: false, reviewDeadline: '2026/10/18 23:30' };
  const report = M.makeReport([{ name: '任意新课程', kind: 'MOOC' }], [task], [], now);
  assert.equal(report.pending.length, 1);
  assert.equal(report.pending[0].stage, '自评');
  assert.equal(report.pending[0].overdue, false);
  assert.equal(report.near.length, 1);
  assert.equal(M.makeReport([], [{ ...task, selfDone: true }], [], now).pending.length, 0);
});
test('future reviews and failed detail reads do not become incomplete tasks', () => {
  const base = { course: '新课', kind: '作业', submitted: true, reviewRequired: true, peerRequired: true, selfRequired: true, peerDone: null, selfDone: false };
  const report = M.makeReport([], [{ ...base, name: '未来', reviewFuture: true }, { ...base, name: '未知', selfDone: true }, { name: '读取失败', error: '超时' }]);
  assert.equal(report.pending.length, 0);
  assert.equal(report.upcoming.length, 2);
  assert.equal(report.uncertain.length, 2);
  assert.match(report.body, /不能据此认定所有任务均已完成/);
});
