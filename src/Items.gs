/**
 * Items: one income or expense entry. The Type of an item is the type of its category, so the
 * two can never disagree. Amounts are always positive; the type decides the sign. Every item has
 * a status (pending, paid ...) that decides whether it counts towards the dashboard.
 *
 * Who may do what: admins manage every item; members add and change their own;
 * viewers only read.
 */
var Items = {
  MIN_DATE: '2000-01-01',
  MAX_DATE: '2100-12-31',

  byId: function (id) {
    return Db.table('Items').get(id);
  },

  /** Whether `me` may edit or delete this item given their role in the family. */
  canEdit: function (me, role, item) {
    if (role === 'admin') return true;
    return role === 'member' && item.ownerId === me.id;
  },

  save: function (me, p) {
    var familyId = String(p.familyId || '');
    var role = Perm.requireWriter(me, familyId);

    var name = Util.text(p.name, 'ชื่อรายการ', 'name', 80);
    var amount = Util.money(p.amount);
    var date = String(p.date || '');
    if (!Util.isDate(date) || date < Items.MIN_DATE || date > Items.MAX_DATE) {
      throw Util.invalid('date', 'กรุณาเลือกวันที่ให้ถูกต้อง');
    }
    var category = Categories.byId(String(p.categoryId || ''));
    if (!category || category.familyId !== familyId) throw Util.invalid('categoryId', 'กรุณาเลือกหมวดหมู่');

    var cur = null;
    if (p.id) {
      cur = Items.byId(String(p.id));
      if (!cur || cur.familyId !== familyId) throw AppError('NOT_FOUND', 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว ลองโหลดหน้าใหม่');
      if (!Items.canEdit(me, role, cur)) throw Perm.forbidden();
    }
    var ownerId = String(p.ownerId || (cur ? cur.ownerId : me.id));
    if (!Perm.membership(ownerId, familyId)) throw Util.invalid('ownerId', 'กรุณาเลือกเจ้าของรายการที่อยู่ในครอบครัวนี้');
    if (role === 'member' && ownerId !== me.id) {
      throw AppError('FORBIDDEN', 'สมาชิกบันทึกได้เฉพาะรายการของตัวเอง ให้ผู้ดูแลช่วยบันทึกแทนคนอื่น', { field: 'ownerId' });
    }

    var status = Statuses.forItem_(familyId, String(p.statusId || ''), cur);
    var data = { name: name, amount: amount, date: date, categoryId: category.id, ownerId: ownerId, statusId: status.id };
    if (cur) {
      Db.table('Items').update(cur.id, data);
      return { id: cur.id };
    }
    data.familyId = familyId;
    return { id: Db.table('Items').insert(data)[0].id };
  },

  /** Changes only the status of an item, e.g. pending -> paid. Same permission as editing the item. */
  setStatus: function (me, p) {
    var familyId = String(p.familyId || '');
    var role = Perm.requireWriter(me, familyId);
    var cur = Items.byId(String(p.id || ''));
    if (!cur || cur.familyId !== familyId) throw AppError('NOT_FOUND', 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว ลองโหลดหน้าใหม่');
    if (!Items.canEdit(me, role, cur)) throw Perm.forbidden();
    var status = Statuses.pick_(familyId, p.statusId);
    Db.table('Items').update(cur.id, { statusId: status.id });
    return { id: cur.id };
  },

  remove: function (me, p) {
    var familyId = String(p.familyId || '');
    var role = Perm.role(me, familyId);
    var cur = Items.byId(String(p.id || ''));
    if (!cur || cur.familyId !== familyId) throw AppError('NOT_FOUND', 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว ลองโหลดหน้าใหม่');
    if (!Items.canEdit(me, role, cur)) throw Perm.forbidden();
    Db.table('Items').remove(cur.id);
    return { id: cur.id };
  },

  /* ---- copying items from another month (recurring bills, salary ...) ---- */

  /** Most items one import may copy; keeps a single request small. */
  IMPORT_MAX: 200,

  /** The two months of an import, checked: they must be real, different, and inside the dates items allow. */
  importMonths_: function (p) {
    var from = String(p.month || p.fromMonth || '');
    var to = String(p.toMonth || '');
    if (!Util.isMonth(from)) throw Util.invalid('month', 'กรุณาเลือกเดือนที่จะนำเข้ารายการ');
    if (!Util.isMonth(to) || to < Items.MIN_DATE.slice(0, 7) || to > Items.MAX_DATE.slice(0, 7)) {
      throw Util.invalid('toMonth', 'เดือนปลายทางไม่ถูกต้อง ลองโหลดหน้าใหม่');
    }
    if (from === to) throw Util.invalid('month', 'เลือกเดือนอื่นที่ไม่ใช่เดือนปลายทาง');
    return { from: from, to: to };
  },

  /** What one item looks like for the same person recording it again: same name, category and owner. */
  sameItemKey_: function (item) {
    return String(item.name).toLowerCase() + '|' + item.categoryId + '|' + item.ownerId;
  },

  /**
   * The items of month `month`, ready to be ticked for copying into `toMonth`. Each says whether
   * this person may copy it (members only their own, as when recording) and whether the target
   * month already holds the same item, so a second import does not double the list by accident.
   */
  source: function (me, p) {
    var familyId = String(p.familyId || '');
    var role = Perm.requireWriter(me, familyId);
    var months = Items.importMonths_(p);

    var rows = Db.table('Items').where(function (i) { return i.familyId === familyId; });
    var already = {};
    rows.forEach(function (i) {
      if (i.date.slice(0, 7) === months.to) already[Items.sameItemKey_(i)] = true;
    });
    var picked = rows.filter(function (i) { return i.date.slice(0, 7) === months.from; });
    picked.sort(function (a, b) {
      return Util.byText(b.date, a.date) || Util.byText(b.createdAt, a.createdAt);
    });

    var cats = {};
    Categories.forFamily(familyId).forEach(function (c) { cats[c.id] = c; });
    var types = {};
    Types.forFamily(familyId).forEach(function (t) { types[t.id] = t; });
    var users = {};
    Db.table('Users').all().forEach(function (u) { users[u.id] = u; });

    var items = picked.map(function (i) {
      var cat = cats[i.categoryId];
      var type = cat ? types[cat.typeId] : null;
      var owner = users[i.ownerId];
      var reason = '';
      if (!type) reason = 'ไม่มีหมวดหมู่แล้ว';
      else if (!Items.canEdit(me, role, i)) reason = 'เป็นรายการของคนอื่น';
      return {
        id: i.id,
        name: i.name,
        amount: i.amount,
        date: i.date,
        newDate: Util.sameDayIn(i.date, months.to),
        kind: type ? type.kind : 'EXPENSE',
        categoryName: cat ? cat.name : '(ไม่มีหมวด)',
        ownerName: owner ? owner.name : '(ไม่ทราบ)',
        importable: !reason,
        reason: reason,
        exists: !!already[Items.sameItemKey_(i)]
      };
    });
    return { month: months.from, toMonth: months.to, max: Items.IMPORT_MAX, items: items };
  },

  /**
   * Copies the chosen items of month `month` into `toMonth`: same name, amount, category and owner,
   * same day of the month, and one status for all of them (a bill paid last month is still to pay
   * this month). The originals are not touched. All or nothing: if any item cannot be copied,
   * none is, and the message says why.
   */
  importMonth: function (me, p) {
    var familyId = String(p.familyId || '');
    var role = Perm.requireWriter(me, familyId);
    var months = Items.importMonths_(p);

    var ids = Array.isArray(p.ids) ? p.ids.map(String) : [];
    ids = ids.filter(function (id, k) { return ids.indexOf(id) === k; });
    if (!ids.length) throw Util.invalid('ids', 'กรุณาเลือกรายการที่จะนำเข้าอย่างน้อย 1 รายการ');
    if (ids.length > Items.IMPORT_MAX) {
      throw Util.invalid('ids', 'นำเข้าได้ครั้งละไม่เกิน ' + Items.IMPORT_MAX + ' รายการ กรุณาเลือกให้น้อยลงแล้วนำเข้าอีกรอบ');
    }
    var status = Statuses.forItem_(familyId, String(p.statusId || ''), null);

    var copies = ids.map(function (id) {
      var src = Items.byId(id);
      if (!src || src.familyId !== familyId) {
        throw AppError('NOT_FOUND', 'มีรายการต้นทางที่ถูกลบไปแล้ว ลองเปิดหน้าต่างนำเข้าใหม่อีกครั้ง');
      }
      if (src.date.slice(0, 7) !== months.from) {
        throw AppError('CONFLICT', 'รายการ “' + src.name + '” ไม่ได้อยู่ในเดือนที่เลือกแล้ว ลองเปิดหน้าต่างนำเข้าใหม่อีกครั้ง', { field: 'ids' });
      }
      if (!Items.canEdit(me, role, src)) throw Perm.forbidden();
      var cat = Categories.byId(src.categoryId);
      if (!cat || cat.familyId !== familyId) {
        throw AppError('CONFLICT', 'หมวดหมู่ของ “' + src.name + '” ถูกลบไปแล้ว นำเข้ารายการนี้ไม่ได้ ลองไม่เลือกรายการนี้', { field: 'ids' });
      }
      return {
        src: src,
        data: {
          familyId: familyId,
          name: src.name,
          amount: src.amount,
          date: Util.sameDayIn(src.date, months.to),
          categoryId: cat.id,
          ownerId: Perm.membership(src.ownerId, familyId) ? src.ownerId : me.id,
          statusId: status.id
        }
      };
    });
    // keep the order they had in the month, so the new rows read like the old ones
    copies.sort(function (a, b) {
      return Util.byText(a.src.date, b.src.date) || Util.byText(a.src.createdAt, b.src.createdAt);
    });
    var stored = Db.table('Items').insert(copies.map(function (c) { return c.data; }));
    return { count: stored.length, month: months.from, toMonth: months.to, statusId: status.id };
  }
};
