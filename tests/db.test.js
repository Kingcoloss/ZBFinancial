'use strict';
const test = require('node:test');
const { seeded, assert } = require('./helpers');

const saveItem = (a, extra = {}, as = 'owner@example.com') =>
  a.ok('item.save', {
    familyId: a.familyId,
    name: 'ก๋วยเตี๋ยว',
    amount: 60,
    date: '2026-10-25',
    categoryId: a.cat('อาหาร').id,
    ownerId: a.me.id,
    view: { familyId: a.familyId },
    ...extra
  }, as);

test('text that looks like a formula, a number or a date is stored as typed', () => {
  const a = seeded();
  saveItem(a, { name: '=HYPERLINK("http://evil.example","คลิก")' });
  saveItem(a, { name: '007' });
  saveItem(a, { name: '2026-10-25' });
  saveItem(a, { name: '+66 81 234 5678' });
  const names = a.gas.rawRows('Items').map((r) => r.name);
  assert.deepEqual(names, ['=HYPERLINK("http://evil.example","คลิก")', '007', '2026-10-25', '+66 81 234 5678']);
  names.forEach((n) => assert.equal(typeof n, 'string'));
  assert.equal(a.gas.rawRows('Items')[0].date, '2026-10-25', 'dates are kept as yyyy-MM-dd text');
});

test('amounts are real numbers in the Sheet so formulas and charts can use them', () => {
  const a = seeded();
  saveItem(a, { amount: '1,240.50' });
  const [row] = a.gas.rawRows('Items');
  assert.strictEqual(row.amount, 1240.5);
});

test('a date a person retyped in the Sheet (stored as a real date) still reads back as yyyy-MM-dd', () => {
  const a = seeded();
  const id = saveItem(a).result.id;
  const sheet = a.gas.spreadsheet().getSheetByName('Items');
  const rowNumber = a.gas.rawRows('Items').findIndex((r) => r.id === id) + 2;
  sheet.getRange(rowNumber, 7).setNumberFormats([['General']]);
  sheet.getRange(rowNumber, 7).setValues([['2026-09-30']]);
  assert.ok(sheet.getRange(rowNumber, 7).getValues()[0][0] instanceof Date, 'the fake Sheet converted it, like the real one');
  const { state } = a.ok('state', { view: { familyId: a.familyId, month: '2026-09' } }, 'owner@example.com');
  assert.deepEqual(state.family.items.map((i) => i.date), ['2026-09-30']);
});

test('the sheet grows by itself when more rows are written than it has', () => {
  const a = seeded();
  const sheet = () => a.gas.spreadsheet().getSheetByName('Items');
  const before = sheet().getMaxRows();
  const rows = Array.from({ length: before + 50 }, (_, i) => ({
    familyId: a.familyId, categoryId: a.cat('อาหาร').id, ownerId: a.me.id, name: `รายการ ${i}`, amount: i + 1, date: '2026-10-01'
  }));
  a.gas.context.__rows = JSON.stringify(rows);
  a.gas.run("Db.reset(); Db.withLock(function () { Db.table('Items').insert(JSON.parse(__rows)); })");
  assert.equal(a.gas.rawRows('Items').length, before + 50);
  assert.ok(sheet().getMaxRows() >= before + 51);
  saveItem(a, { name: 'one more' });
  assert.equal(a.gas.rawRows('Items').length, before + 51);
});

test('deleting scattered and consecutive rows removes exactly the right ones', () => {
  const a = seeded();
  for (let i = 1; i <= 9; i++) saveItem(a, { name: `n${i}`, amount: i });
  a.gas.run("Db.reset(); Db.withLock(function () { Db.table('Items').removeWhere(function (r) { return [1, 2, 3, 5, 9].indexOf(r.amount) >= 0; }); })");
  assert.deepEqual(a.gas.rawRows('Items').map((r) => r.name), ['n4', 'n6', 'n7', 'n8']);
});

test('setting one column on many rows is a single write and leaves other columns alone', () => {
  const a = seeded();
  for (let i = 1; i <= 5; i++) saveItem(a, { name: `n${i}`, amount: i });
  const sheet = a.gas.spreadsheet().getSheetByName('Items');
  const writesBefore = sheet.writes;
  a.gas.run("Db.reset(); Db.withLock(function () { Db.table('Items').setColumnWhere(function (r) { return r.amount >= 2; }, 'name', 'moved'); })");
  assert.deepEqual(a.gas.rawRows('Items').map((r) => r.name), ['n1', 'moved', 'moved', 'moved', 'moved']);
  assert.deepEqual(a.gas.rawRows('Items').map((r) => r.amount), [1, 2, 3, 4, 5]);
  assert.ok(sheet.writes - writesBefore <= 5 * 9, 'one grid write, not one per row');
});

test('writes take the script lock and release it; reads do not', () => {
  const a = seeded();
  const base = a.gas.env.locks;
  a.ok('state', {}, 'owner@example.com');
  assert.equal(a.gas.env.locks, base);
  saveItem(a);
  assert.equal(a.gas.env.locks, base + 1);
  assert.equal(a.gas.env.lockHeld, false);
});

test('when the lock is busy the person is asked to wait, not shown an error trace', () => {
  const a = seeded();
  a.gas.env.lockHeld = true;
  const err = a.fail('item.save', { familyId: a.familyId }, 'owner@example.com', 'BUSY');
  assert.match(err.message, /รอสักครู่/);
});
