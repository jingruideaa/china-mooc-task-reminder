const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../extension/presentation');
test('task links only open HTTPS MOOC pages without credentials', () => {
  const trusted = 'https://www.icourse163.org/learn/EXAMPLE#/learn/testlist';
  assert.equal(V.taskLink(trusted), trusted);
  const credentials = new URL(trusted);
  credentials.username = 'user'; credentials.password = 'password';
  for (const url of ['javascript:alert(1)', 'https://example.org', 'http://www.icourse163.org', 'https://www.icourse163.org.example.org', credentials.href, '//www.icourse163.org']) assert.equal(V.taskLink(url), '');
});
test('approaching uncertain tasks and page failures remain visible in task filters', () => {
  const report = { near: [{ name: '已确认', dueAt: 20 }], uncertainNear: [{ name: '待核实', dueAt: 10 }], warnings: ['示例课程读取失败'] };
  assert.deepEqual(V.items(report, 'near').map(t => t.name), ['待核实', '已确认']);
  assert.equal(V.items(report, 'uncertain')[0].name, '示例课程读取失败');
  assert.equal(V.counts(report).uncertain, 1);
  assert.equal(V.items({ error: '登录已失效' }).length, 0);
});
test('deadline labels distinguish unknown, overdue, minutes and hours', () => {
  const now = 100000;
  assert.match(V.relativeDeadline(null, now), /待核实/);
  assert.match(V.relativeDeadline(now - 1, now), /已逾期/);
  assert.equal(V.relativeDeadline(now + 15 * 60000, now), '15 分钟内截止');
  assert.equal(V.relativeDeadline(now + 2 * 3600000, now), '2 小时内截止');
});
