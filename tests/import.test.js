'use strict';
const test = require('node:test');
const { seeded, invite, assert } = require('./helpers');

const OWNER = 'owner@example.com';

/** Records one item and returns its id. */
function add(a, extra = {}, as = OWNER) {
  return a.ok('item.save', {
    familyId: a.familyId,
    name: 'ค่าเช่าบ้าน',
    amount: 8000,
    date: '2026-09-05',
    categoryId: a.cat('บ้านและสาธารณูปโภค').id,
    ownerId: a.me.id,
    view: { familyId: a.familyId },
    ...extra
  }, as).result.id;
}

const status = (a, name) => a.state.family.statuses.find((s) => s.name === name);
const source = (a, extra = {}, as = OWNER) =>
  a.ok('item.source', { familyId: a.familyId, month: '2026-09', toMonth: '2026-10', view: { familyId: a.familyId }, ...extra }, as).result;
const doImport = (a, ids, extra = {}, as = OWNER) =>
  a.ok('item.import', { familyId: a.familyId, month: '2026-09', toMonth: '2026-10', ids, view: { familyId: a.familyId }, ...extra }, as);
const failImport = (a, ids, code, extra = {}, as = OWNER) =>
  a.fail('item.import', { familyId: a.familyId, month: '2026-09', toMonth: '2026-10', ids, view: { familyId: a.familyId }, ...extra }, as, code);
const rows = (a) => a.gas.rawRows('Items');

test('the day of the month is kept, and a day the month lacks becomes its last day', () => {
  const a = seeded();
  const run = (date, month) => a.gas.run(`Util.sameDayIn(${JSON.stringify(date)}, ${JSON.stringify(month)})`);
  assert.equal(run('2026-09-05', '2026-10'), '2026-10-05');
  assert.equal(run('2026-01-31', '2026-02'), '2026-02-28');
  assert.equal(run('2028-01-31', '2028-02'), '2028-02-29', 'leap year');
  assert.equal(run('2027-01-31', '2027-02'), '2027-02-28', 'not a leap year');
  assert.equal(run('2026-10-31', '2026-11'), '2026-11-30');
  assert.equal(run('2026-12-15', '2027-01'), '2027-01-15', 'across a year');
  assert.equal(run('2026-03-31', '2026-04'), '2026-04-30');
});

test('importing copies the chosen items into the month and leaves the originals alone', () => {
  const a = seeded();
  const rent = add(a);
  const salary = add(a, { name: 'เงินเดือน', amount: 30000, date: '2026-09-25', categoryId: a.cat('รายได้ประจำ').id });
  add(a, { name: 'ซื้อของครั้งเดียว', amount: 99, date: '2026-09-10', categoryId: a.cat('อาหาร').id });

  const { result, state } = doImport(a, [rent, salary]);
  assert.deepEqual([result.count, result.month, result.toMonth], [2, '2026-09', '2026-10']);

  const copied = rows(a).filter((r) => r.date.startsWith('2026-10'));
  assert.deepEqual(
    copied.map((r) => [r.name, r.amount, r.date, r.categoryId, r.ownerId]).sort(),
    [
      ['ค่าเช่าบ้าน', 8000, '2026-10-05', a.cat('บ้านและสาธารณูปโภค').id, a.me.id],
      ['เงินเดือน', 30000, '2026-10-25', a.cat('รายได้ประจำ').id, a.me.id]
    ].sort()
  );
  assert.equal(rows(a).filter((r) => r.date.startsWith('2026-09')).length, 3, 'September is untouched');
  assert.equal(new Set(rows(a).map((r) => r.id)).size, 5, 'every copy has an id of its own');
  assert.deepEqual(state.family.items.map((i) => i.name).sort(), ['ค่าเช่าบ้าน', 'เงินเดือน'].sort(), 'the refreshed state is the target month');
  assert.equal(state.meta.month, '2026-10');
});

test('the copies take one status, the default for new items unless another is chosen', () => {
  const a = seeded();
  const id = add(a);
  const paid = status(a, 'ชำระแล้ว');
  const pending = status(a, 'รอดำเนินการ');

  const first = doImport(a, [id]);
  assert.equal(rows(a).find((r) => r.date === '2026-10-05').statusId, paid.id, 'no status given = the family default');
  assert.equal(first.state.family.dashboard.expense, 8000);

  const second = doImport(a, [id], { statusId: pending.id });
  assert.equal(rows(a).filter((r) => r.date === '2026-10-05' && r.statusId === pending.id).length, 1);
  assert.equal(second.result.statusId, pending.id);
  assert.equal(second.state.family.dashboard.expense, 8000, 'a pending copy is not in the totals, the paid one still is');
});

test('a status of another family, or one that does not exist, is refused and nothing is written', () => {
  const a = seeded();
  const id = add(a);
  const other = a.ok('family.save', { name: 'บ้านคุณยาย', view: { familyId: a.familyId } }, OWNER).state.family;
  const err = failImport(a, [id], 'INVALID', { statusId: other.statuses[0].id });
  assert.equal(err.details.field, 'statusId');
  failImport(a, [id], 'INVALID', { statusId: 'nope' });
  assert.equal(rows(a).length, 1);
});

test('the preview lists the month newest first with the date each item would get', () => {
  const a = seeded();
  add(a, { name: 'ต้นเดือน', date: '2026-09-01' });
  add(a, { name: 'ปลายเดือน', date: '2026-09-30', categoryId: a.cat('อาหาร').id, amount: 120.5 });
  add(a, { name: 'เดือนอื่น', date: '2026-08-15' });

  const res = source(a, { toMonth: '2026-11' });
  assert.deepEqual([res.month, res.toMonth, res.max], ['2026-09', '2026-11', 200]);
  assert.deepEqual(res.items.map((i) => [i.name, i.date, i.newDate]), [
    ['ปลายเดือน', '2026-09-30', '2026-11-30'],
    ['ต้นเดือน', '2026-09-01', '2026-11-01']
  ]);
  const [first] = res.items;
  assert.deepEqual(
    { amount: first.amount, kind: first.kind, categoryName: first.categoryName, ownerName: first.ownerName, importable: first.importable, reason: first.reason },
    { amount: 120.5, kind: 'EXPENSE', categoryName: 'อาหาร', ownerName: 'owner', importable: true, reason: '' }
  );
});

test('the preview says which items the month already holds, so a second import is a choice', () => {
  const a = seeded();
  const rent = add(a);
  const water = add(a, { name: 'ค่าน้ำ', amount: 180, date: '2026-09-12' });
  const tv = add(a, { name: 'Netflix', amount: 419, date: '2026-09-20' });
  assert.deepEqual(source(a).items.map((i) => i.exists), [false, false, false]);

  doImport(a, [rent]);
  assert.deepEqual(
    Object.fromEntries(source(a).items.map((i) => [i.name, i.exists])),
    { ค่าเช่าบ้าน: true, ค่าน้ำ: false, Netflix: false }
  );

  // same name and category but another owner is a different item
  const mom = invite(a, 'mom@example.com', 'แม่');
  add(a, { name: 'ค่าน้ำ', amount: 180, date: '2026-10-12', ownerId: mom });
  assert.equal(source(a).items.find((i) => i.id === water).exists, false);
  // a name that differs only in letter case is the same item
  add(a, { name: 'NETFLIX', amount: 419, date: '2026-10-20' });
  assert.equal(source(a).items.find((i) => i.id === tv).exists, true);

  // importing again is still allowed: the preview only warns, the person decides
  doImport(a, [rent]);
  assert.equal(rows(a).filter((r) => r.name === 'ค่าเช่าบ้าน' && r.date === '2026-10-05').length, 2);
});

test('members copy only their own items; admins copy everyone\'s and keep the owners', () => {
  const a = seeded();
  const mom = invite(a, 'mom@example.com', 'แม่');
  const dads = add(a, { name: 'ของพ่อ' });
  const moms = add(a, { name: 'ของแม่', ownerId: mom, date: '2026-09-07' }, 'mom@example.com');

  const asMom = source(a, {}, 'mom@example.com').items;
  assert.deepEqual(
    Object.fromEntries(asMom.map((i) => [i.name, [i.importable, i.reason]])),
    { ของพ่อ: [false, 'เป็นรายการของคนอื่น'], ของแม่: [true, ''] }
  );
  failImport(a, [dads], 'FORBIDDEN', {}, 'mom@example.com');
  failImport(a, [moms, dads], 'FORBIDDEN', {}, 'mom@example.com');
  assert.equal(rows(a).filter((r) => r.date.startsWith('2026-10')).length, 0, 'nothing was copied');

  doImport(a, [moms], {}, 'mom@example.com');
  assert.deepEqual(rows(a).filter((r) => r.date.startsWith('2026-10')).map((r) => [r.name, r.ownerId]), [['ของแม่', mom]]);

  const asAdmin = source(a).items;
  assert.ok(asAdmin.every((i) => i.importable));
  doImport(a, [dads, moms]);
  const byName = Object.fromEntries(rows(a).filter((r) => r.date.startsWith('2026-10')).map((r) => [r.name, r.ownerId]));
  assert.equal(byName['ของพ่อ'], a.me.id);
  assert.equal(byName['ของแม่'], mom);
});

test('viewers can neither preview for copying nor copy', () => {
  const a = seeded();
  const id = add(a);
  invite(a, 'yai@example.com', 'ยาย', 'viewer');
  a.fail('item.source', { familyId: a.familyId, month: '2026-09', toMonth: '2026-10', view: {} }, 'yai@example.com', 'FORBIDDEN');
  failImport(a, [id], 'FORBIDDEN', {}, 'yai@example.com');
  assert.equal(rows(a).length, 1);
});

test('another family\'s items cannot be copied, or even previewed', () => {
  const a = seeded();
  const id = add(a);
  const guest = invite(a, 'other@example.com', 'คนอื่น');
  const theirs = a.ok('family.save', { name: 'อีกบ้าน', view: {} }, 'other@example.com').state.family;
  a.ok('user.remove', { familyId: a.familyId, userId: guest, view: { familyId: a.familyId } }, OWNER);

  a.fail('item.source', { familyId: a.familyId, month: '2026-09', toMonth: '2026-10', view: {} }, 'other@example.com', 'FORBIDDEN');
  failImport(a, [id], 'FORBIDDEN', {}, 'other@example.com');
  // naming their own family does not let them reach an id from ours
  failImport(a, [id], 'NOT_FOUND', { familyId: theirs.id }, 'other@example.com');
  assert.equal(rows(a).length, 1);
});

test('bad requests are refused with a message that names the field, and write nothing', () => {
  const a = seeded();
  const id = add(a);
  const cases = [
    [{ ids: [] }, 'ids'],
    [{ ids: undefined }, 'ids'],
    [{ ids: 'not-a-list' }, 'ids'],
    [{ month: '2026-13' }, 'month'],
    [{ month: '' }, 'month'],
    [{ month: '2026-10' }, 'month'],
    [{ toMonth: 'yesterday' }, 'toMonth'],
    [{ toMonth: '1999-12' }, 'toMonth'],
    [{ toMonth: '2101-01' }, 'toMonth']
  ];
  for (const [extra, field] of cases) {
    const err = failImport(a, [id], 'INVALID', extra);
    assert.equal(err.details.field, field, JSON.stringify(extra));
    assert.ok(err.message.length > 5);
  }
  const err = a.fail('item.source', { familyId: a.familyId, month: '2026-10', toMonth: '2026-10', view: {} }, OWNER, 'INVALID');
  assert.equal(err.details.field, 'month');
  assert.equal(rows(a).length, 1);
});

test('one item that cannot be copied stops the whole import', () => {
  const a = seeded();
  const good = add(a);
  const august = add(a, { name: 'เดือนอื่น', date: '2026-08-15' });

  failImport(a, [good, 'i_gone'], 'NOT_FOUND');
  const err = failImport(a, [good, august], 'CONFLICT');
  assert.match(err.message, /เดือนอื่น/);
  assert.equal(err.details.field, 'ids');
  assert.equal(rows(a).length, 2, 'the good one was not copied either');
});

test('an item whose category is gone says so instead of being copied half-way', () => {
  const a = seeded();
  const id = add(a);
  // someone removed the category row by hand in the Sheet
  a.gas.run(`Db.reset(); Db.withLock(function () { Db.table('Categories').remove(${JSON.stringify(a.cat('บ้านและสาธารณูปโภค').id)}); })`);
  const res = source(a);
  assert.deepEqual([res.items[0].importable, res.items[0].reason], [false, 'ไม่มีหมวดหมู่แล้ว']);
  const err = failImport(a, [id], 'CONFLICT');
  assert.match(err.message, /หมวดหมู่/);
  assert.equal(rows(a).length, 1);
});

test('the same id sent twice is copied once, and an import is capped', () => {
  const a = seeded();
  const id = add(a);
  assert.equal(doImport(a, [id, id, id]).result.count, 1);
  const many = Array.from({ length: 201 }, (_, k) => `i_${k}`);
  const err = failImport(a, many, 'INVALID');
  assert.equal(err.details.field, 'ids');
  assert.match(err.message, /200/);
});

test('an owner who is no longer in the family is replaced by the person copying', () => {
  const a = seeded();
  const id = add(a);
  const mom = invite(a, 'mom@example.com', 'แม่');
  const moms = add(a, { name: 'ของแม่', ownerId: mom });
  // the membership row was deleted by hand in the Sheet; the item still names her
  a.gas.run(`Db.reset(); Db.withLock(function () { Db.table('Memberships').remove(Perm.membership(${JSON.stringify(mom)}, ${JSON.stringify(a.familyId)}).id); })`);
  doImport(a, [id, moms]);
  const copied = rows(a).filter((r) => r.date.startsWith('2026-10'));
  assert.deepEqual(copied.map((r) => r.ownerId), [a.me.id, a.me.id]);
});

test('the state lists the months that hold items, newest first, so the person can pick one', () => {
  const a = seeded();
  assert.deepEqual(a.ok('state', {}, OWNER).state.family.itemMonths, []);
  add(a, { date: '2026-09-05' });
  add(a, { date: '2026-09-20' });
  add(a, { date: '2026-10-02' });
  add(a, { date: '2025-12-31' });
  assert.deepEqual(a.ok('state', {}, OWNER).state.family.itemMonths, [
    { month: '2026-10', count: 1 },
    { month: '2026-09', count: 2 },
    { month: '2025-12', count: 1 }
  ]);
  // it is the family's own: another family's items are not counted
  const other = a.ok('family.save', { name: 'บ้านคุณยาย', view: { familyId: a.familyId } }, OWNER).state.family;
  assert.deepEqual(other.itemMonths, []);
});

test('copying from the end of a long month into a short one, and across a year', () => {
  const a = seeded();
  const jan31 = add(a, { name: 'สิ้นเดือน', date: '2026-01-31' });
  const dec = add(a, { name: 'ปลายปี', date: '2026-12-15' });
  doImport(a, [jan31], { month: '2026-01', toMonth: '2026-02' });
  doImport(a, [dec], { month: '2026-12', toMonth: '2027-01' });
  assert.deepEqual(
    rows(a).filter((r) => r.date !== '2026-01-31' && r.date !== '2026-12-15').map((r) => [r.name, r.date]),
    [['สิ้นเดือน', '2026-02-28'], ['ปลายปี', '2027-01-15']]
  );
});
