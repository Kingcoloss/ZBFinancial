/**
 * The single door between the browser and the data. The client calls api(action, payload) and
 * always gets { ok: true, data: { result, state } } or { ok: false, error: { code, message, details } }.
 * Write actions run under the script lock and return the refreshed state, so the screen never
 * has to guess what changed.
 */
var Api = {
  /** write: needs the lock; focus: show the family that was just created. */
  routes: {
    'state': { write: false, run: function () { return null; } },
    'item.save': { write: true, run: function (me, p) { return Items.save(me, p); } },
    'item.status': { write: true, run: function (me, p) { return Items.setStatus(me, p); } },
    'item.remove': { write: true, run: function (me, p) { return Items.remove(me, p); } },
    'category.save': { write: true, run: function (me, p) { return Categories.save(me, p); } },
    'category.remove': { write: true, run: function (me, p) { return Categories.remove(me, p); } },
    'status.save': { write: true, run: function (me, p) { return Statuses.save(me, p); } },
    'status.remove': { write: true, run: function (me, p) { return Statuses.remove(me, p); } },
    'type.save': { write: true, run: function (me, p) { return Types.save(me, p); } },
    'type.remove': { write: true, run: function (me, p) { return Types.remove(me, p); } },
    'user.save': { write: true, run: function (me, p) { return Users.save(me, p); } },
    'user.remove': { write: true, run: function (me, p) { return Users.remove(me, p); } },
    'family.save': { write: true, focus: true, run: function (me, p) { return Families.save(me, p); } },
    'family.remove': { write: true, run: function (me, p) { return Families.remove(me, p); } }
  },

  handle: function (action, payload) {
    try {
      Db.reset();
      var route = Object.prototype.hasOwnProperty.call(Api.routes, action) ? Api.routes[action] : null;
      if (!route) throw AppError('UNKNOWN_ACTION', 'ไม่รู้จักคำสั่งนี้ ลองโหลดหน้าใหม่');
      var p = payload && typeof payload === 'object' ? payload : {};
      var me = Auth.currentUser();
      var result = route.write
        ? Db.withLock(function () { return route.run(me, p); })
        : route.run(me, p);
      var view = Object.assign({}, p.view);
      if (route.focus && !p.id && result && result.id) view.familyId = result.id;
      return { ok: true, data: { result: result === undefined ? null : result, state: Views.build(me, view) } };
    } catch (err) {
      return Api.fail_(err);
    }
  },

  fail_: function (err) {
    if (err && err.isAppError) {
      return { ok: false, error: { code: err.code, message: err.message, details: err.details || null } };
    }
    console.error(err && err.stack ? err.stack : String(err));
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'ระบบขัดข้องชั่วคราว ข้อมูลของคุณยังปลอดภัย กรุณาลองใหม่อีกครั้ง', details: null }
    };
  }
};
