const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../extension/reviews');
const M = require('../extension/model');
const now = Date.parse('2027-04-03T10:00:00+08:00');
const task = { course: '示例课程', kind: '作业', name: '示例作业', submitted: true, reviewRequired: true, selfRequired: true, peerRequired: true, selfDone: false, peerDone: false, reviewDeadline: '2027/04/05 23:00' };
test('highest score is numeric and does not depend on option order', () => {
  const options = ['10', '0', '2'].map(value => ({ type: 'radio', value, disabled: false }));
  assert.deepEqual(R.highest(options), { index: 0, score: 10 });
  assert.deepEqual(R.highest([{ type: 'radio', value: '0' }, { type: 'radio', value: '2.5' }]), { index: 1, score: 2.5 });
});
test('ambiguous, disabled and unrecognized rating controls are not submitted', () => {
  for (const options of [[], [{ type: 'checkbox', value: '10' }], [{ type: 'radio', value: 'id-123' }], [{ type: 'radio', value: '10', disabled: true }], [{ type: 'radio', value: '10' }, { type: 'radio', value: '10' }]]) assert.throws(() => R.highest(options));
});
test('self and peer review eligibility is checked independently', () => {
  assert.equal(R.allowed(task, '自评', now), true);
  assert.equal(R.allowed({ ...task, selfDone: true }, '自评', now), false);
  assert.equal(R.allowed({ ...task, selfDone: true }, '互评', now), true);
  assert.equal(R.allowed({ ...task, peerDone: true }, '互评', now), false);
  assert.equal(R.allowed({ ...task, peerDone: true }, '自评', now), true);
});
test('future, expired, unknown-deadline, unsubmitted work and exams are ineligible', () => {
  for (const change of [{ reviewFuture: true }, { reviewStart: '2027/04/04 10:00' }, { reviewDeadline: '2027/04/01 10:00' }, { reviewDeadline: '' }, { submitted: false }, { submitted: null }, { kind: '考试' }, { reviewRequired: false }]) assert.equal(R.allowed({ ...task, ...change }, '互评', now), false);
});
test('the report records only confirmed automatic submissions and preserves separate stages', () => {
  const report = M.makeReport([], [{ ...task, selfDone: true, peerDone: true, autoReviews: [
    { stage: '自评', submitted: true, total: 20, criteria: 4 },
    { stage: '互评', submitted: true, total: 20, criteria: 4 }
  ] }], [], now);
  assert.equal(report.pending.length, 0);
  assert.deepEqual(report.autoReviews.map(a => a.stage), ['自评', '互评']);
  assert.match(report.body, /本次自动评价/);
  assert.match(report.body, /网站已确认提交/);
});
