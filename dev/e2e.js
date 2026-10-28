'use strict';
/**
 * Browser walkthrough against the local preview (real UI code + real server code + fake workbook).
 *   node dev/e2e.js            checks behaviour and writes screenshots to dev/.screens/
 * Needs Playwright with Chromium (not part of `npm test`).
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer } = require('./server');

const SHOTS = path.join(__dirname, '.screens');
fs.mkdirSync(SHOTS, { recursive: true });

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

async function open(browser, url, as, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width < 721 });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(`${url}/?as=${as}`);
  await page.waitForSelector('.main, .fatal');
  return page;
}

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const text = (page, sel) => page.locator(sel).first().innerText();

(async () => {
  const { server, url } = await startServer({ port: 0 });
  const browser = await chromium.launch();
  const results = [];
  const step = async (name, fn) => {
    try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name + ' :: ' + e.message.split('\n')[0]]); process.exitCode = 1; }
  };

  /* ---------- phone: bottom tabs, add item in a bottom sheet ---------- */
  const phone = await open(browser, url, 'por@gmail.com', PHONE);
  // other people, opened up-front: the desktop walkthrough later removes น้องมิว from the family
  const viewer = await open(browser, url, 'yai@gmail.com', DESKTOP);
  const member = await open(browser, url, 'mew@gmail.com', PHONE);
  const stranger = await open(browser, url, 'stranger@gmail.com', PHONE);

  await step('phone: bottom tab bar replaces the top menu', async () => {
    assert.equal(await phone.locator('.topnav').isVisible(), false);
    assert.equal(await phone.locator('.tabbar').isVisible(), true);
    const box = await phone.locator('.tabbar').boundingBox();
    assert.ok(Math.abs(box.y + box.height - PHONE.height) < 2, 'tab bar sits at the bottom of the screen');
    assert.ok(box.height < 90, 'menu takes little room: ' + box.height);
    await shot(phone, 'phone-dashboard');
  });

  await step('phone: + opens "add item" as a bottom sheet with empty fields and example placeholders', async () => {
    await phone.getByRole('button', { name: 'เพิ่มรายการ' }).click();
    const dlg = phone.getByRole('dialog');
    await dlg.waitFor();
    await phone.waitForTimeout(350); // let the slide-up finish
    const b = await dlg.boundingBox();
    assert.ok(Math.abs(b.y + b.height - PHONE.height) < 2 && b.width === PHONE.width, `sheet is docked to the bottom, full width (${JSON.stringify(b)})`);
    assert.equal(await phone.locator('#f-amount').inputValue(), '');
    assert.equal(await phone.locator('#f-amount').getAttribute('placeholder'), 'เช่น 350.00');
    assert.equal(await phone.locator('#f-name').getAttribute('placeholder'), 'เช่น ค่าน้ำมันรถ');
    assert.equal(await phone.locator('#f-date').inputValue(), '2026-10-25');
    assert.equal(await phone.evaluate(() => document.activeElement.id), 'f-amount', 'focus starts on the amount');
    assert.equal(await phone.locator('#f-statusId option:checked').innerText(), 'ชำระแล้ว', 'new items start as paid');
    assert.deepEqual(await phone.locator('#f-statusId option').allInnerTexts(), ['รอดำเนินการ (ไม่นับในยอดสรุป)', 'ชำระแล้ว', 'ยกเลิก (ไม่นับเลย)']);
    await shot(phone, 'phone-add-item');
  });

  await step('phone: empty submit explains what is missing and keeps the sheet open', async () => {
    await phone.getByRole('button', { name: 'บันทึก' }).click();
    assert.match(await text(phone, '#f-amount-e'), /กรุณาใส่จำนวนเงิน/);
    assert.equal(await phone.locator('#f-amount').getAttribute('aria-invalid'), 'true');
    assert.equal(await phone.getByRole('dialog').isVisible(), true);
  });

  await step('phone: type decides which categories are offered; saving updates the list and dashboard', async () => {
    await phone.locator('#f-typeId').selectOption({ label: 'รายรับ' });
    const cats = await phone.locator('#f-categoryId option').allInnerTexts();
    assert.deepEqual(cats.sort(), ['รายได้ประจำ', 'รายได้เสริม'].sort());
    await phone.locator('#f-typeId').selectOption({ label: 'รายจ่าย' });
    await phone.locator('#f-categoryId').selectOption({ label: 'อาหาร' });
    await phone.locator('#f-amount').fill('1,240.50');
    await phone.locator('#f-name').fill('ก๋วยเตี๋ยวเรือ');
    await phone.getByRole('button', { name: 'บันทึก' }).click();
    await phone.getByRole('dialog').waitFor({ state: 'detached' });
    assert.match(await text(phone, '#toast'), /เพิ่มรายการแล้ว/);
    assert.match(await text(phone, '.recent'), /ก๋วยเตี๋ยวเรือ/);
    assert.match(await text(phone, '.kpis'), /11,780.50/);
    assert.equal(await phone.evaluate(() => document.getElementById('root').inert), false);
  });

  await step('phone: Escape closes a dialog and focus returns to the control that opened it', async () => {
    await phone.getByRole('button', { name: 'เพิ่มรายการ' }).click();
    await phone.keyboard.press('Escape');
    await phone.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await phone.evaluate(() => document.activeElement.getAttribute('aria-label')), 'เพิ่มรายการ');
  });

  await step('phone: "เพิ่มเติม" lifts ประเภท / สถานะ / ผู้ใช้ / ครอบครัว above the bar', async () => {
    await phone.getByRole('button', { name: 'เพิ่มเติม' }).click();
    assert.equal(await phone.locator('.more button').count(), 4);
    await shot(phone, 'phone-more');
    await phone.locator('.more button', { hasText: 'ผู้ใช้' }).click();
    assert.match(await text(phone, 'h1'), /ผู้ใช้ \(User\)/);
    assert.equal(await phone.locator('.more').count(), 0);
    await shot(phone, 'phone-users');
  });

  await step('phone: month stepper moves to the previous month and the trend follows', async () => {
    await phone.getByRole('button', { name: 'ภาพรวม' }).click();
    await phone.getByRole('button', { name: 'เดือนก่อนหน้า' }).click();
    await phone.waitForFunction(() => document.querySelector('.stepper b').textContent === 'ก.ย. 2569');
    assert.match(await text(phone, '.kpis'), /21,000/);
    assert.match(await text(phone, 'h1'), /ภาพรวมเดือน ก\.ย\. 2569/);
  });

  /* ---------- desktop: top menu, modal, edit / delete ---------- */
  const desk = await open(browser, url, 'por@gmail.com', DESKTOP);

  await step('desktop: top pills, no bottom bar', async () => {
    assert.equal(await desk.locator('.topnav').isVisible(), true);
    assert.equal(await desk.locator('.tabbar').isVisible(), false);
    assert.equal(await desk.locator('.pill[aria-current="page"]').innerText(), 'ภาพรวม');
  });

  await step('desktop: items list; edit opens a centred modal pre-filled; saving changes the row', async () => {
    await desk.locator('.pill', { hasText: 'รายการ' }).click();
    assert.match(await text(desk, '.page-h p'), /12 รายการ/); // 11 sample items + the one added on the phone
    await shot(desk, 'desktop-items');
    await desk.getByRole('button', { name: 'แก้ไข ค่าน้ำมันรถ' }).click();
    const dlg = desk.getByRole('dialog');
    await dlg.waitFor();
    await desk.waitForTimeout(350);
    const b = await dlg.boundingBox();
    assert.ok(b.width <= 560 && Math.abs(b.x + b.width / 2 - DESKTOP.width / 2) < 2, 'centred, max 560px wide');
    assert.equal(await desk.locator('#f-amount').inputValue(), '350');
    assert.equal(await desk.locator('#f-name').inputValue(), 'ค่าน้ำมันรถ');
    await shot(desk, 'desktop-edit-item');
    await desk.locator('#f-amount').fill('420');
    await desk.getByRole('button', { name: 'บันทึก' }).click();
    await dlg.waitFor({ state: 'detached' });
    assert.match(await text(desk, '.list'), /-420/);
  });

  await step('desktop: delete asks first, names what will go, and removes the row', async () => {
    await desk.getByRole('button', { name: 'ลบ ค่าน้ำมันรถ' }).click();
    assert.match(await text(desk, '[role=dialog]'), /ลบ “ค่าน้ำมันรถ”.*420 บาท/);
    await shot(desk, 'desktop-delete-item');
    await desk.getByRole('button', { name: 'ลบรายการ' }).click();
    await desk.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await desk.locator('.list', { hasText: 'ค่าน้ำมันรถ' }).count(), 0);
  });

  await step('desktop: dashboard says which statuses it counts and what it left out', async () => {
    await desk.locator('.pill', { hasText: 'ภาพรวม' }).click();
    const scope = await text(desk, '.scope');
    assert.match(scope, /นับเฉพาะรายการที่สถานะ ชำระแล้ว/);
    assert.match(scope, /ไม่รวม 2 รายการในเดือนนี้ \(รอดำเนินการ 1, ยกเลิก 1\) รายจ่าย 3,799 บาท/);
    assert.match(await text(desk, '.kpis'), /11,430.50/, 'pending and cancelled items are not in the expense total');
    await shot(desk, 'desktop-dashboard-scope');
  });

  await step('desktop: ratio card counts every status except cancelled, and says what it added', async () => {
    const card = desk.locator('.overall');
    assert.match(await card.locator('h2').innerText(), /รวมทุกสถานะ ยกเว้นยกเลิก/);
    assert.equal((await card.locator('.ov-r b').innerText()).trim(), '27%');
    assert.match(await card.locator('.lead').innerText(), /^รายจ่ายเป็น 27% ของรายรับ · คงเหลือ 32,970.50 บาท$/);
    const rows = await card.locator('.bar-t').allInnerTexts();
    assert.match(rows[0], /รายรับ[\s\S]*45,000/);
    assert.match(rows[1], /รายจ่าย[\s\S]*ยังไม่เสร็จ 599[\s\S]*12,029.50/);
    const note = await card.locator('.note').innerText();
    assert.match(note, /รวมรายการที่ยังไม่เสร็จ 1 รายการ \(รายจ่าย 599 บาท\) ซึ่งยอดสรุปด้านบนยังไม่นับ · ไม่รวม 1 รายการที่ยกเลิก/);
    assert.equal(await card.locator('.seg .open.exp').count(), 1, 'the open part of the expense bar is drawn');
    assert.match(await text(desk, '.kpis'), /11,430.50/, 'the totals above are unchanged by it');
    await shot(desk, 'desktop-dashboard-overall');
  });

  await step('desktop: status chips filter the items list and show how many each holds', async () => {
    await desk.locator('.pill', { hasText: 'รายการ' }).click();
    assert.deepEqual(await desk.locator('.chip').allInnerTexts(), ['ทั้งหมด\n11', 'รอดำเนินการ\n1', 'ชำระแล้ว\n9', 'ยกเลิก\n1']);
    assert.equal(await desk.locator('.chip[aria-pressed="true"]').innerText().then((t) => t.split('\n')[0]), 'ทั้งหมด');
    await desk.locator('.chip', { hasText: 'รอดำเนินการ' }).click();
    assert.equal(await desk.locator('.list .item').count(), 1);
    assert.match(await text(desk, '.list'), /ค่าอินเทอร์เน็ต/);
    assert.match(await text(desk, '.list .item .tag.st.off'), /รอดำเนินการ/);
    assert.match(await text(desk, '.page-h p'), /1 จาก 11 รายการ/);
    await shot(desk, 'desktop-items-filtered');
    await desk.locator('.chip', { hasText: 'ทั้งหมด' }).click();
    assert.equal(await desk.locator('.list .item').count(), 11);
  });

  await step('desktop: marking a pending bill as paid moves it into the totals', async () => {
    await desk.getByRole('button', { name: 'สถานะ ค่าอินเทอร์เน็ต' }).click();
    const dlg = desk.getByRole('dialog');
    await dlg.waitFor();
    assert.equal(await desk.locator('#f-statusId option:checked').innerText(), 'รอดำเนินการ (ไม่นับในยอดสรุป)');
    await shot(desk, 'desktop-change-status');
    await desk.locator('#f-statusId').selectOption({ label: 'ชำระแล้ว' });
    await desk.getByRole('button', { name: 'บันทึก' }).click();
    await dlg.waitFor({ state: 'detached' });
    assert.match(await text(desk, '#toast'), /เปลี่ยนสถานะแล้ว/);
    await desk.locator('.pill', { hasText: 'ภาพรวม' }).click();
    assert.match(await text(desk, '.kpis'), /12,029.50/);
    assert.match(await text(desk, '.scope'), /ไม่รวม 1 รายการในเดือนนี้ \(ยกเลิก 1\) รายจ่าย 3,200 บาท/);
    assert.equal((await desk.locator('.overall .ov-r b').innerText()).trim(), '27%', 'the ratio does not move: the bill was already in it');
    assert.match(await text(desk, '.overall .note'), /ตรงกับยอดสรุปด้านบน เพราะเดือนนี้ไม่มีรายการที่ยังไม่เสร็จ · ไม่รวม 1 รายการที่ยกเลิก/);
    assert.equal(await desk.locator('.overall .seg .open').evaluateAll((n) => n.every((x) => x.getBoundingClientRect().width === 0)), true);
  });

  await step('desktop: managing statuses: add one, stop counting another, delete with items asks where to move them', async () => {
    await desk.locator('.pill', { hasText: 'สถานะ' }).click();
    assert.match(await text(desk, 'h1'), /สถานะ \(Status\)/);
    const listText = await text(desk, '.list');
    assert.match(listText, /ชำระแล้ว[\s\S]*นับรวมในยอดสรุป และในสัดส่วนทุกสถานะ · 15 รายการ · เริ่มต้นของรายการใหม่/, JSON.stringify(listText));
    // the only status that counts cannot stop counting
    await desk.getByRole('button', { name: 'แก้ไข ชำระแล้ว' }).click();
    assert.deepEqual(await desk.locator('#f-meaning option').allInnerTexts(), ['เสร็จแล้ว (นับรวมในยอดสรุป)', 'ยังไม่เสร็จ (ไม่นับในยอดสรุป)', 'ยกเลิก (ไม่นับเลย)']);
    await desk.locator('#f-meaning').selectOption({ label: 'ยกเลิก (ไม่นับเลย)' });
    await desk.getByRole('button', { name: 'บันทึก' }).click();
    await desk.locator('#f-meaning-e', { hasText: /ต้องมีสถานะที่นับรวมในยอดสรุปอย่างน้อย 1 สถานะ/ }).waitFor();
    await desk.keyboard.press('Escape');

    await desk.getByRole('button', { name: '+ เพิ่มสถานะ' }).click();
    assert.equal(await desk.locator('#f-name').getAttribute('placeholder'), 'เช่น รอดำเนินการ');
    await desk.locator('#f-name').fill('ชำระแล้ว');
    await desk.getByRole('button', { name: 'บันทึก' }).click();
    await desk.locator('#f-name-e', { hasText: /มีสถานะชื่อ "ชำระแล้ว" อยู่แล้ว/ }).waitFor();
    await desk.locator('#f-name').fill('ผ่อนชำระ');
    await shot(desk, 'desktop-add-status');
    await desk.getByRole('button', { name: 'บันทึก' }).click();
    await desk.getByRole('dialog').waitFor({ state: 'detached' });
    assert.match(await text(desk, '.list'), /ผ่อนชำระ/);

    await desk.getByRole('button', { name: 'ลบ ยกเลิก' }).click();
    assert.match(await text(desk, '[role=dialog]'), /มี 1 รายการ เลือกสถานะที่จะย้ายรายการไป/);
    await desk.locator('#f-moveToId').selectOption({ label: 'รอดำเนินการ (ไม่นับในยอดสรุป)' });
    await shot(desk, 'desktop-delete-status');
    await desk.getByRole('button', { name: 'ย้ายรายการและลบสถานะ' }).click();
    await desk.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await desk.locator('.list .item', { hasText: /^ยกเลิก/ }).count(), 0);
    assert.match(await text(desk, '.list'), /รอดำเนินการ[\s\S]*ไม่นับในยอดสรุป แต่นับในสัดส่วนทุกสถานะ · 1 รายการ/);
  });

  await step('desktop: deleting a category that has items asks where to move them', async () => {
    await desk.locator('.pill', { hasText: 'หมวดหมู่' }).click();
    await desk.getByRole('button', { name: 'ลบ อาหาร' }).click();
    assert.match(await text(desk, '[role=dialog]'), /เลือกหมวดที่จะย้ายรายการไป/);
    await desk.locator('#f-moveToId').selectOption({ label: 'บ้านและสาธารณูปโภค' });
    await shot(desk, 'desktop-delete-category');
    await desk.getByRole('button', { name: 'ย้ายรายการและลบหมวด' }).click();
    await desk.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await desk.locator('.list .item', { hasText: /^อาหาร/ }).count(), 0);
    await desk.locator('.pill', { hasText: 'รายการ' }).click();
    assert.match(await text(desk, '.list'), /ซื้อของเข้าบ้าน/);
    assert.match(await text(desk, '.list'), /บ้านและสาธารณูปโภค · แม่/);
  });

  await step('desktop: adding a user needs a valid email and shows the server message under the field', async () => {
    await desk.locator('.pill', { hasText: 'ผู้ใช้' }).click();
    await desk.getByRole('button', { name: '+ เพิ่มผู้ใช้' }).click();
    await desk.locator('#f-name').fill('ลุง');
    await desk.locator('#f-email').fill('lung-at-gmail');
    await desk.getByRole('button', { name: 'บันทึก' }).click();
    await desk.locator('#f-email-e', { hasText: /รูปแบบอีเมลไม่ถูกต้อง/ }).waitFor(); // the server answers asynchronously
    await desk.locator('#f-email').fill('mew@gmail.com');
    await desk.getByRole('button', { name: 'บันทึก' }).click();
    await desk.locator('#f-email-e', { hasText: /อยู่ในครอบครัวนี้แล้ว/ }).waitFor();
    await shot(desk, 'desktop-add-user-error');
    await desk.locator('#f-email').fill('lung@gmail.com');
    await desk.getByRole('button', { name: 'บันทึก' }).click();
    await desk.getByRole('dialog').waitFor({ state: 'detached' });
    assert.match(await text(desk, '.list'), /lung@gmail\.com/);
  });

  await step('desktop: removing a user who owns items offers to hand them over', async () => {
    await desk.getByRole('button', { name: 'ลบ น้องมิว' }).click();
    assert.match(await text(desk, '[role=dialog]'), /เป็นเจ้าของ \d+ รายการ/);
    await desk.locator('#f-reassignToId').selectOption({ label: 'แม่' });
    await desk.getByRole('button', { name: 'นำออก' }).click();
    await desk.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await desk.locator('.list', { hasText: 'น้องมิว' }).count(), 0);
  });

  await step('desktop: families: create, switch from the chip, and the list marks the one in use', async () => {
    await desk.locator('.pill', { hasText: 'ครอบครัว' }).click();
    assert.equal(await desk.locator('.item[aria-current="true"]').count(), 1);
    await desk.getByRole('button', { name: '+ สร้างครอบครัว' }).click();
    await desk.locator('#f-name').fill('บ้านป้า');
    await desk.getByRole('button', { name: 'บันทึก' }).click();
    await desk.getByRole('dialog').waitFor({ state: 'detached' });
    assert.match(await text(desk, '.fam'), /บ้านป้า/);
    await desk.locator('.fam').click();
    await desk.locator('#f-familyId').selectOption({ label: 'บ้านสุขใจ' });
    await desk.getByRole('button', { name: 'แสดง', exact: true }).click();
    await desk.getByRole('dialog').waitFor({ state: 'detached' });
    assert.match(await text(desk, '.fam'), /บ้านสุขใจ/);
    await shot(desk, 'desktop-families');
  });

  /* ---------- roles and access ---------- */
  await step('viewer: reads everything, no add / edit / delete anywhere', async () => {
    for (const tab of ['รายการ', 'ประเภท', 'หมวดหมู่', 'สถานะ', 'ผู้ใช้']) {
      await viewer.locator('.pill', { hasText: tab }).click();
      assert.equal(await viewer.getByRole('button', { name: /^\+ เพิ่ม/ }).count(), 0, tab);
      assert.equal(await viewer.locator('.act').count(), tab === 'ผู้ใช้' ? 1 : 0, tab + ' (ผู้ใช้: only renaming yourself)');
    }
  });

  await step('member: owner field is fixed to themselves; cannot edit others\' rows', async () => {
    await member.getByRole('button', { name: 'เพิ่มรายการ' }).click();
    assert.equal(await member.locator('#f-ownerId').isDisabled(), true);
    await member.keyboard.press('Escape');
    await member.getByRole('button', { name: 'รายการ', exact: true }).click();
    const editable = await member.locator('.item', { has: member.locator('.act') }).allInnerTexts();
    assert.equal(editable.length, 2, 'only the two rows น้องมิว owns can be changed');
    assert.ok(editable.every((t) => t.includes('น้องมิว')));
    assert.equal(await member.getByRole('button', { name: /^สถานะ / }).count(), 2, 'quick status change only on their own rows');
  });

  await step('stranger: told they are not invited, with the email shown and a retry', async () => {
    assert.match(await text(stranger, '.fatal h1'), /ยังไม่ได้รับเชิญ/);
    assert.match(await text(stranger, '.fatal'), /stranger@gmail\.com/);
    assert.equal(await stranger.getByRole('button', { name: 'ลองอีกครั้ง' }).count(), 1);
    await shot(stranger, 'phone-not-invited');
  });

  /* ---------- responsive sweep ---------- */
  await step('responsive: no sideways scrolling, 44px touch targets, from 320 to 1920 wide', async () => {
    const page = await open(browser, url, 'por@gmail.com', { width: 1280, height: 900 });
    for (const width of [320, 360, 390, 414, 600, 720, 721, 768, 820, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const tab of ['ภาพรวม', 'รายการ', 'ประเภท', 'หมวดหมู่', 'สถานะ', 'ผู้ใช้', 'ครอบครัว']) {
        const nav = width <= 720
          ? async () => {
            if (['ประเภท', 'สถานะ', 'ผู้ใช้', 'ครอบครัว'].includes(tab)) {
              await page.getByRole('button', { name: 'เพิ่มเติม' }).click();
              await page.locator('.more button', { hasText: tab }).click();
            } else {
              await page.locator('.tabs .tab', { hasText: tab }).click();
            }
          }
          : () => page.locator('.pill', { hasText: tab }).click();
        await nav();
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(over <= 0, `${tab} @${width}: page is ${over}px wider than the screen`);
        const small = await page.evaluate(() => Array.from(document.querySelectorAll('button, a.skip, select, input'))
          .filter((n) => n.offsetParent !== null && !n.closest('.skip'))
          .map((n) => ({ n: (n.getAttribute('aria-label') || n.textContent || n.id).trim().slice(0, 20), h: n.getBoundingClientRect().height, w: n.getBoundingClientRect().width }))
          .filter((b) => b.h < 43.5 || b.w < 43.5));
        assert.deepEqual(small, [], `${tab} @${width}: targets under 44px`);
      }
      if ([320, 768, 1920].includes(width)) await shot(page, `responsive-${width}`);
    }
  });

  await step('no script errors in any session', async () => {
    const all = [phone, desk, viewer, member, stranger].flatMap((p) => p.errors);
    assert.deepEqual(all.filter((e) => !/403|Failed to load resource/.test(e)), []);
  });

  await browser.close();
  server.close();
  for (const [status, name] of results) console.log(`${status === 'ok' ? '✓' : '✗'} ${name}`);
  console.log(`\n${results.filter((r) => r[0] === 'ok').length}/${results.length} passed · screenshots in ${path.relative(process.cwd(), SHOTS)}/`);
})();
