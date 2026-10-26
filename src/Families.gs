/**
 * Families: a household with many users. Types, categories, statuses and items all belong to one family.
 */
var Families = {
  DEFAULT_NAME: 'ครอบครัวของฉัน',
  DEFAULT_TYPES: [
    { name: 'รายจ่าย', kind: 'EXPENSE' },
    { name: 'รายรับ', kind: 'INCOME' }
  ],
  DEFAULT_CATEGORIES: [
    { type: 'รายจ่าย', names: ['อาหาร', 'บ้านและสาธารณูปโภค', 'เดินทาง', 'สุขภาพ', 'การศึกษา', 'อื่น ๆ'] },
    { type: 'รายรับ', names: ['รายได้ประจำ', 'รายได้เสริม'] }
  ],

  byId: function (id) {
    return Db.table('Families').get(id);
  },

  /** Creates a family, makes `user` its admin and fills in the starter types, categories and statuses. */
  createFor_: function (user, name) {
    var family = Db.table('Families').insert({ name: name })[0];
    Db.table('Memberships').insert({ familyId: family.id, userId: user.id, role: 'admin' });
    Families.seed_(family.id);
    return family;
  },

  seed_: function (familyId) {
    var types = Db.table('Types').insert(
      Families.DEFAULT_TYPES.map(function (t) {
        return { familyId: familyId, name: t.name, kind: t.kind };
      })
    );
    var byName = {};
    types.forEach(function (t) { byName[t.name] = t.id; });
    var cats = [];
    Families.DEFAULT_CATEGORIES.forEach(function (group) {
      group.names.forEach(function (n) {
        cats.push({ familyId: familyId, typeId: byName[group.type], name: n });
      });
    });
    Db.table('Categories').insert(cats);
    Statuses.seed_(familyId);
  },

  /** Create (no id) or rename (id). Optionally adds one existing user while editing. */
  save: function (me, p) {
    var name = Util.text(p.name, 'ชื่อครอบครัว', 'name', 60);
    var dup = Db.table('Memberships').where(function (m) { return m.userId === me.id; }).some(function (m) {
      var f = Families.byId(m.familyId);
      return f && f.id !== p.id && Util.sameName(f.name, name);
    });
    if (dup) throw AppError('CONFLICT', 'คุณมีครอบครัวชื่อ "' + name + '" อยู่แล้ว กรุณาตั้งชื่ออื่น', { field: 'name' });

    if (!p.id) {
      var family = Families.createFor_(me, name);
      return { id: family.id };
    }

    var id = String(p.id);
    Perm.requireAdmin(me, id);
    if (!Families.byId(id)) throw AppError('NOT_FOUND', 'ไม่พบครอบครัวนี้ อาจถูกลบไปแล้ว ลองโหลดหน้าใหม่');
    Db.table('Families').update(id, { name: name });

    if (p.addUserId) {
      var candidate = Families.addableUsers(me, id).filter(function (u) { return u.id === String(p.addUserId); })[0];
      if (!candidate) throw Util.invalid('addUserId', 'เลือกได้เฉพาะผู้ใช้ที่อยู่ในครอบครัวอื่นของคุณ และยังไม่ได้อยู่ในครอบครัวนี้');
      Db.table('Memberships').insert({
        familyId: id,
        userId: candidate.id,
        role: Perm.roleName(p.addRole || 'member')
      });
    }
    return { id: id };
  },

  /** People from the caller's other families who are not yet in `familyId`. */
  addableUsers: function (me, familyId) {
    var mine = Db.table('Memberships').where(function (m) { return m.userId === me.id; }).map(function (m) { return m.familyId; });
    var inThis = {};
    Db.table('Memberships').where(function (m) { return m.familyId === familyId; }).forEach(function (m) { inThis[m.userId] = true; });
    var seen = {};
    var ids = [];
    Db.table('Memberships')
      .where(function (m) { return mine.indexOf(m.familyId) >= 0 && !inThis[m.userId] && m.userId !== me.id; })
      .forEach(function (m) {
        if (!seen[m.userId]) {
          seen[m.userId] = true;
          ids.push(m.userId);
        }
      });
    return ids
      .map(function (id) { return Users.byId(id); })
      .filter(Boolean)
      .map(function (u) { return { id: u.id, name: u.name, email: u.email }; });
  },

  /** Deletes the family and everything in it. Needs force:true once there is data to lose. */
  remove: function (me, p) {
    var id = String(p.id || '');
    Perm.requireAdmin(me, id);
    var items = Db.table('Items').count(function (i) { return i.familyId === id; });
    var members = Db.table('Memberships').count(function (m) { return m.familyId === id; });
    if (!p.force && (items > 0 || members > 1)) {
      throw AppError(
        'CONFIRM_REQUIRED',
        'การลบครอบครัวจะลบรายการ ' + items + ' รายการและสมาชิก ' + members + ' คนออกจากครอบครัวนี้ กรุณายืนยันอีกครั้ง',
        { items: items, members: members }
      );
    }
    Db.table('Items').removeWhere(function (i) { return i.familyId === id; });
    Db.table('Categories').removeWhere(function (c) { return c.familyId === id; });
    Db.table('Statuses').removeWhere(function (s) { return s.familyId === id; });
    Db.table('Types').removeWhere(function (t) { return t.familyId === id; });
    Db.table('Memberships').removeWhere(function (m) { return m.familyId === id; });
    Db.table('Families').remove(id);
    return { items: items, members: members };
  }
};
