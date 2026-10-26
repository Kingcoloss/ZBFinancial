/**
 * Small, dependency-free helpers: errors, ids, dates, money and input cleaning.
 * Every user-facing message is Thai and says what to do next (Aristotle: logos + pathos).
 */

/** Error with a stable `code` the client can switch on. Throw it, don't construct with `new`. */
function AppError(code, message, details) {
  var e = new Error(message);
  e.name = 'AppError';
  e.isAppError = true;
  e.code = code;
  e.details = details || null;
  return e;
}

var Util = {
  MONTHS_TH: ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'],
  MAX_AMOUNT: 999999999.99,

  /** Replaceable in tests. */
  clock: function () {
    return new Date();
  },

  newId: function (prefix) {
    return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  },

  nowISO: function () {
    return Util.clock().toISOString();
  },

  /** Today in the script's time zone as yyyy-MM-dd. */
  todayISO: function () {
    return Utilities.formatDate(Util.clock(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  },

  invalid: function (field, message) {
    return AppError('INVALID', message, { field: field });
  },

  /** True for a real calendar date written as yyyy-MM-dd. */
  isDate: function (s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = Number(s.slice(0, 4));
    var m = Number(s.slice(5, 7));
    var d = Number(s.slice(8, 10));
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  },

  /** Normalises a cell value (Date or text) to yyyy-MM-dd, or '' when it is not a date. */
  cellDate: function (v) {
    if (v instanceof Date || (v && typeof v.getTime === 'function')) {
      if (isNaN(v.getTime())) return '';
      return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    var s = String(v == null ? '' : v).trim().slice(0, 10);
    return Util.isDate(s) ? s : '';
  },

  isMonth: function (s) {
    return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
  },

  addMonths: function (month, delta) {
    var y = Number(month.slice(0, 4));
    var m = Number(month.slice(5, 7)) - 1 + delta;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + '-' + (m < 9 ? '0' : '') + (m + 1);
  },

  /** Short Thai month name, e.g. 2026-10 -> ต.ค. */
  monthShort: function (month) {
    return Util.MONTHS_TH[Number(month.slice(5, 7)) - 1];
  },

  /** Thai month with Buddhist year, e.g. 2026-10 -> ต.ค. 2569. */
  monthLabel: function (month) {
    return Util.monthShort(month) + ' ' + (Number(month.slice(0, 4)) + 543);
  },

  /** 12345.5 -> "12,345.50"; whole numbers drop the decimals: 12345 -> "12,345". */
  baht: function (n) {
    var v = Math.round(Number(n || 0) * 100) / 100;
    var neg = v < 0;
    var parts = Math.abs(v).toFixed(2).split('.');
    var int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var out = parts[1] === '00' ? int : int + '.' + parts[1];
    return (neg ? '-' : '') + out;
  },

  round2: function (n) {
    return Math.round(n * 100) / 100;
  },

  /** Parses an amount typed by a person ("1,240.50"); must be > 0. */
  money: function (v) {
    var n = typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(/[,\s฿]/g, ''));
    if (!isFinite(n) || n <= 0) throw Util.invalid('amount', 'กรุณาใส่จำนวนเงินที่มากกว่า 0');
    n = Util.round2(n);
    if (n > Util.MAX_AMOUNT) throw Util.invalid('amount', 'จำนวนเงินสูงเกินไป กรุณาตรวจสอบอีกครั้ง');
    return n;
  },

  /** Trims, collapses whitespace and control characters, and enforces a length. */
  text: function (v, label, field, max) {
    var s = String(v == null ? '' : v)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) throw Util.invalid(field, 'กรุณาใส่' + label);
    if (s.length > max) throw Util.invalid(field, label + 'ยาวเกินไป (ไม่เกิน ' + max + ' ตัวอักษร)');
    return s;
  },

  email: function (v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (!s) throw Util.invalid('email', 'กรุณาใส่อีเมล Google');
    if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
      throw Util.invalid('email', 'รูปแบบอีเมลไม่ถูกต้อง เช่น name@gmail.com');
    }
    return s;
  },

  sameName: function (a, b) {
    return String(a).toLowerCase() === String(b).toLowerCase();
  },

  /** Case-insensitive, locale-free ordering helper for sort(). */
  byText: function (a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
};
