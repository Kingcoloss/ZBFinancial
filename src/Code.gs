/**
 * ZBFinancial: family income and expense tracker on Google Apps Script + Google Sheets.
 *
 * Callable from outside: doGet (web app), api (the browser), setup and diagnose (run from the
 * editor). Everything else lives in namespace objects (Db, Api, Items, ...), which
 * google.script.run cannot reach.
 */

function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.diag) return Diag.page();
    return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('ZBFinancial')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  } catch (err) {
    // Show the real reason instead of Google's generic error page.
    return Diag.shell_(
      'เปิดหน้าแอปไม่สำเร็จ',
      '<p>ระบบสร้างหน้าเว็บไม่ได้ ข้อความจากระบบ:</p><pre>' + Diag.esc_(err && err.message ? err.message : err) + '</pre>' +
        '<p>ส่งข้อความนี้ให้ผู้พัฒนา หรือเปิด <code>?diag=1</code> ต่อท้ายลิงก์เพื่อดูผลตรวจระบบ</p>'
    );
  }
}

/** Template helper: <?!= include_('Styles') ?>. The trailing underscore keeps it private. */
function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function api(action, payload) {
  return Api.handle(action, payload);
}

/**
 * Run once from the Apps Script editor (Run > setup). Builds the Google Sheet workbook with every
 * tab and header, remembers it, and registers the person running it as the first admin.
 * Safe to run again: it only adds what is missing.
 */
function setup() {
  Db.reset();
  var ss = Db.ensureAll();
  var created = Db.createdWorkbook_;

  var email = '';
  try {
    email = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '';
  } catch (e) {
    email = '';
  }
  email = email.toLowerCase();

  var registered = false;
  if (email) {
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty('OWNER_EMAIL')) props.setProperty('OWNER_EMAIL', email);
    Db.withLock(function () {
      if (Db.table('Users').count(function () { return true; }) === 0) {
        Auth.registerFirst(email);
        registered = true;
      }
    });
  }

  // Reading every tab upgraded older ones; a family that somehow has no statuses gets the starter set.
  Db.withLock(function () {
    Db.table('Families').all().forEach(function (f) { Statuses.ensure_(f.id); });
  });

  var summary = { url: ss.getUrl(), spreadsheetId: ss.getId(), tabs: Db.TABLES, workbookCreated: created, adminRegistered: registered ? email : null };
  console.log('ZBFinancial setup: ' + JSON.stringify(summary));
  return summary;
}

/**
 * Run from the editor (Run > diagnose) or open the web app with ?diag=1. Checks, in order, each
 * thing that has to be true for the app to open, and says which one is not. It changes nothing.
 */
function diagnose() {
  var report = Diag.run();
  report.checks.forEach(function (c) {
    console.log((c.ok ? '[ผ่าน] ' : '[ไม่ผ่าน] ') + c.name + (c.detail ? ' : ' + c.detail : ''));
  });
  console.log(report.ok ? 'ทุกข้อผ่าน ระบบพร้อมใช้งาน' : 'มีข้อที่ไม่ผ่าน ดูข้อ [ไม่ผ่าน] ด้านบน');
  return report;
}

var Diag = {
  FILES: ['Index', 'Styles', 'JsCore', 'JsViews', 'JsForms', 'JsMain'],

  esc_: function (v) {
    return String(v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  },

  /** Plain, dependency-free page (works even when the real UI cannot be built). */
  shell_: function (title, body) {
    var html = '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><base target="_top">' +
      '<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;padding:24px 16px;background:#F6F7F9;color:#111827}' +
      'main{max-width:640px;margin:0 auto}h1{font-size:22px}pre{white-space:pre-wrap;word-break:break-word;background:#fff;border:1px solid #E5E7EB;border-radius:8px;padding:12px}' +
      'li{margin:6px 0}.ok{color:#0F766E}.bad{color:#B3261E;font-weight:600}small{color:#4B5563}</style></head>' +
      '<body><main><h1>' + Diag.esc_(title) + '</h1>' + body + '</main></body></html>';
    return HtmlService.createHtmlOutput(html)
      .setTitle('ZBFinancial')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  },

  page: function () {
    var report = Diag.run();
    var items = report.checks.map(function (c) {
      return '<li class="' + (c.ok ? 'ok' : 'bad') + '">' + (c.ok ? '✓ ' : '✗ ') + Diag.esc_(c.name) +
        (c.detail ? '<br><small>' + Diag.esc_(c.detail) + '</small>' : '') + '</li>';
    }).join('');
    return Diag.shell_('ตรวจระบบ ZBFinancial', '<p>' + (report.ok ? 'ทุกข้อผ่าน ระบบพร้อมใช้งาน' : 'มีข้อที่ไม่ผ่าน (✗) ให้แก้จากบนลงล่าง') + '</p><ul>' + items + '</ul>');
  },

  run: function () {
    Db.reset();
    var checks = [];
    var add = function (name, ok, detail) { checks.push({ name: name, ok: !!ok, detail: detail || '' }); return !!ok; };
    var attempt = function (name, fn) {
      try {
        var detail = fn();
        return add(name, true, detail);
      } catch (err) {
        add(name, false, err && err.message ? err.message : String(err));
        return false;
      }
    };

    Diag.FILES.forEach(function (f) {
      attempt('ไฟล์หน้าเว็บ ' + f, function () {
        var size = HtmlService.createHtmlOutputFromFile(f).getContent().length;
        if (!size) throw new Error('ไฟล์ ' + f + ' ว่างเปล่า');
        return size + ' ตัวอักษร';
      });
    });
    attempt('ประกอบหน้า Index ได้', function () {
      var html = HtmlService.createTemplateFromFile('Index').evaluate().getContent();
      if (html.indexOf('window.ZB') < 0) throw new Error('หน้าเว็บประกอบแล้วแต่ไม่มีโค้ด JavaScript ตรวจชื่อไฟล์ JsCore / JsViews / JsForms / JsMain');
      return html.length + ' ตัวอักษร';
    });

    var email = '';
    var identified = attempt('ระบบเห็นอีเมล Google ของคุณ', function () {
      email = (Session.getActiveUser().getEmail() || '').toLowerCase();
      if (!email) {
        throw new Error('อ่านอีเมลไม่ได้ ต้อง deploy เป็น "Execute as: User accessing the web app" แล้วเปิดลิงก์ใหม่หลัง Deploy > Manage deployments > Edit > New version');
      }
      return email;
    });

    var ss = null;
    attempt('เปิด Google Sheet ของระบบได้', function () {
      var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
      if (id) {
        ss = SpreadsheetApp.openById(id);
        return ss.getName() + ' (ต้องให้ทุกคนที่ใช้แอปมีสิทธิ์ Editor ของไฟล์นี้)';
      }
      try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
      if (ss) return 'ใช้ชีตที่ผูกกับสคริปต์: ' + ss.getName();
      throw new Error('ยังไม่มี Google Sheet ให้ระบบ กรุณาเลือกฟังก์ชัน setup แล้วกด Run หนึ่งครั้ง');
    });

    if (ss) {
      var tabsOk = true;
      // Sheets from before a column was added: the app adds it by itself the first time it opens.
      var legacy = {};
      Object.keys(Db.UPGRADES).forEach(function (t) {
        var sh = ss.getSheetByName(t);
        if (!sh || sh.getLastRow() === 0) return;
        var cols = Db.SCHEMA[t];
        var from = Db.UPGRADES[t].from;
        var head = sh.getRange(1, 1, 1, cols.length).getValues()[0];
        legacy[t] = cols.every(function (c, i) { return i < from ? String(head[i]) === c[0] : head[i] === '' || head[i] === null; });
      });
      var upgradePending = Object.keys(legacy).some(function (t) { return legacy[t]; });
      Db.TABLES.forEach(function (t) {
        tabsOk = attempt('แท็บ ' + t + ' และหัวคอลัมน์ถูกต้อง', function () {
          var sh = ss.getSheetByName(t);
          if (!sh && t === 'Statuses' && upgradePending) {
            return 'ยังไม่มีแท็บนี้ ระบบจะสร้างให้เองเมื่อเปิดแอปครั้งแรกหลังอัปเดต (หรือรัน setup)';
          }
          if (!sh) throw new Error('ไม่มีแท็บ ' + t + ' (รัน setup เพื่อสร้างใหม่)');
          var cols = Db.SCHEMA[t];
          if (sh.getLastRow() === 0) throw new Error('แท็บ ' + t + ' ว่าง (รัน setup เพื่อสร้างหัวคอลัมน์)');
          if (legacy[t]) {
            return 'ยังเป็นรูปแบบเดิม ' + Db.UPGRADES[t].from + ' คอลัมน์ ระบบจะเพิ่มคอลัมน์ใหม่ให้เองเมื่อเปิดแอปครั้งแรกหลังอัปเดต (หรือรัน setup) ข้อมูลเดิมไม่ถูกแก้';
          }
          var head = sh.getRange(1, 1, 1, cols.length).getValues()[0];
          for (var i = 0; i < cols.length; i++) {
            if (String(head[i]) !== cols[i][0]) throw new Error('คอลัมน์ที่ ' + (i + 1) + ' ควรเป็น "' + cols[i][0] + '" แต่เป็น "' + head[i] + '"');
          }
          return (sh.getLastRow() - 1) + ' แถวข้อมูล';
        }) && tabsOk;
      });
      if (tabsOk && identified) {
        attempt('อีเมลของคุณลงทะเบียนในแท็บ Users แล้ว', function () {
          var sh = ss.getSheetByName('Users');
          var col = Db.SCHEMA.Users.map(function (c) { return c[0]; }).indexOf('email');
          var rows = sh.getLastRow() > 1 ? sh.getRange(2, col + 1, sh.getLastRow() - 1, 1).getValues() : [];
          var found = rows.some(function (r) { return String(r[0]).toLowerCase() === email; });
          if (found) return 'พบ ' + email;
          if (!rows.length) return 'ยังไม่มีผู้ใช้เลย คุณจะถูกลงทะเบียนเป็นผู้ดูแลคนแรกเมื่อเปิดแอปครั้งแรก';
          throw new Error(email + ' ยังไม่อยู่ในแท็บ Users ให้ผู้ดูแลเพิ่มอีเมลนี้ในเมนู ผู้ใช้ ก่อน');
        });
      }
    }
    return { ok: checks.every(function (c) { return c.ok; }), checks: checks };
  }
};
