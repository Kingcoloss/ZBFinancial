'use strict';
const test = require('node:test');
const { seeded, invite, assert } = require('./helpers');

const OWNER = 'owner@example.com';
const view = (a) => ({ familyId: a.familyId });

const addItem = (a, ownerId, extra = {}) =>
  a.ok('item.save', { familyId: a.familyId, name: 'x', amount: 10, date: '2026-10-20', categoryId: a.cat('อาหาร').id, ownerId, view: view(a), ...extra }, OWNER);

test('a new family gets starter types and categories, the creator is its admin, and the screen switches to it', () => {
  const a = seeded();
  const { result, state } = a.ok('family.save', { name: 'บ้านคุณยาย', view: view(a) }, OWNER);
  assert.equal(state.family.id, result.id);
  assert.equal(state.family.role, 'admin');
  assert.equal(state.families.length, 2);
  assert.deepEqual(state.family.members.map((m) => m.name), ['owner']);
  assert.equal(state.family.types.length, 2);
  assert.equal(state.family.categories.length, 8);
});

test('family names must be filled in and not repeat one of your own families', () => {
  const a = seeded();
  a.fail('family.save', { name: '   ' }, OWNER, 'INVALID');
  a.fail('family.save', { name: 'ครอบครัวของฉัน' }, OWNER, 'CONFLICT');
});

test('admins rename a family; others cannot', () => {
  const a = seeded();
  invite(a, 'mom@example.com', 'แม่');
  const { state } = a.ok('family.save', { id: a.familyId, name: 'บ้านสุขใจ', view: view(a) }, OWNER);
  assert.equal(state.family.name, 'บ้านสุขใจ');
  a.fail('family.save', { id: a.familyId, name: 'แอบเปลี่ยน' }, 'mom@example.com', 'FORBIDDEN');
});

test('one person can belong to several families and switch between them', () => {
  const a = seeded();
  const mom = invite(a, 'mom@example.com', 'แม่');
  const yai = a.ok('family.save', { name: 'บ้านคุณยาย', view: view(a) }, 'mom@example.com').result;
  const home = a.ok('state', {}, 'mom@example.com').state;
  assert.equal(home.families.length, 2);
  assert.deepEqual(home.families.map((f) => f.role).sort(), ['admin', 'member']);
  const switched = a.ok('state', { view: { familyId: yai.id } }, 'mom@example.com').state;
  assert.equal(switched.family.id, yai.id);
  assert.notEqual(mom, undefined);
});

test('an admin can add someone from another of their families, but not a stranger', () => {
  const a = seeded();
  invite(a, 'mom@example.com', 'แม่');
  const gran = a.ok('family.save', { name: 'บ้านคุณยาย', view: view(a) }, OWNER).state.family;
  const strangerId = a.ok('user.save', { familyId: gran.id, email: 'aunt@example.com', name: 'ป้า', role: 'member', view: { familyId: gran.id } }, OWNER).result.id;

  const mine = a.ok('state', { view: view(a) }, OWNER).state.family;
  assert.deepEqual(mine.addableUsers.map((u) => u.email), ['aunt@example.com']);

  const { state } = a.ok('family.save', { id: a.familyId, name: mine.name, addUserId: strangerId, addRole: 'viewer', view: view(a) }, OWNER);
  assert.deepEqual(state.family.members.map((m) => [m.name, m.role]), [['owner', 'admin'], ['ป้า', 'viewer'], ['แม่', 'member']].sort((x, y) => (x[0] < y[0] ? -1 : 1)));

  a.fail('family.save', { id: a.familyId, name: mine.name, addUserId: 'u_made_up' }, OWNER, 'INVALID');
  a.fail('family.save', { id: a.familyId, name: mine.name, addUserId: strangerId }, OWNER, 'INVALID');
});

test('members can only be listed as addable to admins', () => {
  const a = seeded();
  invite(a, 'mom@example.com', 'แม่');
  assert.deepEqual(a.ok('state', {}, 'mom@example.com').state.family.addableUsers, []);
});

test('deleting a family needs an explicit confirmation once it holds data, then removes all of it', () => {
  const a = seeded();
  const other = a.ok('family.save', { name: 'บ้านคุณยาย', view: view(a) }, OWNER).state.family;
  addItem(a, a.me.id);
  addItem(a, a.me.id);
  invite(a, 'mom@example.com', 'แม่');

  const ask = a.fail('family.remove', { id: a.familyId }, OWNER, 'CONFIRM_REQUIRED');
  assert.deepEqual(ask.details, { items: 2, members: 2 });
  assert.equal(a.gas.rawRows('Items').length, 2);

  const { state } = a.ok('family.remove', { id: a.familyId, force: true, view: view(a) }, OWNER);
  assert.equal(state.family.id, other.id, 'falls back to the remaining family');
  assert.equal(a.gas.rawRows('Items').length, 0);
  assert.equal(a.gas.rawRows('Memberships').filter((m) => m.familyId === a.familyId).length, 0);
  assert.equal(a.gas.rawRows('Types').filter((t) => t.familyId === a.familyId).length, 0);
  assert.equal(a.gas.rawRows('Categories').filter((c) => c.familyId === a.familyId).length, 0);
  assert.equal(a.gas.rawRows('Families').length, 1);
  assert.equal(a.gas.rawRows('Types').length, 2, 'the other family keeps its own');
});

test('an empty family is deleted without a prompt, and deleting needs admin rights', () => {
  const a = seeded();
  invite(a, 'mom@example.com', 'แม่');
  a.fail('family.remove', { id: a.familyId, force: true }, 'mom@example.com', 'FORBIDDEN');
  const extra = a.ok('family.save', { name: 'ว่าง', view: view(a) }, OWNER).result.id;
  a.ok('family.remove', { id: extra, view: view(a) }, OWNER);
  assert.equal(a.gas.rawRows('Families').length, 1);
});

test('someone with no family left is shown an empty state they can start from', () => {
  const a = seeded();
  const { state } = a.ok('family.remove', { id: a.familyId, force: true, view: view(a) }, OWNER);
  assert.equal(state.family, null);
  assert.deepEqual(state.families, []);
  const made = a.ok('family.save', { name: 'เริ่มใหม่', view: {} }, OWNER).state;
  assert.equal(made.family.name, 'เริ่มใหม่');
});

// ---- users -----------------------------------------------------------------

test('adding a user by email creates the account and the membership', () => {
  const a = seeded();
  const { result, state } = a.ok('user.save', { familyId: a.familyId, email: ' Mew@Gmail.com ', name: 'น้องมิว', role: 'member', view: view(a) }, OWNER);
  const mew = state.family.members.find((m) => m.userId === result.id);
  assert.deepEqual({ name: mew.name, email: mew.email, role: mew.role, isMe: mew.isMe }, { name: 'น้องมิว', email: 'mew@gmail.com', role: 'member', isMe: false });
  assert.equal(a.gas.rawRows('Users').length, 2);
});

test('adding an existing account to another family reuses it', () => {
  const a = seeded();
  invite(a, 'mom@example.com', 'แม่');
  const gran = a.ok('family.save', { name: 'บ้านคุณยาย', view: view(a) }, OWNER).state.family;
  const { state } = a.ok('user.save', { familyId: gran.id, email: 'mom@example.com', name: 'ชื่ออื่น', role: 'admin', view: { familyId: gran.id } }, OWNER);
  assert.equal(a.gas.rawRows('Users').length, 2, 'no duplicate account');
  assert.deepEqual(state.family.members.map((m) => [m.name, m.role]).sort(), [['owner', 'admin'], ['แม่', 'admin']].sort());
});

test('duplicates, bad emails and bad roles are refused', () => {
  const a = seeded();
  invite(a, 'mom@example.com', 'แม่');
  const dup = a.fail('user.save', { familyId: a.familyId, email: 'MOM@example.com', name: 'x', role: 'member' }, OWNER, 'CONFLICT');
  assert.equal(dup.details.field, 'email');
  a.fail('user.save', { familyId: a.familyId, email: 'nope', name: 'x', role: 'member' }, OWNER, 'INVALID');
  a.fail('user.save', { familyId: a.familyId, email: 'a@b.co', name: '', role: 'member' }, OWNER, 'INVALID');
  a.fail('user.save', { familyId: a.familyId, email: 'a@b.co', name: 'x', role: 'boss' }, OWNER, 'INVALID');
});

test('only admins add users or change roles', () => {
  const a = seeded();
  const mom = invite(a, 'mom@example.com', 'แม่');
  a.fail('user.save', { familyId: a.familyId, email: 'new@example.com', name: 'x', role: 'member' }, 'mom@example.com', 'FORBIDDEN');
  a.fail('user.save', { familyId: a.familyId, userId: mom, name: 'แม่', email: 'mom@example.com', role: 'admin' }, 'mom@example.com', 'FORBIDDEN');
  a.fail('user.save', { familyId: a.familyId, userId: a.me.id, name: 'x' }, 'mom@example.com', 'FORBIDDEN');
});

test('anyone can rename themselves', () => {
  const a = seeded();
  const mom = invite(a, 'mom@example.com', 'แม่');
  const { state } = a.ok('user.save', { familyId: a.familyId, userId: mom, name: 'คุณแม่', email: 'mom@example.com', role: 'member', view: view(a) }, 'mom@example.com');
  assert.ok(state.family.members.some((m) => m.name === 'คุณแม่'));
});

test('a family always keeps at least one admin', () => {
  const a = seeded();
  const err = a.fail('user.save', { familyId: a.familyId, userId: a.me.id, name: 'owner', email: OWNER, role: 'member' }, OWNER, 'CONFLICT');
  assert.equal(err.details.field, 'role');
  const mom = invite(a, 'mom@example.com', 'แม่', 'admin');
  a.ok('user.save', { familyId: a.familyId, userId: a.me.id, name: 'owner', email: OWNER, role: 'member', view: view(a) }, OWNER);
  a.fail('user.remove', { familyId: a.familyId, userId: mom }, 'owner@example.com', 'FORBIDDEN');
});

test('email changes: not for yourself, not to a taken address, and not for people in several families', () => {
  const a = seeded();
  const mom = invite(a, 'mom@example.com', 'แม่');
  a.fail('user.save', { familyId: a.familyId, userId: a.me.id, name: 'owner', email: 'new@example.com', role: 'admin' }, OWNER, 'FORBIDDEN');
  a.fail('user.save', { familyId: a.familyId, userId: mom, name: 'แม่', email: OWNER, role: 'member' }, OWNER, 'CONFLICT');
  const { state } = a.ok('user.save', { familyId: a.familyId, userId: mom, name: 'แม่', email: 'mae@example.com', role: 'member', view: view(a) }, OWNER);
  assert.ok(state.family.members.some((m) => m.email === 'mae@example.com'));
  a.ok('state', {}, 'mae@example.com');
  a.fail('state', {}, 'mom@example.com', 'NOT_INVITED');

  const gran = a.ok('family.save', { name: 'บ้านคุณยาย', view: view(a) }, OWNER).state.family;
  a.ok('user.save', { familyId: gran.id, email: 'mae@example.com', name: 'แม่', role: 'member', view: { familyId: gran.id } }, OWNER);
  a.fail('user.save', { familyId: a.familyId, userId: mom, name: 'แม่', email: 'again@example.com', role: 'member' }, OWNER, 'FORBIDDEN');
});

test('removing a user who owns items asks who takes over, then keeps every item', () => {
  const a = seeded();
  const mom = invite(a, 'mom@example.com', 'แม่');
  addItem(a, mom, { name: 'ของแม่ 1' });
  addItem(a, mom, { name: 'ของแม่ 2' });
  addItem(a, a.me.id, { name: 'ของเรา' });

  const ask = a.fail('user.remove', { familyId: a.familyId, userId: mom }, OWNER, 'NEEDS_REASSIGN');
  assert.equal(ask.details.count, 2);
  a.fail('user.remove', { familyId: a.familyId, userId: mom, reassignToId: mom }, OWNER, 'INVALID');
  a.fail('user.remove', { familyId: a.familyId, userId: mom, reassignToId: 'u_nobody' }, OWNER, 'INVALID');

  const { result, state } = a.ok('user.remove', { familyId: a.familyId, userId: mom, reassignToId: a.me.id, view: view(a) }, OWNER);
  assert.equal(result.moved, 2);
  assert.deepEqual(state.family.members.map((m) => m.name), ['owner']);
  assert.deepEqual(a.gas.rawRows('Items').map((r) => r.ownerId), [a.me.id, a.me.id, a.me.id]);
  assert.equal(a.gas.rawRows('Users').length, 1, 'an account with no family left is deleted');
  a.fail('state', {}, 'mom@example.com', 'NOT_INVITED');
});

test('removing someone from one family keeps their account for the others', () => {
  const a = seeded();
  const mom = invite(a, 'mom@example.com', 'แม่');
  a.ok('family.save', { name: 'บ้านคุณยาย', view: view(a) }, 'mom@example.com');
  a.ok('user.remove', { familyId: a.familyId, userId: mom, view: view(a) }, OWNER);
  const { state } = a.ok('state', {}, 'mom@example.com');
  assert.deepEqual(state.families.map((f) => f.name), ['บ้านคุณยาย']);
});

test('you cannot remove yourself, and members cannot remove anyone', () => {
  const a = seeded();
  const mom = invite(a, 'mom@example.com', 'แม่');
  a.fail('user.remove', { familyId: a.familyId, userId: a.me.id }, OWNER, 'CONFLICT');
  a.fail('user.remove', { familyId: a.familyId, userId: a.me.id }, 'mom@example.com', 'FORBIDDEN');
  a.fail('user.remove', { familyId: a.familyId, userId: mom }, 'mom@example.com', 'FORBIDDEN');
});

test('per-person spending for the month is reported with the members', () => {
  const a = seeded();
  const mom = invite(a, 'mom@example.com', 'แม่');
  addItem(a, mom, { amount: 1240 });
  addItem(a, mom, { amount: 60, date: '2026-09-01' });
  addItem(a, a.me.id, { amount: 300, categoryId: a.cat('รายได้ประจำ').id });
  const members = a.ok('state', {}, OWNER).state.family.members;
  const by = Object.fromEntries(members.map((m) => [m.name, [m.expense, m.itemCount]]));
  assert.deepEqual(by, { owner: [0, 1], แม่: [1240, 2] });
});
