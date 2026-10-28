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

/* ---- statuses: items that do not count are left out of every figure, and the scope says so ---- */

const STATUSES = [
  { id: 'p', name: 'รอดำเนินการ', counted: false },
  { id: 'd', name: 'ชำระแล้ว', counted: true },
  { id: 'x', name: 'ยกเลิก', counted: false }
];
const inStatus = (id, extra = {}) => ({ statusId: id, statusName: STATUSES.find((s) => s.id === id).name, counted: STATUSES.find((s) => s.id === id).counted, ...extra });
const computeWith = (items, month = '2026-10', today = '2026-10-25') =>
  gas.invoke('Dashboard.compute', { items, statuses: STATUSES, month, today });

test('items whose status does not count are left out of totals, bars, the trend and last month\'s comparison', () => {
  const d = computeWith([
    item('INCOME', 1000, '2026-10-01', inStatus('d')),
    item('EXPENSE', 400, '2026-10-02', inStatus('d')),
    item('EXPENSE', 300, '2026-10-03', inStatus('p')),
    item('EXPENSE', 200, '2026-10-04', inStatus('x')),
    item('EXPENSE', 500, '2026-09-02', inStatus('d')),
    item('EXPENSE', 9000, '2026-09-03', inStatus('p'))
  ]);
  assert.deepEqual([d.income, d.expense, d.balance, d.count, d.skipped], [1000, 400, 600, 2, 2]);
  assert.deepEqual(d.byCategory.map((r) => r.amount), [400]);
  assert.deepEqual(d.byPerson.map((r) => r.amount), [400]);
  assert.deepEqual(d.trend.slice(-2).map((t) => t.expense), [500, 400]);
  assert.match(d.insight.text, /ต่ำกว่าเดือนก่อน 20%/, 'last month counted 500 (not 9,500)');
});

test('scope names the counted statuses and what the month left out, split into income and expense', () => {
  const d = computeWith([
    item('EXPENSE', 300, '2026-10-03', inStatus('p')),
    item('EXPENSE', 50.5, '2026-10-04', inStatus('p')),
    item('INCOME', 700, '2026-10-05', inStatus('x')),
    item('EXPENSE', 80, '2026-09-05', inStatus('x'))
  ]);
  assert.equal(d.scope.text, 'ยอดสรุปนับเฉพาะรายการที่สถานะ ชำระแล้ว · ไม่รวม 3 รายการในเดือนนี้ (รอดำเนินการ 2, ยกเลิก 1) รายรับ 700 บาท · รายจ่าย 350.50 บาท');
  assert.deepEqual([d.scope.skippedIncome, d.scope.skippedExpense], [700, 350.5]);
  assert.equal(d.insight.text.startsWith('เดือนนี้ มี 3 รายการ แต่ทั้งหมดอยู่ในสถานะที่ไม่นับรวม'), true);
});

test('scope: nothing left out, everything counted, and no statuses at all', () => {
  assert.equal(computeWith([item('EXPENSE', 10, '2026-10-03', inStatus('d'))]).scope.text, 'ยอดสรุปนับเฉพาะรายการที่สถานะ ชำระแล้ว · เดือนนี้ ไม่มีรายการที่ถูกข้าม');
  const all = gas.invoke('Dashboard.compute', { items: [item('EXPENSE', 10, '2026-10-03')], statuses: STATUSES.map((s) => ({ ...s, counted: true })), month: '2026-10', today: '2026-10-25' });
  assert.equal(all.scope.text, 'ยอดสรุปนับรายการทุกสถานะ');
  assert.equal(compute([item('EXPENSE', 10, '2026-10-03')]).scope, null);
  assert.match(computeWith([item('EXPENSE', 1, '2026-08-03', inStatus('x'))], '2026-08').scope.text, /ไม่รวม 1 รายการในเดือน ส\.ค\. 2569 \(ยกเลิก 1\) รายจ่าย 1 บาท/);
});

/* ---- overall: income against expense with every status except cancelled ---- */

const STATUSES3 = [
  { id: 'p', name: 'รอดำเนินการ', counted: false, cancelled: false },
  { id: 'd', name: 'ชำระแล้ว', counted: true, cancelled: false },
  { id: 'x', name: 'ยกเลิก', counted: false, cancelled: true }
];
const ofStatus = (id, extra = {}) => {
  const s = STATUSES3.find((x) => x.id === id);
  return { statusId: id, statusName: s.name, counted: s.counted, cancelled: s.cancelled, ...extra };
};
const overall = (items, month = '2026-10') => gas.invoke('Dashboard.compute', { items, statuses: STATUSES3, month, today: '2026-10-25' }).overall;

test('overall: expense above income is stated plainly, without blame', () => {
  const o = overall([item('INCOME', 1000, '2026-10-01', ofStatus('d')), item('EXPENSE', 1500, '2026-10-02', ofStatus('p'))]);
  assert.equal(o.ratio, 150);
  assert.equal(o.text, 'รายจ่ายเป็น 150% ของรายรับ · รายจ่ายมากกว่ารายรับ 500 บาท');
  assert.deepEqual(o.bars.map((b) => b.pct), [67, 100], 'bars are relative to the bigger side');
});

test('overall: no income yet shows the expense instead of a meaningless percentage', () => {
  const o = overall([item('EXPENSE', 300, '2026-10-02', ofStatus('p')), item('EXPENSE', 50, '2026-10-02', ofStatus('x'))]);
  assert.equal(o.ratio, null);
  assert.equal(o.text, 'ยังไม่มีรายรับในเดือนนี้ มีรายจ่าย 300 บาท');
  assert.deepEqual([o.openCount, o.cancelledCount], [1, 1]);
});

test('overall: the open part of a bar never disappears, and items from other months are ignored', () => {
  const o = overall([
    item('EXPENSE', 100000, '2026-10-02', ofStatus('d')),
    item('EXPENSE', 1, '2026-10-03', ofStatus('p')),
    item('EXPENSE', 7, '2026-11-03', ofStatus('p')),
    item('INCOME', 1, '2026-10-04', ofStatus('p'))
  ]);
  const expense = o.bars[1];
  assert.deepEqual([expense.total, expense.open, expense.donePct], [100001, 1, 98]);
  const income = o.bars[0];
  assert.deepEqual([income.total, income.done, income.donePct, income.pct], [1, 0, 0, 2]);
});

test('overall: callers that do not send counted/cancelled flags get every item counted as done', () => {
  const o = gas.invoke('Dashboard.compute', { items: [item('INCOME', 10, '2026-10-01'), item('EXPENSE', 5, '2026-10-01')], statuses: STATUSES3, month: '2026-10', today: '2026-10-25' }).overall;
  assert.deepEqual([o.income, o.expense, o.openCount, o.cancelledCount, o.ratio], [10, 5, 0, 0, 50]);
});
