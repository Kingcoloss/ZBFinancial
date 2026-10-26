'use strict';
const test = require('node:test');
const { app, seeded, assert } = require('./helpers');

const failed = (report) => report.checks.filter((c) => !c.ok);
const byName = (report, text) => report.checks.find((c) => c.name.includes(text));

/** Calls doGet the way Google does and returns the output object. */
function get(gas, parameter) {
  gas.context.__e = { parameter: parameter || {} };
  return gas.run('doGet(__e)');
}

/** Makes one HTML file unreadable, as if it was never added to the Apps Script project. */
function loseFile(gas, name) {
  const html = gas.context.HtmlService;
  const real = html.createHtmlOutputFromFile;
  html.createHtmlOutputFromFile = (n) => {
    if (n === name) throw new Error(`No HTML file named ${n} was found.`);
    return real(n);
  };
}

test('doGet serves the app', () => {
  const { gas } = app();
  const out = get(gas);
  assert.equal(out.title, 'ZBFinancial');
  assert.match(out.meta.viewport, /width=device-width/);
  assert.match(out.getContent(), /window\.ZB/);
  assert.doesNotMatch(out.getContent(), /<\?!=/, 'every include was expanded');
});

test('doGet shows the real reason when the page cannot be built, with the message escaped', () => {
  const { gas } = app();
  loseFile(gas, 'JsMain');
  const html = get(gas).getContent();
  assert.match(html, /เปิดหน้าแอปไม่สำเร็จ/);
  assert.match(html, /No HTML file named JsMain was found\./);
  assert.match(html, /diag=1/);

  gas.context.HtmlService.createHtmlOutputFromFile = () => { throw new Error('<script>alert(1)</script>'); };
  const escaped = get(gas).getContent();
  assert.doesNotMatch(escaped, /<script>alert/);
  assert.match(escaped, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('diagnose passes every check on a healthy install', () => {
  const { gas, ok } = app({ email: 'owner@example.com' });
  gas.invoke('setup');
  const report = gas.invoke('diagnose');
  assert.deepEqual(failed(report), []);
  assert.equal(report.ok, true);
  assert.equal(byName(report, 'อีเมล Google').detail, 'owner@example.com');
  assert.match(byName(report, 'Users').detail, /1 แถว/);
  assert.equal(report.checks.length, 6 + 1 + 1 + 1 + 6 + 1, 'files, template, identity, sheet, six tabs, registration');
  ok('state', {});
});

test('diagnose before setup says to run setup, and does not build anything itself', () => {
  const { gas } = app();
  const report = gas.invoke('diagnose');
  assert.equal(report.ok, false);
  const sheet = byName(report, 'Google Sheet');
  assert.equal(sheet.ok, false);
  assert.match(sheet.detail, /setup/);
  assert.equal(report.checks.some((c) => c.name.startsWith('แท็บ')), false, 'tabs are not checked without a sheet');
  assert.equal(gas.env.spreadsheets.size, 0, 'a check never creates the workbook');
  assert.equal(gas.env.props.size, 0, 'nor any script property');
});

test('diagnose is read-only on an existing workbook', () => {
  const { gas } = app();
  gas.invoke('setup');
  const before = JSON.stringify(['Users', 'Families', 'Memberships', 'Types', 'Categories', 'Items'].map((t) => gas.rawRows(t)));
  gas.invoke('diagnose');
  gas.invoke('diagnose');
  const after = JSON.stringify(['Users', 'Families', 'Memberships', 'Types', 'Categories', 'Items'].map((t) => gas.rawRows(t)));
  assert.equal(after, before);
});

test('diagnose names a tampered header column', () => {
  const { gas } = app();
  gas.invoke('setup');
  gas.spreadsheet().getSheetByName('Items').getRange(1, 6, 1, 1).setValues([['money']]);
  const report = gas.invoke('diagnose');
  const items = byName(report, 'แท็บ Items');
  assert.equal(items.ok, false);
  assert.match(items.detail, /amount/);
  assert.match(items.detail, /money/);
  assert.equal(byName(report, 'แท็บ Users').ok, true, 'the other tabs still pass');
  assert.equal(report.checks.some((c) => c.name.includes('ลงทะเบียน')), false, 'registration is skipped while tabs are broken');
});

test('diagnose reports a missing tab', () => {
  const { gas } = app();
  gas.invoke('setup');
  const ss = gas.spreadsheet();
  ss.deleteSheet(ss.getSheetByName('Memberships'));
  const memberships = byName(gas.invoke('diagnose'), 'แท็บ Memberships');
  assert.equal(memberships.ok, false);
  assert.match(memberships.detail, /ไม่มีแท็บ Memberships/);
});

test('diagnose reports a sheet the account cannot open', () => {
  const { gas } = app();
  gas.invoke('setup');
  gas.env.spreadsheets.clear();
  const sheet = byName(gas.invoke('diagnose'), 'Google Sheet');
  assert.equal(sheet.ok, false);
  assert.match(sheet.detail, /No access/);
});

test('diagnose tells a signed-in stranger they are not in Users', () => {
  const { gas } = app({ email: 'owner@example.com' });
  gas.invoke('setup');
  gas.env.email = 'someone@example.com';
  const report = gas.invoke('diagnose');
  const reg = byName(report, 'ลงทะเบียน');
  assert.equal(reg.ok, false);
  assert.match(reg.detail, /someone@example\.com/);
  assert.equal(report.ok, false);
});

test('diagnose explains an empty email', () => {
  const { gas } = app({ email: '' });
  gas.invoke('setup');
  const report = gas.invoke('diagnose');
  const who = byName(report, 'อีเมล Google');
  assert.equal(who.ok, false);
  assert.match(who.detail, /User accessing the web app/);
  assert.equal(report.checks.some((c) => c.name.includes('ลงทะเบียน')), false);
});

test('diagnose finds a file missing from the Apps Script project', () => {
  const { gas } = app();
  gas.invoke('setup');
  loseFile(gas, 'JsViews');
  const report = gas.invoke('diagnose');
  assert.equal(byName(report, 'ไฟล์หน้าเว็บ JsViews').ok, false);
  assert.equal(byName(report, 'ไฟล์หน้าเว็บ JsCore').ok, true);
  assert.equal(byName(report, 'ประกอบหน้า Index').ok, false);
});

test('?diag=1 shows the checklist as a page, with ticks and crosses', () => {
  const { gas } = app({ email: 'owner@example.com' });
  const before = get(gas, { diag: '1' }).getContent();
  assert.match(before, /ตรวจระบบ ZBFinancial/);
  assert.match(before, /✗/);
  assert.match(before, /setup/);

  gas.invoke('setup');
  const healthy = get(gas, { diag: '1' }).getContent();
  assert.doesNotMatch(healthy, /✗/);
  assert.match(healthy, /ทุกข้อผ่าน/);
  assert.match(healthy, /owner@example\.com/);
});

test('the diagnostic page never reveals data from the sheet beyond the signed-in email', () => {
  const a = seeded({ email: 'owner@example.com' });
  a.ok('item.save', {
    familyId: a.familyId, name: 'secret-lunch', amount: 99, date: '2026-10-25',
    categoryId: a.cat('เดินทาง').id, ownerId: a.me.id, view: { familyId: a.familyId }
  });
  const html = get(a.gas, { diag: '1' }).getContent();
  assert.match(html, /owner@example\.com/);
  assert.doesNotMatch(html, /secret-lunch/);
});
