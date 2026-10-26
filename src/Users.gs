/**
 * Users: people who own items. A user may belong to several families (Memberships tab) with a
 * role per family.
 */
var Users = {
  byEmail: function (email) {
    var e = String(email || '').toLowerCase();
    return Db.table('Users').where(function (u) { return u.email === e; })[0] || null;
  },

  byId: function (id) {
    return Db.table('Users').get(id);
  },

  /** Members of a family as [{ user, role }]. */
  membersOf: function (familyId) {
    var users = {};
    Db.table('Users').all().forEach(function (u) { users[u.id] = u; });
    return Db.table('Memberships')
      .where(function (m) { return m.familyId === familyId; })
      .filter(function (m) { return users[m.userId]; })
      .map(function (m) { return { user: users[m.userId], role: m.role }; });
  },

  /** Add (no userId) or edit (userId) a member of a family. */
  save: function (me, p) {
    var familyId = String(p.familyId || '');
    var myRole = Perm.role(me, familyId);
    var isAdmin = myRole === 'admin';

    if (!p.userId) {
      if (!isAdmin) throw Perm.forbidden();
      var role = Perm.roleName(p.role);
      var email = Util.email(p.email);
      var user = Users.byEmail(email);
      if (!user) {
        var name = Util.text(p.name, 'ชื่อที่แสดง', 'name', 60);
        user = Db.table('Users').insert({ email: email, name: name })[0];
      }
      if (Perm.membership(user.id, familyId)) {
        throw AppError('CONFLICT', user.name + ' อยู่ในครอบครัวนี้แล้ว', { field: 'email' });
      }
      Db.table('Memberships').insert({ familyId: familyId, userId: user.id, role: role });
      return { id: user.id };
    }

    var target = Users.byId(String(p.userId));
    var membership = target ? Perm.membership(target.id, familyId) : null;
    if (!target || !membership) throw AppError('NOT_FOUND', 'ไม่พบผู้ใช้นี้ในครอบครัว อาจถูกลบไปแล้ว ลองโหลดหน้าใหม่');
    var isSelf = target.id === me.id;
    if (!isAdmin && !isSelf) throw Perm.forbidden();

    var patch = { name: Util.text(p.name, 'ชื่อที่แสดง', 'name', 60) };

    if (p.email !== undefined && String(p.email).trim().toLowerCase() !== target.email) {
      if (!isAdmin || isSelf) {
        throw AppError('FORBIDDEN', 'เปลี่ยนอีเมลของตัวเองไม่ได้ เพราะจะเข้าระบบไม่ได้ ให้ผู้ดูแลคนอื่นเพิ่มอีเมลใหม่แทน', { field: 'email' });
      }
      var elsewhere = Db.table('Memberships').count(function (m) {
        return m.userId === target.id && m.familyId !== familyId;
      });
      if (elsewhere > 0) {
        throw AppError('FORBIDDEN', 'ผู้ใช้นี้อยู่หลายครอบครัว จึงเปลี่ยนอีเมลที่นี่ไม่ได้', { field: 'email' });
      }
      var email2 = Util.email(p.email);
      if (Users.byEmail(email2)) throw AppError('CONFLICT', 'อีเมลนี้มีผู้ใช้อยู่แล้ว', { field: 'email' });
      patch.email = email2;
    }

    if (p.role !== undefined && p.role !== membership.role) {
      if (!isAdmin) throw Perm.forbidden();
      var newRole = Perm.roleName(p.role);
      if (membership.role === 'admin' && newRole !== 'admin' && Perm.adminCount(familyId) <= 1) {
        throw AppError('CONFLICT', 'ครอบครัวต้องมีผู้ดูแลอย่างน้อย 1 คน กรุณาตั้งผู้ดูแลคนใหม่ก่อน', { field: 'role' });
      }
      Db.table('Memberships').update(membership.id, { role: newRole });
    }

    Db.table('Users').update(target.id, patch);
    return { id: target.id };
  },

  /**
   * Remove a member from a family. Items they own must be handed to someone else first (reassignToId)
   * so no record is lost. A person with no family left loses their account too.
   */
  remove: function (me, p) {
    var familyId = String(p.familyId || '');
    Perm.requireAdmin(me, familyId);
    var userId = String(p.userId || '');
    var membership = Perm.membership(userId, familyId);
    if (!membership) throw AppError('NOT_FOUND', 'ไม่พบผู้ใช้นี้ในครอบครัว อาจถูกลบไปแล้ว ลองโหลดหน้าใหม่');
    if (userId === me.id) {
      throw AppError('CONFLICT', 'ลบตัวเองไม่ได้ ให้ผู้ดูแลคนอื่นเป็นผู้ลบ หรือลบทั้งครอบครัวแทน');
    }
    if (membership.role === 'admin' && Perm.adminCount(familyId) <= 1) {
      throw AppError('CONFLICT', 'ครอบครัวต้องมีผู้ดูแลอย่างน้อย 1 คน');
    }

    var owned = Db.table('Items').count(function (i) { return i.familyId === familyId && i.ownerId === userId; });
    if (owned > 0) {
      var to = String(p.reassignToId || '');
      if (!to) {
        throw AppError('NEEDS_REASSIGN', 'ผู้ใช้นี้เป็นเจ้าของ ' + owned + ' รายการ กรุณาเลือกผู้รับช่วงต่อ รายการจะไม่หายไป', { count: owned });
      }
      if (to === userId || !Perm.membership(to, familyId)) {
        throw Util.invalid('reassignToId', 'กรุณาเลือกสมาชิกคนอื่นในครอบครัวนี้');
      }
      Db.table('Items').setColumnWhere(
        function (i) { return i.familyId === familyId && i.ownerId === userId; },
        'ownerId',
        to
      );
    }

    Db.table('Memberships').remove(membership.id);
    var remaining = Db.table('Memberships').count(function (m) { return m.userId === userId; });
    if (remaining === 0) Db.table('Users').remove(userId);
    return { moved: owned };
  }
};
