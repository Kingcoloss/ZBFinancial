/**
 * Items: one income or expense entry. The Type of an item is the type of its category, so the
 * two can never disagree. Amounts are always positive; the type decides the sign.
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

    var data = { name: name, amount: amount, date: date, categoryId: category.id, ownerId: ownerId };
    if (cur) {
      Db.table('Items').update(cur.id, data);
      return { id: cur.id };
    }
    data.familyId = familyId;
    return { id: Db.table('Items').insert(data)[0].id };
  },

  remove: function (me, p) {
    var familyId = String(p.familyId || '');
    var role = Perm.role(me, familyId);
    var cur = Items.byId(String(p.id || ''));
    if (!cur || cur.familyId !== familyId) throw AppError('NOT_FOUND', 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว ลองโหลดหน้าใหม่');
    if (!Items.canEdit(me, role, cur)) throw Perm.forbidden();
    Db.table('Items').remove(cur.id);
    return { id: cur.id };
  }
};
