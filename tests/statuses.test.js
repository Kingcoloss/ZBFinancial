'use strict';
const test = require('node:test');
const { seeded, invite, assert } = require('./helpers');

const OWNER = 'owner@example.com';

const status = (a, name, family = a.family) => family.statuses.find((s) => s.name === name);
const itemIn = (state, name) => state.family.items.find((i) => i.name === name);

const addItem = (a, extra = {}, as = OWNER) =>
  a.ok('item.save', {
    familyId: a.familyId, name: 'x', amount: 100, date: '2026-10-20', categoryId: a.cat('อาหาร').id,
    ownerId: a.me.id, view: { familyId: a.familyId }, ...extra
  }, as);

const saveStatus = (a, extra) => a.ok('status.save', { familyId: a.familyId, view: { familyId: a.familyId }, ...extra }, OWNER);

test('a new family starts with รอดำเนินการ, ชำระแล้ว and ยกเลิก; only ชำระแล้ว counts', () => {
  const a = seeded();
  assert.deepEqual(a.family.statuses.map((s) => [s.name, s.counted]), [['รอดำเนินการ', false], ['ชำระแล้ว', true], ['ยกเลิก', false]]);
  assert.equal(a.family.defaultStatusId, status(a, 'ชำระแล้ว').id, 'new items start as paid, which is how people used the app before statuses');
  const rows = a.gas.rawRows('Statuses');
  assert.deepEqual(rows.map((r) => [r.name, r.counted]), [['รอดำเนินการ', 'FALSE'], ['ชำระแล้ว', 'TRUE'], ['ยกเลิก', 'FALSE']]);
});

test('an item takes the default status unless one is chosen, and keeps its status when edited without one', () => {
  const a = seeded();
  const paid = status(a, 'ชำระแล้ว');
  const pending = status(a, 'รอดำเนินการ');
  const plain = addItem(a, { name: 'plain' });
  assert.equal(itemIn(plain.state, 'plain').statusId, paid.id);

  const chosen = addItem(a, { name: 'chosen', statusId: pending.id });
  assert.equal(itemIn(chosen.state, 'chosen').statusId, pending.id);
  assert.equal(itemIn(chosen.state, 'chosen').statusName, 'รอดำเนินการ');
  assert.equal(a.gas.rawRows('Items').find((r) => r.name === 'chosen').statusId, pending.id);

  const edited = a.ok('item.save', {
    familyId: a.familyId, id: chosen.result.id, name: 'chosen', amount: 250, date: '2026-10-20',
    categoryId: a.cat('อาหาร').id, view: { familyId: a.familyId }
  }, OWNER);
  assert.equal(itemIn(edited.state, 'chosen').statusId, pending.id, 'saving without a status leaves it alone');
});

test('a status must belong to the family of the item', () => {
  const a = seeded();
  const other = a.ok('family.save', { name: 'บ้านคุณยาย', view: { familyId: a.familyId } }, OWNER).state.family;
  const foreign = other.statuses[0].id;
  const err = a.fail('item.save', {
    familyId: a.familyId, name: 'x', amount: 1, date: '2026-10-20', categoryId: a.cat('อาหาร').id, ownerId: a.me.id, statusId: foreign
  }, OWNER, 'INVALID');
  assert.equal(err.details.field, 'statusId');
  a.fail('item.save', {
    familyId: a.familyId, name: 'x', amount: 1, date: '2026-10-20', categoryId: a.cat('อาหาร').id, ownerId: a.me.id, statusId: 'nope'
  }, OWNER, 'INVALID');
  assert.equal(a.gas.rawRows('Items').length, 0);
});

test('item.status changes only the status, with the same permission as editing the item', () => {
  const a = seeded();
  const mom = invite(a, 'mom@example.com', 'แม่');
  invite(a, 'yai@example.com', 'ยาย', 'viewer');
  const pending = status(a, 'รอดำเนินการ');
  const paid = status(a, 'ชำระแล้ว');
  const mine = addItem(a, { name: 'mine', statusId: pending.id });
  const moms = addItem(a, { name: 'moms', ownerId: mom, statusId: pending.id });

  const { state } = a.ok('item.status', { familyId: a.familyId, id: mine.result.id, statusId: paid.id, view: { familyId: a.familyId } }, OWNER);
  const row = itemIn(state, 'mine');
  assert.deepEqual([row.statusId, row.amount, row.name], [paid.id, 100, 'mine']);

  a.ok('item.status', { familyId: a.familyId, id: moms.result.id, statusId: paid.id, view: {} }, 'mom@example.com');
  a.fail('item.status', { familyId: a.familyId, id: mine.result.id, statusId: pending.id }, 'mom@example.com', 'FORBIDDEN');
  a.fail('item.status', { familyId: a.familyId, id: moms.result.id, statusId: pending.id }, 'yai@example.com', 'FORBIDDEN');
  a.fail('item.status', { familyId: a.familyId, id: mine.result.id, statusId: 'nope' }, OWNER, 'INVALID');
  a.fail('item.status', { familyId: a.familyId, id: 'missing', statusId: paid.id }, OWNER, 'NOT_FOUND');
});

test('statuses: add, rename, flip counted; names are unique per family ignoring case', () => {
  const a = seeded();
  const { result, state } = saveStatus(a, { name: 'ผ่อนชำระ', counted: 'true' });
  const added = state.family.statuses.find((s) => s.id === result.id);
  assert.deepEqual([added.name, added.counted, added.itemCount], ['ผ่อนชำระ', true, 0]);
  assert.equal(state.family.statuses.length, 4);

  const renamed = saveStatus(a, { id: result.id, name: 'ผ่อนจ่าย', counted: false });
  assert.deepEqual(renamed.state.family.statuses.find((s) => s.id === result.id).counted, false);
  a.fail('status.save', { familyId: a.familyId, name: ' ชำระแล้ว ', counted: 'true' }, OWNER, 'CONFLICT');
  a.fail('status.save', { familyId: a.familyId, name: '', counted: 'true' }, OWNER, 'INVALID');
  a.fail('status.save', { familyId: a.familyId, name: 'x'.repeat(31), counted: 'true' }, OWNER, 'INVALID');
  a.fail('status.save', { familyId: a.familyId, name: 'ใหม่', counted: 'maybe' }, OWNER, 'INVALID');
  a.fail('status.save', { familyId: a.familyId, id: 'nope', name: 'ใหม่', counted: 'true' }, OWNER, 'NOT_FOUND');
});

test('statuses: a family can have at most 12', () => {
  const a = seeded();
  for (let i = 4; i <= 12; i++) saveStatus(a, { name: `สถานะ ${i}`, counted: 'false' });
  const err = a.fail('status.save', { familyId: a.familyId, name: 'เกิน', counted: 'false' }, OWNER, 'CONFLICT');
  assert.match(err.message, /12/);
});

test('statuses: at least one status must keep counting', () => {
  const a = seeded();
  const paid = status(a, 'ชำระแล้ว');
  const err = a.fail('status.save', { familyId: a.familyId, id: paid.id, name: paid.name, counted: 'false' }, OWNER, 'CONFLICT');
  assert.equal(err.details.field, 'counted');
  // once another status counts, the first may stop counting
  const other = saveStatus(a, { name: 'ผ่อนชำระ', counted: 'true' }).result.id;
  saveStatus(a, { id: paid.id, name: paid.name, counted: 'false' });
  const err2 = a.fail('status.save', { familyId: a.familyId, id: other, name: 'ผ่อนชำระ', counted: 'false' }, OWNER, 'CONFLICT');
  assert.equal(err2.details.field, 'counted');
});

test('statuses: deleting one with items asks where to move them, and nothing is lost', () => {
  const a = seeded();
  const pending = status(a, 'รอดำเนินการ');
  const paid = status(a, 'ชำระแล้ว');
  addItem(a, { name: 'a', statusId: pending.id });
  addItem(a, { name: 'b', statusId: pending.id, date: '2026-08-01' });
  addItem(a, { name: 'c', statusId: paid.id });

  const ask = a.fail('status.remove', { familyId: a.familyId, id: pending.id }, OWNER, 'NEEDS_REASSIGN');
  assert.equal(ask.details.count, 2);
  assert.equal(a.gas.rawRows('Statuses').length, 3);
  a.fail('status.remove', { familyId: a.familyId, id: pending.id, moveToId: pending.id }, OWNER, 'INVALID');
  a.fail('status.remove', { familyId: a.familyId, id: pending.id, moveToId: 'nope' }, OWNER, 'INVALID');

  const { result, state } = a.ok('status.remove', { familyId: a.familyId, id: pending.id, moveToId: paid.id, view: { familyId: a.familyId } }, OWNER);
  assert.equal(result.moved, 2);
  assert.ok(!state.family.statuses.some((s) => s.id === pending.id));
  assert.deepEqual(a.gas.rawRows('Items').map((r) => [r.name, r.statusId]), [['a', paid.id], ['b', paid.id], ['c', paid.id]]);
});

test('statuses: an unused one is simply deleted; the last one, and the last that counts, cannot be', () => {
  const a = seeded();
  const cancelled = status(a, 'ยกเลิก');
  const pending = status(a, 'รอดำเนินการ');
  const paid = status(a, 'ชำระแล้ว');
  a.ok('status.remove', { familyId: a.familyId, id: cancelled.id, view: { familyId: a.familyId } }, OWNER);

  const last = a.fail('status.remove', { familyId: a.familyId, id: paid.id }, OWNER, 'CONFLICT');
  assert.match(last.message, /นับรวม/);
  a.ok('status.remove', { familyId: a.familyId, id: pending.id, view: { familyId: a.familyId } }, OWNER);
  const only = a.fail('status.remove', { familyId: a.familyId, id: paid.id }, OWNER, 'CONFLICT');
  assert.match(only.message, /อย่างน้อย 1 สถานะ/);
  assert.equal(a.gas.rawRows('Statuses').length, 1);
});

test('only admins manage statuses, but everyone in the family sees them', () => {
  const a = seeded();
  invite(a, 'mom@example.com', 'แม่');
  invite(a, 'yai@example.com', 'ยาย', 'viewer');
  const pending = status(a, 'รอดำเนินการ');
  for (const who of ['mom@example.com', 'yai@example.com']) {
    a.fail('status.save', { familyId: a.familyId, name: 'ใหม่', counted: 'true' }, who, 'FORBIDDEN');
    a.fail('status.save', { familyId: a.familyId, id: pending.id, name: 'x', counted: 'false' }, who, 'FORBIDDEN');
    a.fail('status.remove', { familyId: a.familyId, id: pending.id }, who, 'FORBIDDEN');
    assert.equal(a.ok('state', {}, who).state.family.statuses.length, 3);
  }
  a.fail('status.save', { familyId: a.familyId, name: 'ใหม่', counted: 'true' }, 'stranger@example.com', 'NOT_INVITED');
});

test('statuses of one family are invisible to, and unusable by, another family', () => {
  const a = seeded();
  const other = a.ok('family.save', { name: 'บ้านคุณยาย', view: { familyId: a.familyId } }, OWNER).state.family;
  assert.equal(other.statuses.length, 3);
  assert.notEqual(other.statuses[0].id, a.family.statuses[0].id);
  a.fail('status.remove', { familyId: other.id, id: a.family.statuses[0].id }, OWNER, 'NOT_FOUND');
  a.fail('status.save', { familyId: other.id, id: a.family.statuses[0].id, name: 'x', counted: 'true' }, OWNER, 'NOT_FOUND');
  assert.equal(a.gas.rawRows('Statuses').length, 6);
});

test('deleting a family deletes its statuses too', () => {
  const a = seeded();
  const other = a.ok('family.save', { name: 'บ้านคุณยาย', view: { familyId: a.familyId } }, OWNER).state.family;
  a.ok('family.remove', { id: other.id, force: true, view: { familyId: a.familyId } }, OWNER);
  assert.deepEqual([...new Set(a.gas.rawRows('Statuses').map((r) => r.familyId))], [a.familyId]);
});

test('status counts per month and in total are reported for the management screen', () => {
  const a = seeded();
  const pending = status(a, 'รอดำเนินการ');
  addItem(a, { statusId: pending.id });
  addItem(a, { statusId: pending.id, date: '2026-09-02' });
  const { state } = a.ok('state', {}, OWNER);
  const row = state.family.statuses.find((s) => s.id === pending.id);
  assert.deepEqual([row.monthItems, row.itemCount], [1, 2]);
});

/* ---------- what the dashboard counts ---------- */

test('dashboard, family balance and per-person spend count only statuses that count', () => {
  const a = seeded();
  const pending = status(a, 'รอดำเนินการ');
  const cancelled = status(a, 'ยกเลิก');
  addItem(a, { name: 'paid', amount: 1000 });
  addItem(a, { name: 'later', amount: 400, statusId: pending.id });
  addItem(a, { name: 'dropped', amount: 250, statusId: cancelled.id });
  addItem(a, { name: 'salary', amount: 5000, categoryId: a.cat('รายได้ประจำ').id });
  addItem(a, { name: 'owed to us', amount: 700, categoryId: a.cat('รายได้เสริม').id, statusId: pending.id });

  const { state } = a.ok('state', {}, OWNER);
  const db = state.family.dashboard;
  assert.deepEqual([db.income, db.expense, db.balance, db.count, db.skipped], [5000, 1000, 4000, 2, 3]);
  assert.deepEqual(db.byCategory.map((r) => [r.name, r.amount]), [['อาหาร', 1000]]);
  assert.equal(state.families[0].balance, 4000);
  assert.equal(state.family.members.find((m) => m.isMe).expense, 1000);
  assert.equal(state.family.items.length, 5, 'the list still shows every item');
  assert.equal(state.family.categories.find((c) => c.name === 'อาหาร').monthItems, 3, 'category item counts are about items, not money');
  assert.equal(db.trend.find((t) => t.current).expense, 1000);
});

test('the dashboard states which statuses it counts and what it left out', () => {
  const a = seeded();
  const pending = status(a, 'รอดำเนินการ');
  const cancelled = status(a, 'ยกเลิก');
  assert.equal(a.ok('state', {}, OWNER).state.family.dashboard.scope.text, 'ยอดสรุปนับเฉพาะรายการที่สถานะ ชำระแล้ว · เดือนนี้ ไม่มีรายการที่ถูกข้าม');

  addItem(a, { name: 'later', amount: 400, statusId: pending.id });
  addItem(a, { name: 'later 2', amount: 100, statusId: pending.id });
  addItem(a, { name: 'dropped', amount: 250, statusId: cancelled.id });
  addItem(a, { name: 'owed', amount: 700, categoryId: a.cat('รายได้เสริม').id, statusId: pending.id });
  const scope = a.ok('state', {}, OWNER).state.family.dashboard.scope;
  assert.equal(
    scope.text,
    'ยอดสรุปนับเฉพาะรายการที่สถานะ ชำระแล้ว · ไม่รวม 4 รายการในเดือนนี้ (รอดำเนินการ 3, ยกเลิก 1) รายรับ 700 บาท · รายจ่าย 750 บาท'
  );
  assert.deepEqual([scope.skipped, scope.skippedIncome, scope.skippedExpense, scope.allCounted], [4, 700, 750, false]);
  assert.deepEqual(scope.byStatus.map((b) => [b.name, b.count]), [['รอดำเนินการ', 3], ['ยกเลิก', 1]]);

  // a past month is named as such, and items in other months are not mixed in
  addItem(a, { name: 'old', amount: 10, date: '2026-08-05', statusId: cancelled.id });
  const aug = a.ok('state', { view: { familyId: a.familyId, month: '2026-08' } }, OWNER).state.family.dashboard.scope.text;
  assert.match(aug, /ไม่รวม 1 รายการในเดือน ส\.ค\. 2569 \(ยกเลิก 1\) รายจ่าย 10 บาท/);
});

test('when every status counts the dashboard says it counts all of them', () => {
  const a = seeded();
  for (const name of ['รอดำเนินการ', 'ยกเลิก']) {
    const s = status(a, name);
    saveStatus(a, { id: s.id, name: s.name, counted: 'true' });
  }
  const scope = a.ok('state', {}, OWNER).state.family.dashboard.scope;
  assert.equal(scope.text, 'ยอดสรุปนับรายการทุกสถานะ');
  assert.equal(scope.allCounted, true);
});

test('changing whether a status counts changes the totals straight away', () => {
  const a = seeded();
  const pending = status(a, 'รอดำเนินการ');
  addItem(a, { name: 'later', amount: 400, statusId: pending.id });
  assert.equal(a.ok('state', {}, OWNER).state.family.dashboard.expense, 0);
  const { state } = saveStatus(a, { id: pending.id, name: pending.name, counted: 'true' });
  assert.equal(state.family.dashboard.expense, 400);
  assert.equal(state.family.dashboard.skipped, 0);
});

test('marking a pending item as paid moves it into the totals', () => {
  const a = seeded();
  const id = addItem(a, { name: 'bill', amount: 900, statusId: status(a, 'รอดำเนินการ').id }).result.id;
  const before = a.ok('state', {}, OWNER).state.family.dashboard;
  assert.deepEqual([before.expense, before.skipped], [0, 1]);
  const after = a.ok('item.status', { familyId: a.familyId, id, statusId: status(a, 'ชำระแล้ว').id, view: { familyId: a.familyId } }, OWNER).state.family.dashboard;
  assert.deepEqual([after.expense, after.skipped], [900, 0]);
});

test('a month where every item is left out says so instead of "no items"', () => {
  const a = seeded();
  addItem(a, { statusId: status(a, 'รอดำเนินการ').id });
  const insight = a.ok('state', {}, OWNER).state.family.dashboard.insight.text;
  assert.match(insight, /เดือนนี้ มี 1 รายการ แต่ทั้งหมดอยู่ในสถานะที่ไม่นับรวม/);
});

/* ---------- sheets written by hand, and sheets from before statuses ---------- */

test('an item whose status cell was blanked or points nowhere is treated as the default status', () => {
  const a = seeded();
  addItem(a, { name: 'blank', amount: 300 });
  addItem(a, { name: 'ghost', amount: 200 });
  const sheet = a.gas.spreadsheet().getSheetByName('Items');
  sheet.getRange(2, 10, 1, 1).setValues([['']]);
  sheet.getRange(3, 10, 1, 1).setValues([['s_deleted']]);
  const { state } = a.ok('state', {}, OWNER);
  const paid = status(a, 'ชำระแล้ว');
  assert.deepEqual(state.family.items.map((i) => [i.statusId, i.counted]).sort(), [[paid.id, true], [paid.id, true]]);
  assert.equal(state.family.dashboard.expense, 500);

  // editing such an item stores a real status
  a.ok('item.save', {
    familyId: a.familyId, id: state.family.items[0].id, name: 'fixed', amount: 1, date: '2026-10-20', categoryId: a.cat('อาหาร').id, view: {}
  }, OWNER);
  assert.ok(a.gas.rawRows('Items').some((r) => r.name === 'fixed' && r.statusId === paid.id));
});

test('a status row typed by hand (yes / true / 1) is understood', () => {
  const a = seeded();
  const sheet = a.gas.spreadsheet().getSheetByName('Statuses');
  sheet.getRange(2, 4, 1, 1).setValues([['yes']]);
  sheet.getRange(4, 4, 1, 1).setValues([['no']]);
  const { state } = a.ok('state', {}, OWNER);
  assert.deepEqual(state.family.statuses.map((s) => s.counted), [true, true, false]);
});

test('a family left with no statuses still shows its items, and saving an item restores the starter set', () => {
  const a = seeded();
  addItem(a, { name: 'kept', amount: 120 });
  a.gas.run("Db.reset(); Db.withLock(function () { Db.table('Statuses').removeWhere(function () { return true; }); })");
  const state = a.ok('state', {}, OWNER).state;
  assert.deepEqual(state.family.statuses, []);
  assert.equal(state.family.dashboard.expense, 120, 'nothing is hidden because the statuses are gone');
  assert.equal(state.family.dashboard.scope, null);

  const saved = addItem(a, { name: 'new', amount: 30 });
  assert.equal(saved.state.family.statuses.length, 3);
  assert.equal(itemIn(saved.state, 'new').statusId, saved.state.family.defaultStatusId);
});

/** Turns a current workbook into what version 1 left behind: no Statuses tab, no statusId column. */
function downgrade(a) {
  const ss = a.gas.spreadsheet();
  ss.deleteSheet(ss.getSheetByName('Statuses'));
  const items = ss.getSheetByName('Items');
  for (let r = 1; r <= items.getLastRow(); r++) {
    items.grid.delete(`${r}:10`);
    items.formatOf.delete(`${r}:10`);
  }
}

test('a workbook from before statuses is upgraded on first use: every item becomes ชำระแล้ว and no number changes', () => {
  const a = seeded();
  const second = a.ok('family.save', { name: 'บ้านคุณยาย', view: { familyId: a.familyId } }, OWNER).state.family;
  addItem(a, { name: 'salary', amount: 30000, categoryId: a.cat('รายได้ประจำ').id });
  addItem(a, { name: 'lunch', amount: 120 });
  addItem(a, { name: 'last month', amount: 80, date: '2026-09-10' });
  a.ok('item.save', {
    familyId: second.id, name: 'grandma', amount: 55, date: '2026-10-21', ownerId: a.me.id,
    categoryId: second.categories.find((c) => c.name === 'อาหาร').id, view: { familyId: second.id }
  }, OWNER);
  const wanted = a.ok('state', { view: { familyId: a.familyId } }, OWNER).state;
  const wantedItems = a.gas.rawRows('Items').map((r) => ({ ...r, statusId: undefined }));

  downgrade(a);
  assert.equal(a.gas.spreadsheet().getSheetByName('Statuses'), null);
  assert.equal(a.gas.spreadsheet().getSheetByName('Items').getRange(1, 10, 1, 1).getValues()[0][0], '');

  const got = a.ok('state', { view: { familyId: a.familyId } }, OWNER).state;
  assert.deepEqual(got.family.dashboard.income, wanted.family.dashboard.income);
  assert.deepEqual(got.family.dashboard.expense, wanted.family.dashboard.expense);
  assert.deepEqual(got.family.dashboard.trend, wanted.family.dashboard.trend);
  assert.deepEqual(got.families.map((f) => f.balance), wanted.families.map((f) => f.balance));
  assert.equal(got.family.dashboard.skipped, 0);

  // both families got their own starter statuses and each item points at its own family's ชำระแล้ว
  const statuses = a.gas.rawRows('Statuses');
  assert.equal(statuses.length, 6);
  const paidOf = Object.fromEntries(statuses.filter((s) => s.name === 'ชำระแล้ว').map((s) => [s.familyId, s.id]));
  const rows = a.gas.rawRows('Items');
  assert.equal(rows.length, 4);
  rows.forEach((r) => assert.equal(r.statusId, paidOf[r.familyId], r.name));
  assert.deepEqual(rows.map((r) => ({ ...r, statusId: undefined })), wantedItems, 'no other column was touched');
  assert.equal(a.gas.spreadsheet().getSheetByName('Items').getRange(1, 10, 1, 1).getValues()[0][0], 'statusId');
});

test('the upgrade runs once: later requests change nothing, and a second run would not duplicate statuses', () => {
  const a = seeded();
  addItem(a);
  downgrade(a);
  a.ok('state', {}, OWNER);
  const sheet = a.gas.spreadsheet().getSheetByName('Items');
  const writes = sheet.writes;
  const statuses = a.gas.rawRows('Statuses');
  a.ok('state', {}, OWNER);
  a.ok('state', {}, OWNER);
  assert.equal(sheet.writes, writes, 'reading after the upgrade writes nothing');
  assert.deepEqual(a.gas.rawRows('Statuses'), statuses);

  // stopped after the header but before the values: blank cells read as the default, nothing breaks
  const paid = a.gas.rawRows('Statuses').find((r) => r.name === 'ชำระแล้ว').id;
  for (let r = 2; r <= sheet.getLastRow(); r++) sheet.grid.delete(`${r}:10`);
  const half = a.ok('state', {}, OWNER).state;
  assert.equal(half.family.items[0].statusId, paid);
  assert.equal(half.family.dashboard.expense, 100);

  // stopped after the statuses were created but before the header: the upgrade repeats without duplicates
  sheet.grid.delete('1:10');
  a.ok('state', {}, OWNER);
  assert.equal(a.gas.rawRows('Statuses').length, 3, 'statuses are not seeded twice');
  assert.equal(sheet.getRange(1, 10, 1, 1).getValues()[0][0], 'statusId');
  assert.equal(a.gas.rawRows('Items')[0].statusId, paid);
});

test('an old workbook with no items yet is upgraded too', () => {
  const a = seeded();
  downgrade(a);
  const { state } = a.ok('state', {}, OWNER);
  assert.equal(state.family.statuses.length, 3);
  assert.equal(a.gas.spreadsheet().getSheetByName('Items').getRange(1, 10, 1, 1).getValues()[0][0], 'statusId');
  addItem(a, { name: 'first' });
  assert.equal(a.gas.rawRows('Items')[0].statusId, state.family.defaultStatusId);
});

test('an old Items tab that has been trimmed to nine columns gets its tenth', () => {
  const a = seeded();
  addItem(a);
  downgrade(a);
  const sheet = a.gas.spreadsheet().getSheetByName('Items');
  sheet.maxColumns = 9;
  a.ok('state', {}, OWNER);
  assert.ok(sheet.getMaxColumns() >= 10);
  assert.equal(a.gas.rawRows('Items')[0].statusId.startsWith('s_'), true);
});

test('setup() upgrades an old workbook, and puts statuses back for a family that has none', () => {
  const a = seeded();
  addItem(a);
  downgrade(a);
  const summary = a.gas.invoke('setup');
  assert.ok(summary.tabs.includes('Statuses'));
  assert.equal(a.gas.rawRows('Statuses').length, 3);

  a.gas.run("Db.reset(); Db.withLock(function () { Db.table('Statuses').removeWhere(function () { return true; }); })");
  a.gas.invoke('setup');
  assert.equal(a.gas.rawRows('Statuses').length, 3);
});

test('a column someone added in the spot statusId needs is reported with what to do, and nothing is overwritten', () => {
  const a = seeded();
  addItem(a);
  downgrade(a);
  const sheet = a.gas.spreadsheet().getSheetByName('Items');
  sheet.getRange(1, 10, 1, 1).setValues([['หมายเหตุ']]);
  sheet.getRange(2, 10, 1, 1).setValues([['ซื้อที่ตลาด']]);
  const err = a.fail('state', {}, OWNER, 'SCHEMA_MISMATCH');
  assert.match(err.message, /คอลัมน์ที่ 10/);
  assert.match(err.message, /statusId/);
  assert.match(err.message, /ย้ายคอลัมน์/);
  assert.equal(sheet.getRange(2, 10, 1, 1).getValues()[0][0], 'ซื้อที่ตลาด');
  assert.equal(a.gas.spreadsheet().getSheetByName('Statuses'), null, 'nothing was created');

  // data in the column but no header: still not overwritten
  sheet.getRange(1, 10, 1, 1).setValues([['']]);
  a.fail('state', {}, OWNER, 'SCHEMA_MISMATCH');
  assert.equal(sheet.getRange(2, 10, 1, 1).getValues()[0][0], 'ซื้อที่ตลาด');
});

test('diagnose treats an old workbook as healthy-but-pending and changes nothing', () => {
  const a = seeded();
  addItem(a);
  downgrade(a);
  const before = JSON.stringify(a.gas.rawRows('Items'));
  const report = a.gas.invoke('diagnose');
  assert.deepEqual(report.checks.filter((c) => !c.ok), []);
  const items = report.checks.find((c) => c.name.includes('แท็บ Items'));
  assert.match(items.detail, /ยังเป็นรูปแบบเดิม 9 คอลัมน์/);
  assert.match(report.checks.find((c) => c.name.includes('แท็บ Statuses')).detail, /สร้างให้เอง/);
  assert.equal(JSON.stringify(a.gas.rawRows('Items')), before);
  assert.equal(a.gas.spreadsheet().getSheetByName('Statuses'), null);
});

test('diagnose still fails a missing Statuses tab on a workbook that is not old', () => {
  const a = seeded();
  const ss = a.gas.spreadsheet();
  ss.deleteSheet(ss.getSheetByName('Statuses'));
  const statuses = a.gas.invoke('diagnose').checks.find((c) => c.name.includes('แท็บ Statuses'));
  assert.equal(statuses.ok, false);
  assert.match(statuses.detail, /setup/);
});
