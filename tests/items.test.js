'use strict';
const test = require('node:test');
const { seeded, invite, assert } = require('./helpers');

const OWNER = 'owner@example.com';

function payload(a, extra = {}) {
  return {
    familyId: a.familyId,
    name: 'ค่าน้ำมันรถ',
    amount: 350,
    date: '2026-10-25',
    categoryId: a.cat('เดินทาง').id,
    ownerId: a.me.id,
    view: { familyId: a.familyId },
    ...extra
  };
}

test('an item shows its type, category and owner, and counts toward the month', () => {
  const a = seeded();
  const { result, state } = a.ok('item.save', payload(a), OWNER);
  const [item] = state.family.items;
  assert.equal(item.id, result.id);
  assert.deepEqual(
    { name: item.name, amount: item.amount, date: item.date, kind: item.kind, typeName: item.typeName, categoryName: item.categoryName, ownerName: item.ownerName, canEdit: item.canEdit },
    { name: 'ค่าน้ำมันรถ', amount: 350, date: '2026-10-25', kind: 'EXPENSE', typeName: 'รายจ่าย', categoryName: 'เดินทาง', ownerName: 'owner', canEdit: true }
  );
  assert.equal(state.family.dashboard.expense, 350);
  assert.equal(state.family.dashboard.balance, -350);
});

test('income increases the balance; type comes from the category, never from the caller', () => {
  const a = seeded();
  a.ok('item.save', payload(a, { name: 'เงินเดือน', amount: '30,000', categoryId: a.cat('รายได้ประจำ').id }), OWNER);
  const { state } = a.ok('item.save', payload(a, { kind: 'EXPENSE', typeId: 'fake' }), OWNER);
  const d = state.family.dashboard;
  assert.equal(d.income, 30000);
  assert.equal(d.expense, 350);
  assert.equal(d.balance, 29650);
  assert.deepEqual(state.family.items.map((i) => i.kind).sort(), ['EXPENSE', 'INCOME']);
});

test('only the selected month is listed, newest first', () => {
  const a = seeded();
  a.ok('item.save', payload(a, { name: 'เก่า', date: '2026-09-30' }), OWNER);
  a.ok('item.save', payload(a, { name: 'ต้นเดือน', date: '2026-10-01' }), OWNER);
  a.ok('item.save', payload(a, { name: 'ล่าสุด', date: '2026-10-25' }), OWNER);
  const oct = a.ok('state', { view: { familyId: a.familyId, month: '2026-10' } }, OWNER).state.family.items;
  assert.deepEqual(oct.map((i) => i.name), ['ล่าสุด', 'ต้นเดือน']);
  const sep = a.ok('state', { view: { familyId: a.familyId, month: '2026-09' } }, OWNER).state.family.items;
  assert.deepEqual(sep.map((i) => i.name), ['เก่า']);
});

test('editing keeps the id and the owner unless told otherwise', () => {
  const a = seeded();
  const memberId = invite(a, 'mom@example.com', 'แม่');
  const created = a.ok('item.save', payload(a, { ownerId: memberId }), OWNER).result.id;
  const { state } = a.ok('item.save', { familyId: a.familyId, id: created, name: 'น้ำมัน', amount: 400, date: '2026-10-24', categoryId: a.cat('เดินทาง').id, view: { familyId: a.familyId } }, OWNER);
  assert.equal(state.family.items.length, 1);
  assert.deepEqual(
    { id: state.family.items[0].id, name: state.family.items[0].name, amount: state.family.items[0].amount, ownerName: state.family.items[0].ownerName },
    { id: created, name: 'น้ำมัน', amount: 400, ownerName: 'แม่' }
  );
});

test('bad input is refused with a message that names the field', () => {
  const a = seeded();
  const cases = [
    [{ name: '  ' }, 'name'],
    [{ amount: 0 }, 'amount'],
    [{ amount: -5 }, 'amount'],
    [{ amount: 'abc' }, 'amount'],
    [{ amount: 1e10 }, 'amount'],
    [{ date: '2026-02-30' }, 'date'],
    [{ date: '' }, 'date'],
    [{ date: '1999-12-31' }, 'date'],
    [{ categoryId: 'c_nope' }, 'categoryId'],
    [{ ownerId: 'u_nope' }, 'ownerId']
  ];
  for (const [extra, field] of cases) {
    const err = a.fail('item.save', payload(a, extra), OWNER, 'INVALID');
    assert.equal(err.details.field, field, JSON.stringify(extra));
    assert.ok(err.message.length > 5);
  }
  assert.equal(a.gas.rawRows('Items').length, 0);
});

test('a category or owner from another family cannot be used', () => {
  const a = seeded();
  const other = a.ok('family.save', { name: 'บ้านคุณยาย', view: { familyId: a.familyId } }, OWNER);
  const otherFamily = other.state.family;
  a.fail('item.save', payload(a, { categoryId: otherFamily.categories[0].id }), OWNER, 'INVALID');
  const yai = a.ok('user.save', { familyId: otherFamily.id, email: 'yai@example.com', name: 'ยาย', role: 'member', view: { familyId: otherFamily.id } }, OWNER);
  a.fail('item.save', payload(a, { ownerId: yai.result.id }), OWNER, 'INVALID');
});

test('members record and manage only their own items', () => {
  const a = seeded();
  const mom = invite(a, 'mom@example.com', 'แม่');
  const adminItem = a.ok('item.save', payload(a, { name: 'ของพ่อ' }), OWNER).result.id;
  const own = a.ok('item.save', payload(a, { name: 'ของแม่', ownerId: mom }), 'mom@example.com').result.id;

  a.fail('item.save', payload(a, { ownerId: a.me.id }), 'mom@example.com', 'FORBIDDEN');
  a.fail('item.save', payload(a, { id: adminItem, name: 'แก้' }), 'mom@example.com', 'FORBIDDEN');
  a.fail('item.remove', { familyId: a.familyId, id: adminItem }, 'mom@example.com', 'FORBIDDEN');

  const { state } = a.ok('state', {}, 'mom@example.com');
  assert.deepEqual(Object.fromEntries(state.family.items.map((i) => [i.name, i.canEdit])), { ของพ่อ: false, ของแม่: true });

  a.ok('item.save', payload(a, { id: own, name: 'ของแม่ (แก้)', ownerId: mom }), 'mom@example.com');
  a.ok('item.remove', { familyId: a.familyId, id: own }, 'mom@example.com');
  assert.deepEqual(a.gas.rawRows('Items').map((r) => r.name), ['ของพ่อ']);
});

test('admins can record and fix items for anyone', () => {
  const a = seeded();
  const mom = invite(a, 'mom@example.com', 'แม่');
  const id = a.ok('item.save', payload(a, { ownerId: mom }), OWNER).result.id;
  a.ok('item.save', payload(a, { id, amount: 999, ownerId: mom }), OWNER);
  assert.equal(a.gas.rawRows('Items')[0].amount, 999);
  a.ok('item.remove', { familyId: a.familyId, id }, OWNER);
  assert.equal(a.gas.rawRows('Items').length, 0);
});

test('viewers can read everything and change nothing', () => {
  const a = seeded();
  invite(a, 'yai@example.com', 'ยาย', 'viewer');
  const id = a.ok('item.save', payload(a), OWNER).result.id;
  const { state } = a.ok('state', {}, 'yai@example.com');
  assert.equal(state.family.items.length, 1);
  assert.equal(state.family.items[0].canEdit, false);
  assert.equal(state.family.can.addItem, false);
  a.fail('item.save', payload(a), 'yai@example.com', 'FORBIDDEN');
  a.fail('item.save', payload(a, { id }), 'yai@example.com', 'FORBIDDEN');
  a.fail('item.remove', { familyId: a.familyId, id }, 'yai@example.com', 'FORBIDDEN');
});

test('families are walled off from each other', () => {
  const a = seeded();
  const id = a.ok('item.save', payload(a), OWNER).result.id;
  const guest = invite(a, 'other@example.com', 'คนอื่น');
  const theirs = a.ok('family.save', { name: 'อีกบ้าน', view: {} }, 'other@example.com').state.family;
  a.ok('user.remove', { familyId: a.familyId, userId: guest, view: { familyId: a.familyId } }, OWNER);

  // asking for a family they do not belong to quietly shows their own
  const { state } = a.ok('state', { view: { familyId: a.familyId } }, 'other@example.com');
  assert.equal(state.family.id, theirs.id);
  assert.equal(state.families.length, 1);

  a.fail('item.remove', { familyId: a.familyId, id }, 'other@example.com', 'FORBIDDEN');
  a.fail('item.save', payload(a, { id, name: 'แอบแก้' }), 'other@example.com', 'FORBIDDEN');
  a.fail('item.save', payload(a), 'other@example.com', 'FORBIDDEN');
  a.fail('category.save', { familyId: a.familyId, typeId: a.type('EXPENSE').id, name: 'แอบเพิ่ม', view: {} }, 'other@example.com', 'FORBIDDEN');
  assert.deepEqual(a.gas.rawRows('Items').map((r) => r.name), ['ค่าน้ำมันรถ']);
});

test('removing an item that is already gone says so kindly', () => {
  const a = seeded();
  const err = a.fail('item.remove', { familyId: a.familyId, id: 'i_gone' }, OWNER, 'NOT_FOUND');
  assert.match(err.message, /ลบไปแล้ว/);
});
