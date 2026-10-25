/**
 * Types (is it an Expense or an Income?) and Categories (what is it for?) of a family.
 * Both are managed by family admins. Nothing is ever deleted if it would orphan an item:
 * the caller must move the items first, so no history disappears by accident.
 */
var Types = {
  KINDS: ['EXPENSE', 'INCOME'],

  byId: function (id) {
    return Db.table('Types').get(id);
  },

  forFamily: function (familyId) {
    return Db.table('Types').where(function (t) { return t.familyId === familyId; });
  },

  kind: function (v) {
    var kind = String(v == null ? '' : v);
    if (Types.KINDS.indexOf(kind) < 0) throw Util.invalid('kind', 'กรุณาเลือกว่าเป็นรายรับหรือรายจ่าย');
    return kind;
  },

  /** Items filed under a type through its categories. */
  itemCount: function (familyId, typeId) {
    var cats = {};
    Categories.forFamily(familyId).forEach(function (c) { if (c.typeId === typeId) cats[c.id] = true; });
    return Db.table('Items').count(function (i) { return i.familyId === familyId && cats[i.categoryId]; });
  },

  save: function (me, p) {
    var familyId = String(p.familyId || '');
    Perm.requireAdmin(me, familyId);
    var name = Util.text(p.name, 'ชื่อประเภท', 'name', 40);
    var kind = Types.kind(p.kind);
    var clash = Types.forFamily(familyId).some(function (t) { return t.id !== p.id && Util.sameName(t.name, name); });
    if (clash) throw AppError('CONFLICT', 'มีประเภทชื่อ "' + name + '" อยู่แล้ว', { field: 'name' });

    if (!p.id) {
      return { id: Db.table('Types').insert({ familyId: familyId, name: name, kind: kind })[0].id };
    }
    var cur = Types.byId(String(p.id));
    if (!cur || cur.familyId !== familyId) throw AppError('NOT_FOUND', 'ไม่พบประเภทนี้ อาจถูกลบไปแล้ว ลองโหลดหน้าใหม่');
    if (cur.kind !== kind && Types.itemCount(familyId, cur.id) > 0) {
      throw AppError(
        'CONFLICT',
        'ประเภทนี้มีรายการอยู่แล้ว การเปลี่ยนผลต่อยอดคงเหลือจะทำให้ตัวเลขเก่าเปลี่ยนตาม เปลี่ยนชื่อได้ แต่เปลี่ยนรายรับ/รายจ่ายไม่ได้',
        { field: 'kind' }
      );
    }
    Db.table('Types').update(cur.id, { name: name, kind: kind });
    return { id: cur.id };
  },

  remove: function (me, p) {
    var familyId = String(p.familyId || '');
    Perm.requireAdmin(me, familyId);
    var id = String(p.id || '');
    var cur = Types.byId(id);
    if (!cur || cur.familyId !== familyId) throw AppError('NOT_FOUND', 'ไม่พบประเภทนี้ อาจถูกลบไปแล้ว ลองโหลดหน้าใหม่');
    var cats = Categories.forFamily(familyId).filter(function (c) { return c.typeId === id; }).length;
    if (cats > 0) {
      throw AppError('CONFLICT', 'ประเภทนี้ยังมี ' + cats + ' หมวดหมู่ กรุณาลบหรือย้ายหมวดหมู่ออกก่อน');
    }
    Db.table('Types').remove(id);
    return { id: id };
  }
};

var Categories = {
  byId: function (id) {
    return Db.table('Categories').get(id);
  },

  forFamily: function (familyId) {
    return Db.table('Categories').where(function (c) { return c.familyId === familyId; });
  },

  itemCount: function (familyId, categoryId) {
    return Db.table('Items').count(function (i) { return i.familyId === familyId && i.categoryId === categoryId; });
  },

  save: function (me, p) {
    var familyId = String(p.familyId || '');
    Perm.requireAdmin(me, familyId);
    var name = Util.text(p.name, 'ชื่อหมวด', 'name', 40);
    var type = Types.byId(String(p.typeId || ''));
    if (!type || type.familyId !== familyId) throw Util.invalid('typeId', 'กรุณาเลือกประเภท');
    var clash = Categories.forFamily(familyId).some(function (c) {
      return c.id !== p.id && c.typeId === type.id && Util.sameName(c.name, name);
    });
    if (clash) throw AppError('CONFLICT', 'ประเภท ' + type.name + ' มีหมวด "' + name + '" อยู่แล้ว', { field: 'name' });

    if (!p.id) {
      return { id: Db.table('Categories').insert({ familyId: familyId, typeId: type.id, name: name })[0].id };
    }
    var cur = Categories.byId(String(p.id));
    if (!cur || cur.familyId !== familyId) throw AppError('NOT_FOUND', 'ไม่พบหมวดหมู่นี้ อาจถูกลบไปแล้ว ลองโหลดหน้าใหม่');
    if (cur.typeId !== type.id && Categories.itemCount(familyId, cur.id) > 0) {
      throw AppError('CONFLICT', 'หมวดนี้มีรายการอยู่แล้ว ย้ายรายการไปหมวดอื่นก่อน จึงจะเปลี่ยนประเภทได้', { field: 'typeId' });
    }
    Db.table('Categories').update(cur.id, { name: name, typeId: type.id });
    return { id: cur.id };
  },

  /** Deleting a category that has items needs moveToId (same type) so the items keep a home. */
  remove: function (me, p) {
    var familyId = String(p.familyId || '');
    Perm.requireAdmin(me, familyId);
    var id = String(p.id || '');
    var cur = Categories.byId(id);
    if (!cur || cur.familyId !== familyId) throw AppError('NOT_FOUND', 'ไม่พบหมวดหมู่นี้ อาจถูกลบไปแล้ว ลองโหลดหน้าใหม่');

    var count = Categories.itemCount(familyId, id);
    if (count > 0) {
      var toId = String(p.moveToId || '');
      if (!toId) {
        throw AppError('NEEDS_REASSIGN', 'หมวดนี้มี ' + count + ' รายการ กรุณาเลือกหมวดที่จะย้ายไป รายการจะไม่หายไป', { count: count });
      }
      var to = Categories.byId(toId);
      if (!to || to.familyId !== familyId || to.id === id || to.typeId !== cur.typeId) {
        throw Util.invalid('moveToId', 'กรุณาเลือกหมวดอื่นที่เป็นประเภทเดียวกัน');
      }
      Db.table('Items').setColumnWhere(
        function (i) { return i.familyId === familyId && i.categoryId === id; },
        'categoryId',
        to.id
      );
    }
    Db.table('Categories').remove(id);
    return { moved: count };
  }
};
