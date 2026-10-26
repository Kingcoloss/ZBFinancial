'use strict';
const test = require('node:test');
const { app, seeded, invite, assert } = require('./helpers');

test('without a Google identity nothing is served and the reason is explained', () => {
  const { fail } = app({ email: '' });
  const err = fail('state', {}, undefined, 'NO_IDENTITY');
  assert.match(err.message, /Google/);
});

test('the very first account becomes admin of a starter family with default types and categories', () => {
  const { ok } = app();
  const { state } = ok('state', {}, 'Mom@Example.com');
  assert.equal(state.me.email, 'mom@example.com');
  assert.equal(state.me.name, 'mom');
  assert.equal(state.family.role, 'admin');
  assert.deepEqual(state.family.types.map((t) => [t.name, t.kind]), [['รายจ่าย', 'EXPENSE'], ['รายรับ', 'INCOME']]);
  assert.ok(state.family.categories.length >= 6);
  assert.deepEqual(state.family.can, { addItem: true, manageMembers: true, manageStructure: true, renameFamily: true, deleteFamily: true });
});

test('a stranger cannot get in; once an admin adds their email they can', () => {
  const a = seeded();
  const err = a.fail('state', {}, 'stranger@example.com', 'NOT_INVITED');
  assert.match(err.message, /stranger@example.com/);

  invite(a, 'Dad@Example.com', 'พ่อ');
  const { state } = a.ok('state', {}, 'dad@example.com');
  assert.equal(state.me.name, 'พ่อ');
  assert.equal(state.family.id, a.familyId);
  assert.equal(state.family.role, 'member');
});

test('OWNER_EMAIL stops anyone but the owner from claiming an empty workbook', () => {
  const { gas, fail, ok } = app();
  gas.env.props.set('OWNER_EMAIL', 'owner@example.com');
  fail('state', {}, 'intruder@example.com', 'NOT_INVITED');
  ok('state', {}, 'owner@example.com');
});

test('unknown or inherited action names are rejected', () => {
  const { fail } = app();
  for (const action of ['nope', 'constructor', '__proto__', 'toString', '']) {
    fail(action, {}, 'owner@example.com', 'UNKNOWN_ACTION');
  }
});

test('internal failures are logged but never leak details to the browser', () => {
  const a = seeded();
  a.gas.run('Items.save = function () { throw new TypeError("secret detail"); }');
  const err = a.fail('item.save', { familyId: a.familyId }, 'owner@example.com', 'INTERNAL');
  assert.doesNotMatch(JSON.stringify(err), /secret detail|TypeError/);
  assert.equal(a.gas.env.errors.length, 1);
  assert.match(a.gas.env.errors[0], /secret detail/);
  assert.equal(a.gas.env.lockHeld, false, 'the lock is released even when the action throws');
});
