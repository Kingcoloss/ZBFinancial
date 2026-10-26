/**
 * Read model: everything the screen needs for one family and one month in a single payload,
 * so every action costs one round trip (each google.script.run call takes about a second).
 */
var Views = {
  MONTHS_BACK: 36,

  build: function (me, view) {
    view = view || {};
    var today = Util.todayISO();
    var thisMonth = today.slice(0, 7);
    var month = Util.isMonth(view.month) ? view.month : thisMonth;

    var memberships = Db.table('Memberships').where(function (m) { return m.userId === me.id; });
    var allMembers = Db.table('Memberships').all();
    var users = {};
    Db.table('Users').all().forEach(function (u) { users[u.id] = u; });
    var allItems = Db.table('Items').all();
    var types = {};
    Db.table('Types').all().forEach(function (t) { types[t.id] = t; });
    var cats = {};
    Db.table('Categories').all().forEach(function (c) { cats[c.id] = c; });

    var kindOf = function (item) {
      var c = cats[item.categoryId];
      var t = c ? types[c.typeId] : null;
      return t ? t.kind : 'EXPENSE';
    };

    var families = memberships
      .map(function (m) {
        var f = Families.byId(m.familyId);
        if (!f) return null;
        var members = allMembers.filter(function (x) { return x.familyId === f.id; });
        var balance = 0;
        var itemCount = 0;
        allItems.forEach(function (i) {
          if (i.familyId !== f.id) return;
          itemCount++;
          if (i.date.slice(0, 7) === month) balance += kindOf(i) === 'INCOME' ? i.amount : -i.amount;
        });
        return {
          id: f.id,
          name: f.name,
          role: m.role,
          memberCount: members.length,
          memberNames: members.map(function (x) { return users[x.userId] ? users[x.userId].name : ''; }).filter(Boolean),
          itemCount: itemCount,
          balance: Util.round2(balance)
        };
      })
      .filter(Boolean)
      .sort(function (a, b) { return Util.byText(a.name, b.name); });

    // Unless a family was asked for, open the one the person joined first (rows keep join order).
    var joinedFirst = memberships.map(function (m) { return m.familyId; });
    var byId = function (id) { return families.filter(function (f) { return f.id === id; })[0]; };
    var current = byId(view.familyId) || joinedFirst.map(byId).filter(Boolean)[0] || null;

    var state = {
      me: { id: me.id, name: me.name, email: me.email },
      meta: {
        today: today,
        thisMonth: thisMonth,
        month: month,
        months: Views.monthOptions_(thisMonth, month),
        sheetUrl: Views.sheetUrl_(),
        syncedAt: Util.nowISO()
      },
      families: families,
      family: null
    };
    if (!current) return state;

    var familyId = current.id;
    var role = current.role;
    var familyTypes = Object.keys(types).map(function (k) { return types[k]; }).filter(function (t) { return t.familyId === familyId; });
    var familyCats = Object.keys(cats).map(function (k) { return cats[k]; }).filter(function (c) { return c.familyId === familyId; });
    var familyItems = allItems.filter(function (i) { return i.familyId === familyId; });
    var memberRows = Users.membersOf(familyId);
    var memberIds = {};
    memberRows.forEach(function (r) { memberIds[r.user.id] = r; });

    var enriched = familyItems.map(function (i) {
      var c = cats[i.categoryId];
      var t = c ? types[c.typeId] : null;
      var owner = users[i.ownerId];
      return {
        id: i.id,
        name: i.name,
        amount: i.amount,
        date: i.date,
        createdAt: i.createdAt,
        categoryId: i.categoryId,
        categoryName: c ? c.name : '(ไม่มีหมวด)',
        typeId: t ? t.id : '',
        typeName: t ? t.name : '',
        kind: t ? t.kind : 'EXPENSE',
        ownerId: i.ownerId,
        ownerName: owner ? owner.name : '(ไม่ทราบ)',
        canEdit: Items.canEdit(me, role, i)
      };
    });
    enriched.sort(function (a, b) {
      return Util.byText(b.date, a.date) || Util.byText(b.createdAt, a.createdAt);
    });

    var monthItems = enriched.filter(function (i) { return i.date.slice(0, 7) === month; });
    var strip = function (i) {
      var copy = Object.assign({}, i);
      delete copy.createdAt;
      return copy;
    };

    var spendBy = {};
    monthItems.forEach(function (i) {
      if (i.kind === 'EXPENSE') spendBy[i.ownerId] = (spendBy[i.ownerId] || 0) + i.amount;
    });
    var ownedAll = {};
    familyItems.forEach(function (i) { ownedAll[i.ownerId] = (ownedAll[i.ownerId] || 0) + 1; });
    var catsInMonth = {};
    monthItems.forEach(function (i) { catsInMonth[i.categoryId] = (catsInMonth[i.categoryId] || 0) + 1; });
    var catsAll = {};
    familyItems.forEach(function (i) { catsAll[i.categoryId] = (catsAll[i.categoryId] || 0) + 1; });
    var catsPerType = {};
    familyCats.forEach(function (c) { catsPerType[c.typeId] = (catsPerType[c.typeId] || 0) + 1; });
    var itemsPerType = {};
    familyItems.forEach(function (i) {
      var c = cats[i.categoryId];
      if (c) itemsPerType[c.typeId] = (itemsPerType[c.typeId] || 0) + 1;
    });

    state.family = {
      id: familyId,
      name: current.name,
      role: role,
      can: Perm.can(role),
      members: memberRows
        .map(function (r) {
          return {
            userId: r.user.id,
            name: r.user.name,
            email: r.user.email,
            role: r.role,
            isMe: r.user.id === me.id,
            expense: Util.round2(spendBy[r.user.id] || 0),
            itemCount: ownedAll[r.user.id] || 0
          };
        })
        .sort(function (a, b) { return Util.byText(a.name, b.name); }),
      types: familyTypes
        .map(function (t) {
          return { id: t.id, name: t.name, kind: t.kind, categoryCount: catsPerType[t.id] || 0, itemCount: itemsPerType[t.id] || 0 };
        })
        .sort(function (a, b) { return Util.byText(a.kind, b.kind); }), // stable: keeps the order they were created in
      categories: familyCats
        .map(function (c) {
          var t = types[c.typeId];
          return {
            id: c.id,
            typeId: c.typeId,
            typeName: t ? t.name : '',
            kind: t ? t.kind : 'EXPENSE',
            name: c.name,
            monthItems: catsInMonth[c.id] || 0,
            itemCount: catsAll[c.id] || 0
          };
        })
        .sort(function (a, b) { return Util.byText(a.kind, b.kind); }), // stable: keeps the order they were created in
      items: monthItems.map(strip),
      dashboard: Dashboard.compute({ items: enriched, month: month, today: today }),
      addableUsers: role === 'admin' ? Families.addableUsers(me, familyId) : []
    };
    return state;
  },

  /** Newest first: next month (for post-dated items), this month, then 36 months back. */
  monthOptions_: function (thisMonth, selected) {
    var list = [];
    for (var k = 1; k >= -Views.MONTHS_BACK; k--) list.push(Util.addMonths(thisMonth, k));
    if (list.indexOf(selected) < 0) {
      list.push(selected);
      list.sort(function (a, b) { return Util.byText(b, a); });
    }
    return list.map(function (m) { return { value: m, label: Util.monthLabel(m) }; });
  },

  sheetUrl_: function () {
    try {
      return Db.spreadsheet().getUrl();
    } catch (e) {
      return '';
    }
  }
};
