'use strict';
/** Fills the fake workbook with the household from the approved design (บ้านสุขใจ). */
function seedSample(gas) {
  const req = (action, payload, as) => {
    const res = gas.request(action, payload, as);
    if (!res.ok) throw new Error(`${action}: ${res.error.message}`);
    return res.data;
  };
  const por = 'por@gmail.com';
  let { state } = req('state', {}, por);
  const familyId = state.family.id;
  const view = { familyId };
  req('family.save', { id: familyId, name: 'บ้านสุขใจ', view }, por);
  req('user.save', { familyId, userId: state.me.id, name: 'พ่อ', email: por, role: 'admin', view }, por);
  const mae = req('user.save', { familyId, email: 'mae@gmail.com', name: 'แม่', role: 'admin', view }, por).result.id;
  const mew = req('user.save', { familyId, email: 'mew@gmail.com', name: 'น้องมิว', role: 'member', view }, por).result.id;
  req('user.save', { familyId, email: 'yai@gmail.com', name: 'ยาย', role: 'viewer', view }, por);
  state = req('state', { view }, por).state;
  const cat = (n) => state.family.categories.find((c) => c.name === n).id;
  const me = state.me.id;
  const status = (n) => state.family.statuses.find((s) => s.name === n).id;
  const add = (name, amount, date, category, ownerId, statusName) =>
    req('item.save', { familyId, name, amount, date, categoryId: cat(category), ownerId, statusId: statusName ? status(statusName) : undefined, view }, por);

  // this month
  add('เงินเดือน', 30000, '2026-10-24', 'รายได้ประจำ', me);
  add('ขายของออนไลน์', 1200, '2026-10-22', 'รายได้เสริม', mae);
  add('เงินเดือนแม่', 13800, '2026-10-01', 'รายได้ประจำ', mae);
  add('ค่าน้ำมันรถ', 350, '2026-10-25', 'เดินทาง', me);
  add('ซื้อของเข้าบ้าน', 1240, '2026-10-25', 'อาหาร', mae);
  add('ค่าเรียนพิเศษ', 1800, '2026-10-23', 'การศึกษา', mae);
  add('ค่าไฟ', 2450, '2026-10-12', 'บ้านและสาธารณูปโภค', me);
  add('ข้าวกลางวัน', 4200, '2026-10-08', 'อาหาร', mew);
  add('ค่าเดินทางไปโรงเรียน', 500, '2026-10-05', 'เดินทาง', mew);
  // not counted in the totals: a bill still to pay and a booking that was cancelled
  add('ค่าอินเทอร์เน็ต', 599, '2026-10-28', 'บ้านและสาธารณูปโภค', me, 'รอดำเนินการ');
  add('จองโรงแรม', 3200, '2026-10-20', 'เดินทาง', mae, 'ยกเลิก');
  // earlier months for the trend
  [['2026-09', 21000], ['2026-08', 24500], ['2026-07', 19800], ['2026-06', 23100], ['2026-05', 17600]].forEach(([m, amount]) => {
    add('รายจ่ายรวม ' + m, amount, m + '-15', 'อาหาร', me);
  });

  req('family.save', { name: 'บ้านคุณยาย', view }, por);
  return { familyId, ids: { me, mae, mew } };
}

module.exports = { seedSample };
