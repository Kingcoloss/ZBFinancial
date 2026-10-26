'use strict';
const test = require('node:test');
const { seeded, invite, assert } = require('./helpers');

const OWNER = 'owner@example.com';

const addItem = (a, categoryId, extra = {}) =>
  a.ok('item.save', { familyId: a.familyId, name: 'x', amount: 10, date: '2026-10-20', categoryId, ownerId: a.me.id, view: { familyId: a.familyId }, ...extra }, OWNER);

test('types: add, rename, and the list reports how many categories each has', () => {
  const a = seeded();
  const { result, state } = a.ok('type.save', { familyId: a.familyId, name: 'เงินออม', kind: 'EXPENSE', view: { familyId: a.familyId } }, OWNER);
  const t = state.family.types.find((x) => x.id === result.id);
  assert.deepEqual({ name: t.name, kind: t.kind, categoryCount: t.categoryCount }, { name: 'เงินออม', kind: 'EXPENSE', categoryCount: 0 });
  const renamed = a.ok('type.save', { familyId: a.familyId, id: result.id, name: 'ออมเงิน', kind: 'EXPENSE', view: { familyId: a.familyId } }, OWNER);
  assert.ok(renamed.state.family.types.some((x) => x.name === 'ออมเงิน'));
  assert.equal(state.family.types.find((x) => x.name === 'รายจ่าย').categoryCount, 6);
});

test('types: names are unique per family (ignoring case) and kind must be valid', () => {
  const a = seeded();
  a.fail('type.save', { familyId: a.familyId, name: ' รายรับ ', kind: 'INCOME' }, OWNER, 'CONFLICT');
  a.fail('type.save', { familyId: a.familyId, name: 'ใหม่', kind: 'SAVING' }, OWNER, 'INVALID');
  a.fail('type.save', { familyId: a.familyId, name: '', kind: 'INCOME' }, OWNER, 'INVALID');
});

test('types: Expense/Income cannot be flipped once items depend on it, but the name can change', () => {
  const a = seeded();
  addItem(a, a.cat('อาหาร').id);
  const t = a.type('EXPENSE');
  const err = a.fail('type.save', { familyId: a.familyId, id: t.id, name: t.name, kind: 'INCOME' }, OWNER, 'CONFLICT');
  assert.equal(err.details.field, 'kind');
  a.ok('type.save', { familyId: a.familyId, id: t.id, name: 'ค่าใช้จ่าย', kind: 'EXPENSE', view: { familyId: a.familyId } }, OWNER);
});

test('types: one with categories cannot be deleted; an empty one can', () => {
  const a = seeded();
  const err = a.fail('type.remove', { familyId: a.familyId, id: a.type('INCOME').id }, OWNER, 'CONFLICT');
  assert.match(err.message, /2 หมวดหมู่/);
  const created = a.ok('type.save', { familyId: a.familyId, name: 'ชั่วคราว', kind: 'EXPENSE', view: {} }, OWNER).result.id;
  const { state } = a.ok('type.remove', { familyId: a.familyId, id: created, view: { familyId: a.familyId } }, OWNER);
  assert.equal(state.family.types.length, 2);
});

test('categories: add, rename, duplicates are refused only within the same type', () => {
  const a = seeded();
  const exp = a.type('EXPENSE').id;
  const inc = a.type('INCOME').id;
  const { result } = a.ok('category.save', { familyId: a.familyId, typeId: exp, name: 'ของขวัญ', view: { familyId: a.familyId } }, OWNER);
  a.fail('category.save', { familyId: a.familyId, typeId: exp, name: ' ของขวัญ ' }, OWNER, 'CONFLICT');
  a.ok('category.save', { familyId: a.familyId, typeId: inc, name: 'ของขวัญ', view: {} }, OWNER);
  const renamed = a.ok('category.save', { familyId: a.familyId, id: result.id, typeId: exp, name: 'ของฝาก', view: { familyId: a.familyId } }, OWNER);
  assert.ok(renamed.state.family.categories.some((c) => c.name === 'ของฝาก' && c.kind === 'EXPENSE'));
});

test('categories: the item count of a month is shown, and the type cannot change under existing items', () => {
  const a = seeded();
  const food = a.cat('อาหาร');
  addItem(a, food.id);
  addItem(a, food.id, { date: '2026-09-01' });
  const { state } = a.ok('state', {}, OWNER);
  const row = state.family.categories.find((c) => c.id === food.id);
  assert.deepEqual({ month: row.monthItems, all: row.itemCount }, { month: 1, all: 2 });
  a.fail('category.save', { familyId: a.familyId, id: food.id, typeId: a.type('INCOME').id, name: 'อาหาร' }, OWNER, 'CONFLICT');
  const empty = a.cat('สุขภาพ');
  a.ok('category.save', { familyId: a.familyId, id: empty.id, typeId: a.type('INCOME').id, name: 'สุขภาพ', view: {} }, OWNER);
});

test('categories: deleting one with items asks where to move them, and nothing is lost', () => {
  const a = seeded();
  const food = a.cat('อาหาร');
  const home = a.cat('บ้านและสาธารณูปโภค');
  addItem(a, food.id, { name: 'ข้าว' });
  addItem(a, food.id, { name: 'น้ำ', date: '2026-08-01' });

  const ask = a.fail('category.remove', { familyId: a.familyId, id: food.id }, OWNER, 'NEEDS_REASSIGN');
  assert.equal(ask.details.count, 2);
  assert.equal(a.gas.rawRows('Items').length, 2);

  a.fail('category.remove', { familyId: a.familyId, id: food.id, moveToId: food.id }, OWNER, 'INVALID');
  a.fail('category.remove', { familyId: a.familyId, id: food.id, moveToId: a.cat('รายได้ประจำ').id }, OWNER, 'INVALID');

  const { result, state } = a.ok('category.remove', { familyId: a.familyId, id: food.id, moveToId: home.id, view: { familyId: a.familyId } }, OWNER);
  assert.equal(result.moved, 2);
  assert.ok(!state.family.categories.some((c) => c.id === food.id));
  const rows = a.gas.rawRows('Items');
  assert.deepEqual(rows.map((r) => [r.name, r.categoryId]), [['ข้าว', home.id], ['น้ำ', home.id]]);
});

test('categories: an empty one is simply deleted', () => {
  const a = seeded();
  const { state } = a.ok('category.remove', { familyId: a.familyId, id: a.cat('สุขภาพ').id, view: { familyId: a.familyId } }, OWNER);
  assert.ok(!state.family.categories.some((c) => c.name === 'สุขภาพ'));
});

test('only admins manage types and categories', () => {
  const a = seeded();
  invite(a, 'mom@example.com', 'แม่');
  invite(a, 'yai@example.com', 'ยาย', 'viewer');
  for (const who of ['mom@example.com', 'yai@example.com']) {
    a.fail('type.save', { familyId: a.familyId, name: 'ใหม่', kind: 'EXPENSE' }, who, 'FORBIDDEN');
    a.fail('type.remove', { familyId: a.familyId, id: a.type('EXPENSE').id }, who, 'FORBIDDEN');
    a.fail('category.save', { familyId: a.familyId, typeId: a.type('EXPENSE').id, name: 'ใหม่' }, who, 'FORBIDDEN');
    a.fail('category.remove', { familyId: a.familyId, id: a.cat('อาหาร').id }, who, 'FORBIDDEN');
  }
  const { state } = a.ok('state', {}, 'mom@example.com');
  assert.equal(state.family.can.manageStructure, false);
});

test('the same names can exist in two families without clashing', () => {
  const a = seeded();
  const { state } = a.ok('family.save', { name: 'บ้านคุณยาย', view: { familyId: a.familyId } }, OWNER);
  assert.equal(state.family.name, 'บ้านคุณยาย');
  assert.equal(state.family.categories.length, 8);
  assert.notEqual(state.family.types[0].id, a.type('EXPENSE').id);
});
