'use strict';
const test = require('node:test');
const { app, assert } = require('./helpers');

const HEADERS = {
  Users: ['id', 'email', 'name', 'createdAt', 'updatedAt'],
  Families: ['id', 'name', 'createdAt', 'updatedAt'],
  Memberships: ['id', 'familyId', 'userId', 'role', 'createdAt'],
  Types: ['id', 'familyId', 'name', 'kind', 'createdAt', 'updatedAt'],
  Categories: ['id', 'familyId', 'typeId', 'name', 'createdAt', 'updatedAt'],
  Statuses: ['id', 'familyId', 'name', 'counted', 'createdAt', 'updatedAt', 'cancelled'],
  Items: ['id', 'familyId', 'categoryId', 'ownerId', 'name', 'amount', 'date', 'createdAt', 'updatedAt', 'statusId']
};

const headerOf = (sheet, n) => sheet.getRange(1, 1, 1, n).getValues()[0];

test('setup() builds the workbook with every tab and header, and registers the person running it', () => {
  const { gas } = app({ email: 'Owner@Example.com' });
  const summary = gas.invoke('setup');

  assert.equal(summary.workbookCreated, true);
  assert.deepEqual(summary.tabs, Object.keys(HEADERS));
  assert.equal(summary.adminRegistered, 'owner@example.com');

  const ss = gas.spreadsheet();
  assert.deepEqual(ss.getSheets().map((s) => s.getName()), Object.keys(HEADERS), 'default Sheet1 is removed');
  for (const [tab, head] of Object.entries(HEADERS)) {
    const sheet = ss.getSheetByName(tab);
    assert.deepEqual(headerOf(sheet, head.length), head, tab);
    assert.equal(sheet.frozen, 1, `${tab} header row is frozen`);
  }

  assert.equal(gas.env.props.get('SPREADSHEET_ID'), ss.getId());
  assert.equal(gas.env.props.get('OWNER_EMAIL'), 'owner@example.com');
  assert.equal(gas.rawRows('Users').length, 1);
  assert.equal(gas.rawRows('Families').length, 1);
  assert.equal(gas.rawRows('Types').length, 2);
  assert.equal(gas.rawRows('Categories').length, 8);
});

test('setup() can be run again without duplicating anything', () => {
  const { gas } = app();
  const first = gas.invoke('setup');
  const again = gas.invoke('setup');
  assert.equal(again.spreadsheetId, first.spreadsheetId);
  assert.equal(again.workbookCreated, false);
  assert.equal(again.adminRegistered, null);
  assert.equal(gas.env.spreadsheets.size, 1);
  assert.equal(gas.rawRows('Users').length, 1);
  assert.equal(gas.rawRows('Types').length, 2);
});

test('a script bound to a spreadsheet uses it instead of creating a new workbook', () => {
  const { gas } = app({ bound: true });
  const summary = gas.invoke('setup');
  assert.equal(summary.workbookCreated, false);
  assert.equal(summary.spreadsheetId, gas.env.bound.getId());
  assert.ok(gas.env.bound.getSheetByName('Sheet1'), "someone else's tabs are never deleted");
  assert.ok(gas.env.bound.getSheetByName('Items'));
  assert.equal(gas.env.spreadsheets.size, 1);
});

test('the first request builds the workbook on its own when setup() was never run', () => {
  const { gas, ok } = app();
  assert.equal(gas.env.spreadsheets.size, 0);
  const { state } = ok('state', {});
  assert.equal(gas.env.spreadsheets.size, 1);
  assert.equal(state.family.types.length, 2);
  assert.equal(state.meta.sheetUrl, gas.spreadsheet().getUrl());
});

test('a deleted tab is recreated with its header the next time it is needed', () => {
  const { gas, ok } = app();
  ok('state', {});
  const ss = gas.spreadsheet();
  ss.deleteSheet(ss.getSheetByName('Items'));
  ok('state', {});
  assert.deepEqual(headerOf(ss.getSheetByName('Items'), 10), HEADERS.Items);
});

test('a tampered header is reported clearly instead of corrupting data', () => {
  const { gas, fail, ok } = app();
  ok('state', {});
  gas.spreadsheet().getSheetByName('Items').getRange(1, 6, 1, 1).setValues([['money']]);
  const err = fail('state', {}, undefined, 'SCHEMA_MISMATCH');
  assert.match(err.message, /Items/);
  assert.match(err.message, /amount/);
});

test('an unreachable workbook explains what to do', () => {
  const { gas, fail, ok } = app();
  ok('state', {});
  gas.env.spreadsheets.clear();
  fail('state', {}, undefined, 'SHEET_UNAVAILABLE');
});
