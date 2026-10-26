/**
 * Dashboard numbers for one family and one month. Pure functions over already-loaded items so
 * they are easy to test.
 *
 * Only items whose status counts (status.counted) are added up. Everything else is listed in
 * `scope`, so the screen can say which statuses were counted and what was left out.
 *
 * The wording follows Aristotle's three appeals:
 *   logos  - every claim comes with the number it is based on,
 *   ethos  - comparisons are fair (a half-finished month is compared with the same days of last month,
 *            and the totals say which statuses they include),
 *   pathos - encouraging when things go well, never blaming when they do not.
 */
var Dashboard = {
  TOP_N: 8,

  /**
   * @param {Object} input
   *   items: every item of the family, enriched with kind ('EXPENSE'|'INCOME'), categoryId,
   *          categoryName, ownerId, ownerName, amount, date (yyyy-MM-dd), statusId, statusName,
   *          counted (false = left out of every total; missing = counted)
   *   statuses: [{ id, name, counted }] of the family, in display order
   *   month: yyyy-MM being viewed
   *   today: yyyy-MM-dd
   */
  compute: function (input) {
    var month = input.month;
    var today = input.today;
    var isCurrentMonth = today.slice(0, 7) === month;
    var all = input.items;
    var items = all.filter(function (i) { return i.counted !== false; });
    var skipped = all.filter(function (i) { return i.counted === false && i.date.slice(0, 7) === month; });
    var inMonth = items.filter(function (i) { return i.date.slice(0, 7) === month; });

    var income = 0;
    var expense = 0;
    inMonth.forEach(function (i) {
      if (i.kind === 'INCOME') income += i.amount;
      else expense += i.amount;
    });
    income = Util.round2(income);
    expense = Util.round2(expense);

    var expenses = inMonth.filter(function (i) { return i.kind === 'EXPENSE'; });
    var out = {
      month: month,
      label: Util.monthLabel(month),
      isCurrentMonth: isCurrentMonth,
      income: income,
      expense: expense,
      balance: Util.round2(income - expense),
      count: inMonth.length,
      skipped: skipped.length,
      byCategory: Dashboard.bars_(expenses, 'categoryId', 'categoryName', expense, true),
      byPerson: Dashboard.bars_(expenses, 'ownerId', 'ownerName', expense, false),
      trend: Dashboard.trend_(items, month)
    };
    out.scope = Dashboard.scope_(input.statuses || [], skipped, isCurrentMonth ? 'เดือนนี้' : 'เดือน ' + out.label);
    out.insight = Dashboard.insight_(out, Dashboard.previousExpense_(items, month, isCurrentMonth, today));
    return out;
  },

  /**
   * Which statuses the totals include and what the month left out, in words. null when the family
   * has no statuses (nothing to explain).
   */
  scope_: function (statuses, skipped, when) {
    if (!statuses.length) return null;
    var counted = statuses.filter(function (s) { return s.counted; });
    var everything = counted.length === statuses.length;
    var basis = everything
      ? 'ยอดสรุปนับรายการทุกสถานะ'
      : 'ยอดสรุปนับเฉพาะรายการที่สถานะ ' + counted.map(function (s) { return s.name; }).join(', ');

    var byStatus = [];
    var index = {};
    var income = 0;
    var expense = 0;
    skipped.forEach(function (i) {
      if (!index[i.statusId]) {
        index[i.statusId] = { id: i.statusId, name: i.statusName, count: 0 };
        byStatus.push(index[i.statusId]);
      }
      index[i.statusId].count++;
      if (i.kind === 'INCOME') income += i.amount;
      else expense += i.amount;
    });
    income = Util.round2(income);
    expense = Util.round2(expense);

    var text = basis;
    if (skipped.length) {
      var money = [];
      if (income > 0) money.push('รายรับ ' + Util.baht(income) + ' บาท');
      if (expense > 0) money.push('รายจ่าย ' + Util.baht(expense) + ' บาท');
      text += ' · ไม่รวม ' + skipped.length + ' รายการใน' + when + ' (' +
        byStatus.map(function (b) { return b.name + ' ' + b.count; }).join(', ') + ') ' + money.join(' · ');
    } else if (!everything) {
      text += ' · ' + when + ' ไม่มีรายการที่ถูกข้าม';
    }
    return {
      text: text,
      countedNames: counted.map(function (s) { return s.name; }),
      allCounted: everything,
      skipped: skipped.length,
      skippedIncome: income,
      skippedExpense: expense,
      byStatus: byStatus
    };
  },

  /** Groups by id, sorts high to low, bar widths relative to the biggest. */
  bars_: function (list, idKey, nameKey, total, limit) {
    var map = {};
    var order = [];
    list.forEach(function (i) {
      var id = i[idKey];
      if (!map[id]) {
        map[id] = { id: id, name: i[nameKey], amount: 0 };
        order.push(id);
      }
      map[id].amount += i.amount;
    });
    var rows = order.map(function (id) { return map[id]; });
    rows.sort(function (a, b) { return b.amount - a.amount || Util.byText(a.name, b.name); });
    if (limit && rows.length > Dashboard.TOP_N) {
      var rest = rows.slice(Dashboard.TOP_N);
      rows = rows.slice(0, Dashboard.TOP_N);
      rows.push({
        id: null,
        name: 'หมวดอื่นที่เหลือ ' + rest.length + ' หมวด',
        amount: rest.reduce(function (s, r) { return s + r.amount; }, 0)
      });
    }
    var max = rows.reduce(function (m, r) { return Math.max(m, r.amount); }, 0);
    return rows.map(function (r) {
      return {
        id: r.id,
        name: r.name,
        amount: Util.round2(r.amount),
        pct: max > 0 ? Math.max(2, Math.round((r.amount / max) * 100)) : 0,
        share: total > 0 ? Math.round((r.amount / total) * 100) : 0
      };
    });
  },

  /** Expense and income for the six months ending at `month`. */
  trend_: function (items, month) {
    var months = [];
    for (var k = 5; k >= 0; k--) months.push(Util.addMonths(month, -k));
    var rows = months.map(function (m) { return { month: m, label: Util.monthShort(m), expense: 0, income: 0, current: m === month }; });
    var index = {};
    rows.forEach(function (r) { index[r.month] = r; });
    items.forEach(function (i) {
      var r = index[i.date.slice(0, 7)];
      if (!r) return;
      if (i.kind === 'INCOME') r.income += i.amount;
      else r.expense += i.amount;
    });
    var max = rows.reduce(function (m, r) { return Math.max(m, r.expense); }, 0);
    rows.forEach(function (r) {
      r.expense = Util.round2(r.expense);
      r.income = Util.round2(r.income);
      r.pct = r.expense > 0 && max > 0 ? Math.max(4, Math.round((r.expense / max) * 100)) : 0;
    });
    return rows;
  },

  /** Last month's expense; for a month still in progress only the same days are counted. */
  previousExpense_: function (items, month, isCurrentMonth, today) {
    var prev = Util.addMonths(month, -1);
    var lastDay = isCurrentMonth ? Number(today.slice(8, 10)) : 31;
    var sum = 0;
    items.forEach(function (i) {
      if (i.kind === 'EXPENSE' && i.date.slice(0, 7) === prev && Number(i.date.slice(8, 10)) <= lastDay) sum += i.amount;
    });
    return { amount: Util.round2(sum), partialDay: isCurrentMonth ? lastDay : 0 };
  },

  insight_: function (d, prev) {
    if (d.count === 0 && d.skipped > 0) {
      return {
        tone: 'neutral',
        text: (d.isCurrentMonth ? 'เดือนนี้' : 'เดือน ' + d.label) + ' มี ' + d.skipped +
          ' รายการ แต่ทั้งหมดอยู่ในสถานะที่ไม่นับรวมในยอดสรุป เมื่อเสร็จแล้วเปลี่ยนสถานะรายการเพื่อให้ตัวเลขขึ้นที่นี่'
      };
    }
    if (d.count === 0) {
      return {
        tone: 'neutral',
        text: d.isCurrentMonth
          ? 'เดือนนี้ยังไม่มีรายการ เริ่มบันทึกรายการแรกได้เลย ทุกตัวเลขจะถูกเก็บไว้ใน Google Sheet ของครอบครัว'
          : 'เดือน ' + d.label + ' ไม่มีรายการที่บันทึกไว้'
      };
    }
    var tone = 'neutral';
    var parts = [];
    if (d.income > 0) {
      parts.push('ใช้ไป ' + Math.round((d.expense / d.income) * 100) + '% ของรายรับ');
    } else {
      parts.push('ใช้ไป ' + Util.baht(d.expense) + ' บาท และยังไม่มีรายรับที่บันทึกไว้');
    }
    if (prev.amount > 0) {
      var delta = Math.round(((d.expense - prev.amount) / prev.amount) * 100);
      var scope = prev.partialDay ? ' (เทียบวันที่ 1-' + prev.partialDay + ' ของทั้งสองเดือน)' : '';
      if (delta < 0) {
        tone = 'good';
        parts.push('ต่ำกว่าเดือนก่อน ' + Math.abs(delta) + '%' + scope);
      } else if (delta > 0) {
        parts.push('สูงกว่าเดือนก่อน ' + delta + '%' + scope);
      } else {
        parts.push('เท่ากับเดือนก่อน' + scope);
      }
    }
    if (d.balance < 0) {
      tone = 'attention';
      parts.push('รายจ่ายมากกว่ารายรับ ' + Util.baht(-d.balance) + ' บาท ลองดูหมวดที่ใช้มากที่สุดเพื่อวางแผนเดือนถัดไป');
    } else if (tone === 'good') {
      parts.push('ทำได้ดีมาก');
    }
    return { tone: tone, text: parts.join(' ') };
  }
};
