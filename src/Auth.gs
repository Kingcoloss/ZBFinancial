/**
 * Who is calling (Auth) and what they may do (Perm).
 *
 * Identity is the Google account that opened the web app. Accounts must be registered in the
 * Users tab (an admin adds them by email); the only exception is the very first account, which
 * becomes the admin of a fresh workbook so the system can start from nothing.
 */
var Auth = {
  email_: function () {
    var email = '';
    try {
      email = Session.getActiveUser().getEmail();
    } catch (e) {
      email = '';
    }
    if (!email) {
      throw AppError(
        'NO_IDENTITY',
        'ระบบยังยืนยันอีเมล Google ของคุณไม่ได้ กรุณาเข้าสู่ระบบด้วยบัญชี Google แล้วเปิดลิงก์นี้อีกครั้ง'
      );
    }
    return email.toLowerCase();
  },

  /** The registered user behind this request. */
  currentUser: function () {
    var email = Auth.email_();
    return Users.byEmail(email) || Auth.bootstrap_(email);
  },

  bootstrap_: function (email) {
    return Db.withLock(function () {
      var existing = Users.byEmail(email);
      if (existing) return existing;
      var owner = (PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || '').toLowerCase();
      var empty = Db.table('Users').count(function () { return true; }) === 0;
      if (!empty || (owner && owner !== email)) {
        throw AppError(
          'NOT_INVITED',
          'บัญชี ' + email + ' ยังไม่ได้รับเชิญ กรุณาให้ผู้ดูแลครอบครัวเพิ่มอีเมลนี้ในเมนู ผู้ใช้ ก่อน แล้วเปิดลิงก์อีกครั้ง',
          { email: email }
        );
      }
      return Auth.registerFirst(email);
    });
  },

  /** Creates the first user plus a starter family (with default types and categories). */
  registerFirst: function (email) {
    var user = Db.table('Users').insert({ email: email.toLowerCase(), name: email.split('@')[0] })[0];
    Families.createFor_(user, Families.DEFAULT_NAME);
    return user;
  }
};

var Perm = {
  ROLES: ['admin', 'member', 'viewer'],
  LABELS: { admin: 'ผู้ดูแล', member: 'สมาชิก', viewer: 'ดูอย่างเดียว' },

  forbidden: function () {
    return AppError('FORBIDDEN', 'คุณไม่มีสิทธิ์ทำรายการนี้ ผู้ดูแลครอบครัวสามารถปรับสิทธิ์ให้ได้');
  },

  roleName: function (v) {
    var role = String(v == null ? '' : v);
    if (Perm.ROLES.indexOf(role) < 0) throw Util.invalid('role', 'กรุณาเลือกบทบาท');
    return role;
  },

  membership: function (userId, familyId) {
    return (
      Db.table('Memberships').where(function (m) {
        return m.userId === userId && m.familyId === familyId;
      })[0] || null
    );
  },

  /** The caller's role in the family; throws when they are not a member. */
  role: function (me, familyId) {
    var m = familyId ? Perm.membership(me.id, familyId) : null;
    if (!m) throw AppError('FORBIDDEN', 'ไม่พบครอบครัวนี้ในบัญชีของคุณ ลองโหลดหน้าใหม่หรือเลือกครอบครัวอื่น');
    return m.role;
  },

  requireAdmin: function (me, familyId) {
    if (Perm.role(me, familyId) !== 'admin') throw Perm.forbidden();
  },

  /** admin or member: may record items. Returns the role. */
  requireWriter: function (me, familyId) {
    var role = Perm.role(me, familyId);
    if (role === 'viewer') throw Perm.forbidden();
    return role;
  },

  /** What the UI may offer. The server re-checks every action, this only hides dead buttons. */
  can: function (role) {
    var admin = role === 'admin';
    return {
      addItem: role !== 'viewer',
      manageMembers: admin,
      manageStructure: admin,
      renameFamily: admin,
      deleteFamily: admin
    };
  },

  adminCount: function (familyId) {
    return Db.table('Memberships').count(function (m) {
      return m.familyId === familyId && m.role === 'admin';
    });
  }
};
