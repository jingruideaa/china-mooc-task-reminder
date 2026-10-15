const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../extension/exams');
const M = require('../extension/model');
test('exam schedules include weekday formatted dates and a duration', () => {
  const fields = E.timeFields('开放时间：2026-10-17/周六 08:00 截止时间：2026-10-18/周日 22:00 答题时长：120分钟');
  assert.equal(fields.startTime, '2026-10-17/周六 08:00');
  assert.equal(fields.deadline, '2026-10-18/周日 22:00');
  assert.equal(fields.duration, '120分钟');
  assert.equal(M.timestamp(fields.deadline), Date.parse('2026-10-18T22:00:00+08:00'));
  assert.equal(E.timeFields('考试时间：2026/10/17 08:00~2026/10/18 22:00').deadline, '2026/10/18 22:00');
});
test('submission is complete before grades exist; closed exams stay unknown without submission evidence', () => {
  assert.equal(E.completion({ statusText: '已交卷，待批改' }), true);
  assert.equal(E.completion({ statusText: '未交卷' }), false);
  assert.equal(E.completion({ statusText: '继续考试' }), false);
  assert.equal(E.completion({ statusText: '考试已结束' }), null);
  assert.equal(E.completion({ statusText: '未开始' }), null);
  assert.equal(E.completion({ score: '考试得分：0分' }), true);
});
test('future, open, completed and overdue exams are reported separately', () => {
  const now = Date.parse('2026-10-15T15:00:00+08:00');
  const exam = { course: '课程', kind: '考试', statusText: '未交卷', startTime: '2026/10/01 08:00', deadline: '2026/10/18 23:00' };
  const report = M.makeReport([], [
    { ...exam, name: '尚未开始的考试', startTime: '2026/10/17 08:00' },
    { ...exam, name: '已开放的考试' },
    { ...exam, name: '已交卷的考试', statusText: '已交卷，待批改' },
    { ...exam, name: '已过期的考试', deadline: '2026/10/14 23:00' }
  ], [], now);
  assert.equal(report.exams.length, 4);
  assert.equal(report.examOpeningSoon.length, 1);
  assert.equal(report.examDueSoon.length, 2);
  assert.equal(report.pending.length, 2);
  assert.equal(report.near.length, 1);
  assert.equal(report.pending.find(t => t.name === '已过期的考试').overdue, true);
  assert.match(report.body, /7 天内开放的考试/);
  assert.match(report.body, /尚未开放/);
});
test('unknown submission status is still included among exams approaching their deadline', () => {
  const now = Date.parse('2026-10-15T15:00:00+08:00');
  const report = M.makeReport([], [{ course: '课程', name: '期末考试', kind: '考试', deadline: '2026/10/16 18:00' }], [], now);
  assert.equal(report.uncertain.length, 1);
  assert.equal(report.examDueSoon.length, 1);
  assert.equal(report.pending.length, 0);
});
test('similarly named exams and objective/subjective papers are not collapsed', () => {
  const base = { course: '课程', courseKey: 'course', kind: '考试', name: '期末考试', deadline: '2026/12/16 18:00' };
  const tasks = M.uniqueTasks([{ ...base, taskId: '111', part: '客观题' }, { ...base, taskId: '222', part: '主观题' }]);
  assert.equal(tasks.length, 2);
});
