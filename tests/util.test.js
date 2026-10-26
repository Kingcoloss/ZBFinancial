'use strict';
const test = require('node:test');
const { app, assert } = require('./helpers');

const { gas } = app();
const u = (fn, ...args) => gas.invoke(`Util.${fn}`, ...args);
const fails = (fn, ...args) => {
  gas.context.__args = JSON.stringify(args);
  return gas.run(`(function(){ try { Util.${fn}.apply(null, JSON.parse(__args)); return null; } catch (e) { return JSON.stringify({ code: e.code, message: e.message, field: e.details && e.details.field }); } })()`);
};

test('baht formats with thousands separators and drops empty decimals', () => {
  assert.equal(u('baht', 0), '0');
  assert.equal(u('baht', 1240), '1,240');
  assert.equal(u('baht', 1234567.5), '1,234,567.50');
  assert.equal(u('baht', -350), '-350');
  assert.equal(u('baht', 0.1 + 0.2), '0.30');
});

test('money accepts what people type and rejects what cannot be an amount', () => {
  assert.equal(u('money', '1,240.50'), 1240.5);
  assert.equal(u('money', ' 350 '), 350);
  assert.equal(u('money', 12), 12);
  for (const bad of ['', 'abc', '0', '-5', 0, -1, null, '1e999', 1e12]) {
    assert.match(fails('money', bad) || '', /"field":"amount"/, String(bad));
  }
});

test('isDate checks the real calendar', () => {
  assert.equal(u('isDate', '2026-10-25'), true);
  assert.equal(u('isDate', '2024-02-29'), true);
  for (const bad of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-1-1', '', '25/10/2026', null]) {
    assert.equal(u('isDate', bad), false, String(bad));
  }
});

test('months: arithmetic and Thai labels use the Buddhist year', () => {
  assert.equal(u('addMonths', '2026-01', -1), '2025-12');
  assert.equal(u('addMonths', '2026-12', 1), '2027-01');
  assert.equal(u('addMonths', '2026-10', -23), '2024-11');
  assert.equal(u('monthLabel', '2026-10'), 'ต.ค. 2569');
  assert.equal(u('monthShort', '2026-01'), 'ม.ค.');
});

test('text trims, collapses whitespace and control characters, and enforces limits', () => {
  assert.equal(u('text', '  ก๋วยเตี๋ยว \n\t เส้นเล็ก ', 'ชื่อ', 'name', 80), 'ก๋วยเตี๋ยว เส้นเล็ก');
  assert.match(fails('text', '   ', 'ชื่อรายการ', 'name', 80), /กรุณาใส่ชื่อรายการ/);
  assert.match(fails('text', 'x'.repeat(81), 'ชื่อรายการ', 'name', 80), /ไม่เกิน 80/);
});

test('email is normalised and validated', () => {
  assert.equal(u('email', '  Mew@Gmail.COM '), 'mew@gmail.com');
  for (const bad of ['', 'mew', 'mew@', '@gmail.com', 'a b@c.com']) {
    assert.match(fails('email', bad) || '', /"field":"email"/, bad);
  }
});

test('cellDate understands both text and Date cells (a person may retype a date in the Sheet)', () => {
  assert.equal(u('cellDate', '2026-10-25'), '2026-10-25');
  assert.equal(u('cellDate', '2026-10-25T00:00:00.000Z'), '2026-10-25');
  assert.equal(u('cellDate', 'soon'), '');
  assert.equal(gas.run("Util.cellDate(new Date('2026-10-24T18:00:00Z'))"), '2026-10-25', 'time zone Asia/Bangkok');
});
