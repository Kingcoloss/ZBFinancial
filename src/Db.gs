/**
 * Google Sheet as database.
 *
 * One tab per table, row 1 = header. Reads are cached per execution (Apps Script starts every
 * execution with fresh globals), writes invalidate the cache. All writes must run inside
 * Db.withLock so two people saving at once cannot interleave.
 *
 * Text cells are always written with the plain-text format ('@') so a name such as "=1+1" or
 * "007" stays exactly what was typed and can never run as a formula.
 */
var Db = {
  TITLE: 'ZBFinancial · ข้อมูลครอบครัว',

  /** [column, type] with type s = text, n = number, d = date (text yyyy-MM-dd), b = yes/no (text TRUE / FALSE). */
  SCHEMA: {
    Users: [['id', 's'], ['email', 's'], ['name', 's'], ['createdAt', 's'], ['updatedAt', 's']],
    Families: [['id', 's'], ['name', 's'], ['createdAt', 's'], ['updatedAt', 's']],
    Memberships: [['id', 's'], ['familyId', 's'], ['userId', 's'], ['role', 's'], ['createdAt', 's']],
    Types: [['id', 's'], ['familyId', 's'], ['name', 's'], ['kind', 's'], ['createdAt', 's'], ['updatedAt', 's']],
    Categories: [['id', 's'], ['familyId', 's'], ['typeId', 's'], ['name', 's'], ['createdAt', 's'], ['updatedAt', 's']],
    Statuses: [['id', 's'], ['familyId', 's'], ['name', 's'], ['counted', 'b'], ['createdAt', 's'], ['updatedAt', 's']],
    Items: [
      ['id', 's'], ['familyId', 's'], ['categoryId', 's'], ['ownerId', 's'], ['name', 's'],
      ['amount', 'n'], ['date', 'd'], ['createdAt', 's'], ['updatedAt', 's'], ['statusId', 's']
    ]
  },
  TABLES: ['Users', 'Families', 'Memberships', 'Types', 'Categories', 'Statuses', 'Items'],

  /**
   * Columns that were added to a table after its first release. A Sheet made by an older version
   * has only the first `from` columns; the first time such a table is read, `run` fills in the new
   * ones (under the lock) so nobody has to edit the Sheet by hand. `run(sheet, lastRow)`.
   */
  UPGRADES: {
    Items: { from: 9, run: function (sh, lastRow) { Statuses.upgradeItems_(sh, lastRow); } }
  },

  ss_: null,
  createdWorkbook_: false,
  tables_: {},
  lockDepth_: 0,

  /** Forget everything cached; called at the start of each request. */
  reset: function () {
    Db.ss_ = null;
    Db.createdWorkbook_ = false;
    Db.tables_ = {};
    Db.lockDepth_ = 0;
  },

  /**
   * The workbook that holds the data. Order: Script Property SPREADSHEET_ID, the spreadsheet this
   * script is bound to, otherwise a brand new workbook is created and remembered.
   */
  spreadsheet: function () {
    if (Db.ss_) return Db.ss_;
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty('SPREADSHEET_ID');
    var ss = null;
    if (id) {
      try {
        ss = SpreadsheetApp.openById(id);
      } catch (e) {
        throw AppError(
          'SHEET_UNAVAILABLE',
          'เปิด Google Sheet ของระบบไม่ได้ กรุณาให้เจ้าของไฟล์แชร์สิทธิ์แก้ไขให้บัญชีนี้ก่อน'
        );
      }
    } else {
      ss = Db.withLock(function () {
        var again = props.getProperty('SPREADSHEET_ID');
        if (again) return SpreadsheetApp.openById(again);
        var bound = null;
        try {
          bound = SpreadsheetApp.getActiveSpreadsheet();
        } catch (e) {
          bound = null;
        }
        var made = bound || SpreadsheetApp.create(Db.TITLE);
        Db.createdWorkbook_ = !bound;
        props.setProperty('SPREADSHEET_ID', made.getId());
        return made;
      });
    }
    Db.ss_ = ss;
    return ss;
  },

  /** Creates every tab with its header (idempotent) and tidies a freshly created workbook. */
  ensureAll: function () {
    var ss = Db.spreadsheet();
    Db.TABLES.forEach(function (name) {
      Db.table(name).load_();
    });
    if (Db.createdWorkbook_) {
      ss.getSheets().forEach(function (sh) {
        if (Db.SCHEMA[sh.getName()] === undefined && sh.getLastRow() === 0 && ss.getSheets().length > 1) {
          ss.deleteSheet(sh);
        }
      });
    }
    return ss;
  },

  table: function (name) {
    if (!Db.tables_[name]) Db.tables_[name] = Db.makeTable_(name);
    return Db.tables_[name];
  },

  /** Runs fn while holding the script lock; nested calls just run fn. */
  withLock: function (fn) {
    if (Db.lockDepth_ > 0) return fn();
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(20000);
    } catch (e) {
      throw AppError('BUSY', 'ระบบกำลังบันทึกข้อมูลของคนอื่นอยู่ กรุณารอสักครู่แล้วลองใหม่');
    }
    Db.lockDepth_++;
    // Someone else may have written since we last read: drop cached rows, keep the table objects.
    Object.keys(Db.tables_).forEach(function (k) {
      Db.tables_[k].rows = null;
    });
    try {
      return fn();
    } finally {
      Db.lockDepth_--;
      try {
        SpreadsheetApp.flush();
      } finally {
        lock.releaseLock();
      }
    }
  },

  formats_: function (cols) {
    return cols.map(function (c) {
      return c[1] === 'n' ? '#,##0.00' : '@';
    });
  },

  toCell_: function (type, v) {
    if (type === 'n') return Number(v) || 0;
    if (type === 'd') return Util.cellDate(v);
    if (type === 'b') return v ? 'TRUE' : 'FALSE';
    return v == null ? '' : String(v);
  },

  /** A yes/no cell: a real checkbox value, or text a person typed (TRUE, yes, y, 1). */
  isYes_: function (v) {
    return v === true || ['TRUE', 'YES', 'Y', '1'].indexOf(String(v == null ? '' : v).trim().toUpperCase()) >= 0;
  },

  fromCell_: function (type, v) {
    if (type === 'n') return Number(v) || 0;
    if (type === 'd') return Util.cellDate(v);
    if (type === 'b') return Db.isYes_(v);
    return v == null ? '' : String(v);
  },

  makeTable_: function (name) {
    var cols = Db.SCHEMA[name];
    if (!cols) throw new Error('Unknown table ' + name);
    var width = cols.length;
    var formats = Db.formats_(cols);
    var t = { name: name, sheet: null, rows: null };

    function sheet() {
      if (t.sheet) return t.sheet;
      var ss = Db.spreadsheet();
      var sh = ss.getSheetByName(name);
      if (!sh) {
        sh = Db.withLock(function () {
          return ss.getSheetByName(name) || ss.insertSheet(name);
        });
      }
      t.sheet = sh;
      return sh;
    }

    function writeHeader(sh) {
      var head = sh.getRange(1, 1, 1, width);
      head.setNumberFormats([cols.map(function () { return '@'; })]);
      head.setValues([cols.map(function (c) { return c[0]; })]);
      head.setFontWeight('bold');
      head.setBackground('#E5E7EB');
      sh.setFrozenRows(1);
      cols.forEach(function (c, i) {
        if (c[0] === 'id') sh.setColumnWidth(i + 1, 130);
      });
    }

    function checkHeader(header) {
      var up = Db.UPGRADES[name];
      for (var i = 0; i < width; i++) {
        if (String(header[i]) !== cols[i][0]) {
          if (up && i >= up.from) {
            throw AppError(
              'SCHEMA_MISMATCH',
              'แท็บ ' + name + ' ต้องใช้คอลัมน์ที่ ' + (i + 1) + ' เก็บ "' + cols[i][0] + '" แต่มีข้อมูลอื่นอยู่ ' +
                'กรุณาย้ายคอลัมน์ที่คุณเพิ่มเองไปทางขวาของคอลัมน์ที่ ' + width + ' แล้วเปิดแอปอีกครั้ง'
            );
          }
          throw AppError(
            'SCHEMA_MISMATCH',
            'แท็บ ' + name + ' ใน Google Sheet มีหัวคอลัมน์ไม่ตรงกับระบบ (คอลัมน์ที่ ' + (i + 1) +
              ' ควรเป็น "' + cols[i][0] + '") กรุณาอย่าแก้แถวแรก'
          );
        }
      }
    }

    function toRecord(row) {
      var rec = {};
      for (var i = 0; i < width; i++) rec[cols[i][0]] = Db.fromCell_(cols[i][1], row[i]);
      return rec;
    }

    function toRow(rec) {
      return cols.map(function (c) {
        return Db.toCell_(c[1], rec[c[0]]);
      });
    }

    /** An older Sheet: header matches the first `from` columns and the columns after them are empty. */
    function isLegacy(values) {
      var up = Db.UPGRADES[name];
      if (!up || !values.length) return false;
      for (var i = 0; i < up.from; i++) {
        if (String(values[0][i]) !== cols[i][0]) return false;
      }
      return values.every(function (row) {
        for (var j = up.from; j < width; j++) {
          if (row[j] !== '' && row[j] !== null) return false;
        }
        return true;
      });
    }

    function load() {
      if (t.rows) return t.rows;
      var sh = sheet();
      var last = sh.getLastRow();
      var rows = [];
      if (last === 0) {
        Db.withLock(function () {
          if (sh.getLastRow() === 0) writeHeader(sh);
        });
      } else {
        if (sh.getMaxColumns() < width) {
          Db.withLock(function () {
            var max = sh.getMaxColumns();
            if (max < width) sh.insertColumnsAfter(max, width - max);
          });
        }
        var values = sh.getRange(1, 1, last, width).getValues();
        if (isLegacy(values)) {
          Db.withLock(function () {
            // Someone else may have upgraded while we waited for the lock.
            var now = sh.getLastRow();
            if (isLegacy(sh.getRange(1, 1, now, width).getValues())) Db.UPGRADES[name].run(sh, now);
          });
          last = sh.getLastRow();
          values = sh.getRange(1, 1, last, width).getValues();
        }
        checkHeader(values[0]);
        for (var i = 1; i < values.length; i++) {
          var row = values[i];
          var blank = row.every(function (v) { return v === '' || v === null; });
          if (!blank) rows.push({ rec: toRecord(row), row: i + 1 });
        }
      }
      t.rows = rows;
      return rows;
    }

    function ensureRows(sh, upTo) {
      var max = sh.getMaxRows();
      if (upTo > max) sh.insertRowsAfter(max, Math.max(upTo - max, 200));
    }

    function writeRow(sh, rowNumber, rec) {
      var range = sh.getRange(rowNumber, 1, 1, width);
      range.setNumberFormats([formats]);
      range.setValues([toRow(rec)]);
    }

    function stamp(rec, isNew) {
      var now = Util.nowISO();
      if ('createdAt' in rec && isNew && !rec.createdAt) rec.createdAt = now;
      if ('updatedAt' in rec) rec.updatedAt = now;
    }

    function blankRecord() {
      var rec = {};
      cols.forEach(function (c) { rec[c[0]] = c[1] === 'n' ? 0 : c[1] === 'b' ? false : ''; });
      return rec;
    }

    t.load_ = load;

    t.all = function () {
      return load().map(function (e) { return Object.assign({}, e.rec); });
    };

    t.where = function (pred) {
      return load().filter(function (e) { return pred(e.rec); }).map(function (e) { return Object.assign({}, e.rec); });
    };

    t.get = function (id) {
      var hit = load().filter(function (e) { return e.rec.id === id; })[0];
      return hit ? Object.assign({}, hit.rec) : null;
    };

    t.count = function (pred) {
      return load().filter(function (e) { return pred(e.rec); }).length;
    };

    /** Adds one or many records; ids and timestamps are filled in. Returns the stored records. */
    t.insert = function (input) {
      var list = Array.isArray(input) ? input : [input];
      if (!list.length) return [];
      var sh = sheet();
      var taken = {};
      load().forEach(function (e) { taken[e.rec.id] = true; });
      var recs = list.map(function (r) {
        var rec = Object.assign(blankRecord(), r);
        if (!rec.id) {
          do { rec.id = Util.newId(name.charAt(0).toLowerCase()); } while (taken[rec.id]);
        }
        taken[rec.id] = true;
        stamp(rec, true);
        return rec;
      });
      var first = Math.max(sh.getLastRow(), 1) + 1;
      ensureRows(sh, first + recs.length - 1);
      var range = sh.getRange(first, 1, recs.length, width);
      range.setNumberFormats(recs.map(function () { return formats; }));
      range.setValues(recs.map(toRow));
      t.rows = null;
      return recs;
    };

    t.update = function (id, patch) {
      var hit = load().filter(function (e) { return e.rec.id === id; })[0];
      if (!hit) throw AppError('NOT_FOUND', 'ไม่พบข้อมูลที่ต้องการแก้ไข อาจถูกลบไปแล้ว ลองโหลดหน้าใหม่');
      var rec = Object.assign({}, hit.rec, patch, { id: id });
      stamp(rec, false);
      writeRow(sheet(), hit.row, rec);
      t.rows = null;
      return rec;
    };

    /** Sets one column to the same value on every row matching pred, in a single write. */
    t.setColumnWhere = function (pred, column, value) {
      var idx = -1;
      cols.forEach(function (c, i) { if (c[0] === column) idx = i; });
      if (idx < 0) throw new Error('Unknown column ' + column);
      var entries = load();
      var hits = entries.filter(function (e) { return pred(e.rec); });
      if (!hits.length) return 0;
      var sh = sheet();
      var now = Util.nowISO();
      var updatedIdx = -1;
      cols.forEach(function (c, i) { if (c[0] === 'updatedAt') updatedIdx = i; });
      var first = entries[0].row;
      var last = entries[entries.length - 1].row;
      var span = sh.getRange(first, 1, last - first + 1, width);
      var grid = span.getValues();
      hits.forEach(function (e) {
        var r = grid[e.row - first];
        r[idx] = Db.toCell_(cols[idx][1], value);
        if (updatedIdx >= 0) r[updatedIdx] = now;
      });
      span.setNumberFormats(grid.map(function () { return formats; }));
      span.setValues(grid);
      t.rows = null;
      return hits.length;
    };

    t.remove = function (id) {
      return t.removeWhere(function (r) { return r.id === id; });
    };

    t.removeWhere = function (pred) {
      var rows = load().filter(function (e) { return pred(e.rec); }).map(function (e) { return e.row; });
      rows.sort(function (a, b) { return b - a; });
      var sh = sheet();
      var i = 0;
      while (i < rows.length) {
        var start = rows[i];
        var count = 1;
        while (i + count < rows.length && rows[i + count] === start - count) count++;
        sh.deleteRows(start - count + 1, count);
        i += count;
      }
      t.rows = null;
      return rows.length;
    };

    return t;
  }
};
