'use strict';
const test = require('node:test');
const { seeded, app, assert } = require('./helpers');

const { gas } = app();
const compute = (items, month = '2026-10', today = '2026-10-25') =>
  gas.invoke('Dashboard.compute', { items, month, today });

let n = 0;
const item = (kind, amount, date, extra = {}) => ({
  id: `i${n++}`, kind, amount, date,
  categoryId: 'c1', categoryName: 'อาหาร', ownerId: 'u1', ownerName: 'พ่อ', ...extra
});

test('totals for the month ignore other months', () => {
  const d = compute([
    item('INCOME', 45000, '2026-10-01'),
    item('EXPENSE', 28450.5, '2026-10-10'),
    item('EXPENSE', 999, '2026-09-30'),
    item('INCOME', 1, '2026-11-01')
  ]);
  assert.deepEqual([d.income, d.expense, d.balance, d.count], [45000, 28450.5, 16549.5, 2]);
  assert.equal(d.label, 'ต.ค. 2569');
});

test('spending by category: biggest first, bars relative to the biggest, shares of the total', () => {
  const d = compute([
    item('EXPENSE', 9820, '2026-10-02', { categoryId: 'a', categoryName: 'อาหาร' }),
    item('EXPENSE', 7500, '2026-10-03', { categoryId: 'b', categoryName: 'บ้าน' }),
    item('EXPENSE', 2680, '2026-10-04', { categoryId: 'c', categoryName: 'เดินทาง' }),
    item('EXPENSE', 0.01, '2026-10-05', { categoryId: 'a', categoryName: 'อาหาร' }),
    item('INCOME', 50000, '2026-10-06', { categoryId: 'z', categoryName: 'เงินเดือน' })
  ]);
  assert.deepEqual(d.byCategory.map((r) => [r.name, r.amount, r.pct]), [['อาหาร', 9820.01, 100], ['บ้าน', 7500, 76], ['เดินทาง', 2680, 27]]);
  assert.deepEqual(d.byCategory.map((r) => r.share), [49, 37, 13]);
});

test('more than eight categories: the rest are grouped so the chart stays readable', () => {
  const items = Array.from({ length: 11 }, (_, i) => item('EXPENSE', 100 + i, '2026-10-02', { categoryId: `c${i}`, categoryName: `หมวด ${i}` }));
  const d = compute(items);
  assert.equal(d.byCategory.length, 9);
  const last = d.byCategory[8];
  assert.equal(last.id, null);
  assert.match(last.name, /3 หมวด/);
  assert.equal(last.amount, 100 + 101 + 102);
});

test('spending by person leaves out people who spent nothing', () => {
  const d = compute([
    item('EXPENSE', 300, '2026-10-02', { ownerId: 'u1', ownerName: 'พ่อ' }),
    item('EXPENSE', 100, '2026-10-02', { ownerId: 'u2', ownerName: 'แม่' }),
    item('INCOME', 900, '2026-10-02', { ownerId: 'u3', ownerName: 'ยาย' })
  ]);
  assert.deepEqual(d.byPerson.map((r) => [r.name, r.amount, r.pct]), [['พ่อ', 300, 100], ['แม่', 100, 33]]);
});

test('six-month trend ends at the viewed month and crosses the year boundary', () => {
  const d = compute([
    item('EXPENSE', 100, '2025-11-05'),
    item('EXPENSE', 400, '2026-01-05'),
    item('EXPENSE', 200, '2026-03-31'),
    item('EXPENSE', 50, '2025-10-31')
  ], '2026-03', '2026-03-31');
  assert.deepEqual(d.trend.map((t) => t.month), ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03']);
  assert.deepEqual(d.trend.map((t) => t.expense), [50, 100, 0, 400, 0, 200]);
  assert.deepEqual(d.trend.map((t) => t.pct), [13, 25, 0, 100, 0, 50]);
  assert.deepEqual(d.trend.map((t) => t.current), [false, false, false, false, false, true]);
  assert.equal(d.trend[0].label, 'ต.ค.');
});

test('an empty month encourages the first entry instead of showing zeros as bad news', () => {
  const d = compute([]);
  assert.equal(d.insight.tone, 'neutral');
  assert.match(d.insight.text, /เริ่มบันทึกรายการแรก/);
  assert.deepEqual([d.byCategory, d.byPerson], [[], []]);
  assert.match(compute([], '2026-08').insight.text, /ส.ค. 2569 ไม่มีรายการ/);
});

test('insight: share of income, and lower spending than last month is praised', () => {
  const d = compute([
    item('INCOME', 1000, '2026-10-01'),
    item('EXPENSE', 630, '2026-10-02'),
    item('EXPENSE', 800, '2026-09-02')
  ], '2026-10', '2026-10-30');
  assert.equal(d.insight.tone, 'good');
  assert.equal(d.insight.text, 'ใช้ไป 63% ของรายรับ ต่ำกว่าเดือนก่อน 21% (เทียบวันที่ 1-30 ของทั้งสองเดือน) ทำได้ดีมาก');
});

test('insight: a month in progress is compared with the same days of last month, not the whole of it', () => {
  const items = [
    item('INCOME', 1000, '2026-10-01'),
    item('EXPENSE', 100, '2026-10-02'),
    item('EXPENSE', 100, '2026-09-02'),
    item('EXPENSE', 5000, '2026-09-28')
  ];
  const early = compute(items, '2026-10', '2026-10-10');
  assert.match(early.insight.text, /เท่ากับเดือนก่อน \(เทียบวันที่ 1-10 ของทั้งสองเดือน\)/);
  const finished = compute(items, '2026-10', '2026-11-05');
  assert.match(finished.insight.text, /ต่ำกว่าเดือนก่อน 98%/);
  assert.doesNotMatch(finished.insight.text, /เทียบวันที่/);
});

test('insight: higher spending is stated plainly, without blame', () => {
  const d = compute([item('INCOME', 1000, '2026-10-01'), item('EXPENSE', 600, '2026-10-02'), item('EXPENSE', 300, '2026-09-02')], '2026-10', '2026-10-31');
  assert.equal(d.insight.tone, 'neutral');
  assert.match(d.insight.text, /สูงกว่าเดือนก่อน 100%/);
  assert.doesNotMatch(d.insight.text, /ทำได้ดีมาก|แย่|ผิด|เกิน/);
});

test('insight: spending more than income is described as a plan to make, with the exact gap', () => {
  const d = compute([item('INCOME', 1000, '2026-10-01'), item('EXPENSE', 1500.5, '2026-10-02')]);
  assert.equal(d.insight.tone, 'attention');
  assert.match(d.insight.text, /รายจ่ายมากกว่ารายรับ 500.50 บาท/);
  assert.match(d.insight.text, /วางแผนเดือนถัดไป/);
});

test('insight: with no income recorded, it says so instead of dividing by zero', () => {
  const d = compute([item('EXPENSE', 250, '2026-10-02')]);
  assert.match(d.insight.text, /ใช้ไป 250 บาท และยังไม่มีรายรับ/);
  assert.doesNotMatch(d.insight.text, /Infinity|NaN/);
});

test('the dashboard reaches the screen through the API with the same numbers', () => {
  const a = seeded();
  const save = (extra) => a.ok('item.save', { familyId: a.familyId, name: 'x', date: '2026-10-05', ownerId: a.me.id, view: { familyId: a.familyId }, ...extra }, 'owner@example.com');
  save({ amount: 45000, categoryId: a.cat('รายได้ประจำ').id });
  const { state } = save({ amount: 9820, categoryId: a.cat('อาหาร').id });
  const d = state.family.dashboard;
  assert.deepEqual([d.income, d.expense, d.balance], [45000, 9820, 35180]);
  assert.equal(d.byCategory[0].name, 'อาหาร');
  assert.equal(d.trend.length, 6);
  assert.equal(state.families[0].balance, 35180);
});
