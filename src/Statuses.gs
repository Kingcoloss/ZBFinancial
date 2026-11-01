/**
 * Statuses: where an item stands (pending, paid, cancelled ...). They belong to a family and are
 * managed by its admins, like types and categories.
 *
 * What a status means for the numbers (three kinds, so the dashboard can always say what it did):
 *   done      counted = true                      items are in every total (ชำระแล้ว)
 *   open      counted = false, cancelled = false  items are only in the "every status except cancelled"
 *                                                 income / expense ratio (รอดำเนินการ)
 *   cancelled cancelled = true (counted = false)  items are in no figure at all (ยกเลิก)
 * Nothing is deleted if it would orphan an item: the caller names the status to move them to.
 */
var Statuses = {
  MAX_PER_FAMILY: 12,

  /** Seeded for every new family. New items start in the first status that counts (ชำระแล้ว). */
  DEFAULTS: [
    { name: 'รอดำเนินการ', counted: false, cancelled: false },
    { name: 'ชำระแล้ว', counted: true, cancelled: false },
    { name: 'ยกเลิก', counted: false, cancelled: true }
  ],

  byId: function (id) {
    return Db.table('Statuses').get(id);
  },

  /** In the order they were created. */
  forFamily: function (familyId) {
    return Db.table('Statuses').where(function (s) { return s.familyId === familyId; });
  },

  /** Where an item without a usable status lands: the first status that counts, else the first. */
  defaultOf: function (list) {
    return list.filter(function (s) { return s.counted; })[0] || list[0] || null;
  },

  seed_: function (familyId) {
    return Db.table('Statuses').insert(
      Statuses.DEFAULTS.map(function (s) {
        return { familyId: familyId, name: s.name, counted: s.counted, cancelled: s.cancelled };
      })
    );
  },

  /** The family's default status; a family with none at all (rows deleted by hand) gets the starter set. */
  ensure_: function (familyId) {
    var list = Statuses.forFamily(familyId);
    if (!list.length) list = Statuses.seed_(familyId);
    return Statuses.defaultOf(list);
  },

  /** The status with this id, which must belong to the family. */
  pick_: function (familyId, id) {
    var s = Statuses.byId(String(id || ''));
    if (!s || s.familyId !== familyId) throw Util.invalid('statusId', 'กรุณาเลือกสถานะ');
    return s;
  },

  /** Which status a saved item gets: the one asked for, else the one it already had, else the default. */
  forItem_: function (familyId, requestedId, current) {
    if (requestedId) return Statuses.pick_(familyId, requestedId);
    var kept = current ? Statuses.byId(current.statusId) : null;
    if (kept && kept.familyId === familyId) return kept;
    return Statuses.ensure_(familyId);
  },

  itemCount: function (familyId, statusId) {
    return Db.table('Items').count(function (i) { return i.familyId === familyId && i.statusId === statusId; });
  },

  flag_: function (v, field, message) {
    if (v === true || v === 'true') return true;
    if (v === false || v === 'false') return false;
    throw Util.invalid(field, message);
  },

  save: function (me, p) {
    var familyId = String(p.familyId || '');
    Perm.requireAdmin(me, familyId);
    var name = Util.text(p.name, 'ชื่อสถานะ', 'name', 30);
    var counted = Statuses.flag_(p.counted, 'counted', 'กรุณาเลือกว่านับรวมในยอดสรุปหรือไม่');
    var list = Statuses.forFamily(familyId);
    var clash = list.some(function (s) { return s.id !== p.id && Util.sameName(s.name, name); });
    if (clash) throw AppError('CONFLICT', 'มีสถานะชื่อ "' + name + '" อยู่แล้ว', { field: 'name' });

    var cur = null;
    if (p.id) {
      cur = Statuses.byId(String(p.id));
      if (!cur || cur.familyId !== familyId) throw AppError('NOT_FOUND', 'ไม่พบสถานะนี้ อาจถูกลบไปแล้ว ลองโหลดหน้าใหม่');
    }
    // An older client that does not send `cancelled` leaves it as it was.
    var cancelled = p.cancelled === undefined
      ? !!(cur && cur.cancelled)
      : Statuses.flag_(p.cancelled, 'cancelled', 'กรุณาเลือกว่าเป็นสถานะยกเลิกหรือไม่');
    if (cancelled && counted) {
      throw Util.invalid('cancelled', 'สถานะยกเลิกต้องไม่นับรวมในยอดสรุป เลือก "ยกเลิก" อย่างเดียว หรือเลือก "เสร็จแล้ว" อย่างเดียว');
    }

    if (!cur) {
      if (list.length >= Statuses.MAX_PER_FAMILY) {
        throw AppError('CONFLICT', 'มีสถานะครบ ' + Statuses.MAX_PER_FAMILY + ' สถานะแล้ว กรุณาลบหรือรวมสถานะที่ไม่ใช้ก่อนเพิ่มใหม่');
      }
      return { id: Db.table('Statuses').insert({ familyId: familyId, name: name, counted: counted, cancelled: cancelled })[0].id };
    }
    if (cur.counted && !counted && !list.some(function (s) { return s.id !== cur.id && s.counted; })) {
      throw AppError(
        'CONFLICT',
        'ต้องมีสถานะที่นับรวมในยอดสรุปอย่างน้อย 1 สถานะ ไม่เช่นนั้นภาพรวมจะเป็นศูนย์ทั้งหมด ตั้งสถานะอื่นให้นับรวมก่อน',
        { field: 'counted' }
      );
    }
    Db.table('Statuses').update(cur.id, { name: name, counted: counted, cancelled: cancelled });
    return { id: cur.id };
  },

  /** Deleting a status that has items needs moveToId so the items keep a status. */
  remove: function (me, p) {
    var familyId = String(p.familyId || '');
    Perm.requireAdmin(me, familyId);
    var id = String(p.id || '');
    var cur = Statuses.byId(id);
    if (!cur || cur.familyId !== familyId) throw AppError('NOT_FOUND', 'ไม่พบสถานะนี้ อาจถูกลบไปแล้ว ลองโหลดหน้าใหม่');
    var others = Statuses.forFamily(familyId).filter(function (s) { return s.id !== id; });
    if (!others.length) throw AppError('CONFLICT', 'ครอบครัวต้องมีสถานะอย่างน้อย 1 สถานะ เพิ่มสถานะใหม่ก่อนจึงจะลบอันนี้ได้');
    if (cur.counted && !others.some(function (s) { return s.counted; })) {
      throw AppError('CONFLICT', 'สถานะนี้เป็นสถานะเดียวที่นับรวมในยอดสรุป ตั้งสถานะอื่นให้นับรวมก่อนจึงจะลบได้');
    }

    var count = Statuses.itemCount(familyId, id);
    if (count > 0) {
      var toId = String(p.moveToId || '');
      if (!toId) {
        throw AppError('NEEDS_REASSIGN', 'สถานะนี้มี ' + count + ' รายการ กรุณาเลือกสถานะที่จะย้ายไป รายการจะไม่หายไป', { count: count });
      }
      var to = Statuses.byId(toId);
      if (!to || to.familyId !== familyId || to.id === id) throw Util.invalid('moveToId', 'กรุณาเลือกสถานะอื่นในครอบครัวนี้');
      Db.table('Items').setColumnWhere(
        function (i) { return i.familyId === familyId && i.statusId === id; },
        'statusId',
        to.id
      );
    }
    Db.table('Statuses').remove(id);
    return { moved: count };
  },

  /**
   * Run by Db the first time an Items tab from before statuses existed is read: every family gets
   * its starter statuses and every existing item is marked as the family's default (ชำระแล้ว), so
   * the dashboard shows exactly the numbers it showed before. The header goes in before the values:
   * a run that stops half way leaves blank status cells, which read as the family's default
   * anyway, whereas a header-less column full of ids would look like someone else's data.
   */
  upgradeItems_: function (sh, lastRow) {
    var cols = Db.SCHEMA.Items.map(function (c) { return c[0]; });
    var statusCol = cols.indexOf('statusId') + 1;
    var familyCol = cols.indexOf('familyId') + 1;
    var defaults = {};
    Db.table('Families').all().forEach(function (f) { defaults[f.id] = Statuses.ensure_(f.id).id; });

    var head = sh.getRange(1, statusCol, 1, 1);
    head.setNumberFormats([['@']]);
    head.setValues([['statusId']]);
    head.setFontWeight('bold');
    head.setBackground('#E5E7EB');

    if (lastRow > 1) {
      var families = sh.getRange(2, familyCol, lastRow - 1, 1).getValues();
      var range = sh.getRange(2, statusCol, lastRow - 1, 1);
      range.setNumberFormats(families.map(function () { return ['@']; }));
      range.setValues(families.map(function (r) { return [defaults[String(r[0])] || '']; }));
    }
  },

  /**
   * Run by Db the first time a Statuses tab from before the cancelled flag is read: the status
   * named ยกเลิก (the starter one) becomes a cancelled status, every other one stays as it was.
   * A family that renamed it can tick the flag in the สถานะ screen. Header first, like upgradeItems_.
   * Reads the sheet directly: this runs while the Statuses table itself is loading.
   */
  upgradeStatuses_: function (sh, lastRow) {
    var cols = Db.SCHEMA.Statuses.map(function (c) { return c[0]; });
    var flagCol = cols.indexOf('cancelled') + 1;
    var nameCol = cols.indexOf('name') + 1;

    var head = sh.getRange(1, flagCol, 1, 1);
    head.setNumberFormats([['@']]);
    head.setValues([['cancelled']]);
    head.setFontWeight('bold');
    head.setBackground('#E5E7EB');

    if (lastRow > 1) {
      var names = sh.getRange(2, nameCol, lastRow - 1, 1).getValues();
      var range = sh.getRange(2, flagCol, lastRow - 1, 1);
      range.setNumberFormats(names.map(function () { return ['@']; }));
      range.setValues(names.map(function (r) { return [String(r[0]).trim() === 'ยกเลิก' ? 'TRUE' : 'FALSE']; }));
    }
  }
};
