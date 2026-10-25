'use strict';
/**
 * A small in-memory stand-in for the Apps Script runtime (SpreadsheetApp, Session, LockService, ...)
 * that loads the real files in src/*.gs into one sandbox. Used by the unit tests and by the local
 * preview server so the exact production code runs against a fake workbook.
 *
 * The fake sheet keeps the behaviours that bite in real Sheets: bounded row count, values typed by
 * the cell number format ('@' keeps text, otherwise "=1+1" becomes a formula, "007" a number and
 * "2026-10-25" a Date), and range dimension checks.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const SRC = path.join(__dirname, '..', 'src');

class MockRange {
  constructor(sheet, row, col, rows, cols) {
    const inside = row >= 1 && col >= 1 && rows >= 1 && cols >= 1 &&
      row + rows - 1 <= sheet.maxRows && col + cols - 1 <= sheet.maxColumns;
    if (!inside) throw new Error('The coordinates or dimensions of the range are invalid.');
    Object.assign(this, { sheet, row, col, rows, cols });
  }

  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const line = [];
      for (let c = 0; c < this.cols; c++) line.push(this.sheet.read(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }

  setValues(values) {
    if (values.length !== this.rows || values.some((v) => v.length !== this.cols)) {
      throw new Error('The number of rows or columns in the data does not match the range.');
    }
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.write(this.row + r, this.col + c, v)));
    return this;
  }

  setNumberFormats(formats) {
    formats.forEach((line, r) => line.forEach((f, c) => this.sheet.formatOf.set(`${this.row + r}:${this.col + c}`, f)));
    return this;
  }

  setFontWeight() { return this; }
  setBackground() { return this; }
}

class MockSheet {
  constructor(name) {
    this.name = name;
    this.maxRows = 1000;
    this.maxColumns = 26;
    this.grid = new Map();
    this.formatOf = new Map();
    this.frozen = 0;
    this.writes = 0;
  }

  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxColumns; }
  setFrozenRows(n) { this.frozen = n; }
  setColumnWidth() {}

  read(r, c) {
    const v = this.grid.get(`${r}:${c}`);
    return v === undefined ? '' : v;
  }

  write(r, c, v) {
    this.writes++;
    const key = `${r}:${c}`;
    const fmt = this.formatOf.get(key);
    let stored = v;
    if (typeof v === 'string' && fmt !== '@') {
      if (v.startsWith('=')) stored = '#NAME?';
      else if (v.trim() !== '' && !Number.isNaN(Number(v))) stored = Number(v);
      else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) stored = new Date(`${v}T00:00:00+07:00`);
    }
    if (stored === '' || stored === null || stored === undefined) this.grid.delete(key);
    else this.grid.set(key, stored);
  }

  getLastRow() {
    let last = 0;
    for (const key of this.grid.keys()) last = Math.max(last, Number(key.split(':')[0]));
    return last;
  }

  getRange(row, col, rows = 1, cols = 1) { return new MockRange(this, row, col, rows, cols); }

  insertRowsAfter(after, n) {
    if (after > this.maxRows) throw new Error('Invalid row position.');
    this.maxRows += n;
  }

  deleteRows(start, count) {
    if (start < 1 || start + count - 1 > this.maxRows) throw new Error('Invalid rows to delete.');
    if (this.frozen && start <= this.frozen && start + count - 1 >= this.maxRows) {
      throw new Error("You can't delete all the non-frozen rows on a sheet.");
    }
    const moved = new Map();
    for (const [key, v] of this.grid) {
      const [r, c] = key.split(':').map(Number);
      if (r >= start && r < start + count) continue;
      moved.set(`${r >= start + count ? r - count : r}:${c}`, v);
    }
    const movedFmt = new Map();
    for (const [key, v] of this.formatOf) {
      const [r, c] = key.split(':').map(Number);
      if (r >= start && r < start + count) continue;
      movedFmt.set(`${r >= start + count ? r - count : r}:${c}`, v);
    }
    this.grid = moved;
    this.formatOf = movedFmt;
    this.maxRows -= count;
  }
}

class MockSpreadsheet {
  constructor(title) {
    this.id = `mock-${crypto.randomUUID()}`;
    this.title = title;
    this.sheets = [new MockSheet('Sheet1')];
  }

  getId() { return this.id; }
  getUrl() { return `https://docs.google.com/spreadsheets/d/${this.id}/edit`; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
  insertSheet(name) { const s = new MockSheet(name); this.sheets.push(s); return s; }
  deleteSheet(sheet) {
    if (this.sheets.length === 1) throw new Error("You can't delete the only sheet.");
    this.sheets = this.sheets.filter((s) => s !== sheet);
  }
}

function pad(n) { return String(n).padStart(2, '0'); }

function formatDate(date, tz, fmt) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  return fmt
    .replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
    .replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
}

/**
 * @param {Object} [options]
 * @param {string} [options.email]   signed-in Google account ('' = unknown)
 * @param {string} [options.now]     ISO timestamp the app should treat as "now"
 * @param {boolean} [options.bound]  true = the script is bound to a spreadsheet
 */
function createGas(options = {}) {
  const env = {
    email: options.email ?? 'owner@example.com',
    now: options.now || '2026-10-25T04:30:00Z',
    props: new Map(),
    lockHeld: false,
    locks: 0,
    spreadsheets: new Map(),
    bound: null,
    errors: []
  };
  if (options.bound) {
    env.bound = new MockSpreadsheet('bound');
    env.spreadsheets.set(env.bound.getId(), env.bound);
  }

  const props = {
    getProperty: (k) => (env.props.has(k) ? env.props.get(k) : null),
    setProperty: (k, v) => { env.props.set(k, String(v)); }
  };

  const sandbox = {
    console: { log() {}, error: (...a) => env.errors.push(a.join(' ')), warn() {} },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, f) => formatDate(d, tz, f)
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => env.email }),
      getEffectiveUser: () => ({ getEmail: () => env.email }),
      getScriptTimeZone: () => 'Asia/Bangkok'
    },
    PropertiesService: { getScriptProperties: () => props },
    LockService: {
      getScriptLock: () => ({
        waitLock() {
          if (env.lockHeld) throw new Error('Lock timeout');
          env.lockHeld = true;
          env.locks++;
        },
        releaseLock() { env.lockHeld = false; }
      })
    },
    SpreadsheetApp: {
      create: (title) => {
        const ss = new MockSpreadsheet(title);
        env.spreadsheets.set(ss.getId(), ss);
        return ss;
      },
      openById: (id) => {
        const ss = env.spreadsheets.get(id);
        if (!ss) throw new Error('No access to spreadsheet');
        return ss;
      },
      getActiveSpreadsheet: () => env.bound,
      flush: () => {}
    },
    HtmlService: {
      createHtmlOutputFromFile: (name) => ({ getContent: () => fs.readFileSync(path.join(SRC, `${name}.html`), 'utf8') }),
      createTemplateFromFile: (name) => ({
        evaluate: () => {
          const render = (n) => fs.readFileSync(path.join(SRC, `${n}.html`), 'utf8')
            .replace(/<\?!= include_\('(\w+)'\) \?>/g, (_, inc) => render(inc));
          const out = { title: '', meta: {}, content: render(name) };
          out.setTitle = (t) => { out.title = t; return out; };
          out.addMetaTag = (k, v) => { out.meta[k] = v; return out; };
          out.getContent = () => out.content;
          return out;
        }
      })
    }
  };

  const context = vm.createContext(sandbox);
  for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), context, { filename: `src/${file}` });
  }
  vm.runInContext('Util.clock = function () { return new Date(__now()); };', Object.assign(context, { __now: () => env.now }));

  const run = (code) => vm.runInContext(code, context);

  return {
    env,
    context,
    /** Evaluate an expression inside the sandbox (e.g. "Db.TABLES"). */
    run,
    /** Call api() as `email` and return the response exactly as the browser would see it (JSON). */
    request(action, payload = {}, email) {
      if (email !== undefined) env.email = email;
      context.__args = JSON.stringify([action, payload]);
      const out = run('JSON.stringify(api.apply(null, JSON.parse(__args)))');
      return JSON.parse(out);
    },
    /** Call a sandbox function by expression with JSON arguments, e.g. invoke('Util.baht', 1234.5). */
    invoke(fn, ...args) {
      context.__args = JSON.stringify(args);
      const out = run(`JSON.stringify(${fn}.apply(null, JSON.parse(__args)))`);
      return out === undefined ? undefined : JSON.parse(out);
    },
    /** Rows of a tab as plain objects, read straight from the fake sheet (bypasses the app). */
    rawRows(tab) {
      const ss = env.spreadsheets.get(env.props.get('SPREADSHEET_ID'));
      const sh = ss.getSheetByName(tab);
      const last = sh.getLastRow();
      if (!last) return [];
      const values = sh.getRange(1, 1, last, JSON.parse(run('JSON.stringify(Db.SCHEMA)'))[tab].length).getValues();
      const [head, ...rows] = values;
      return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
    },
    spreadsheet() { return env.spreadsheets.get(env.props.get('SPREADSHEET_ID')); }
  };
}

module.exports = { createGas, MockSpreadsheet, MockSheet, pad };
