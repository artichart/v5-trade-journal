// สร้างข้อมูลสังเคราะห์ลง DB ชั่วคราว — ใช้ทดสอบแดชบอร์ดเท่านั้น
// ⛔ ห้ามรันโดยไม่ตั้ง JOURNAL_DB — สคริปต์ปฏิเสธเองถ้าชี้ไปที่ data/journal.db ของจริง
//   ใช้: JOURNAL_DB=/tmp/x/demo.db node scripts/seed-demo.js
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.env.JOURNAL_DB;
const real = resolve(fileURLToPath(import.meta.url), '../../data/journal.db');
if (!target || resolve(target) === real) {
  console.error('⛔ ต้องตั้ง JOURNAL_DB ชี้ไปที่ไฟล์ชั่วคราว (ไม่ใช่ data/journal.db)');
  process.exit(1);
}

const { db, q, insertTrade } = await import('../src/db.js');

// ตัวสุ่มแบบกำหนด seed ได้ → ผลซ้ำได้ทุกครั้ง เอาไว้เทียบเลขด้วยมือ
let seed = 20260905;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const cur = q.currentRuleset();
db.exec('DELETE FROM trades');

// จำลอง 38 ไม้ · จ–ศ · เย็น 19:15–22:45 · ATR 8–20 · R:R 1:1 · Win 60%
// แทรก "อาการจริง" จากสมุดเก่าไว้ให้ตัวจับผิดมีอะไรให้จับ: lot เกินแผน 3 ไม้ · เข้าก่อนดาบ 2 · หลายไม้ 1 · ปิดมือ 2
let d = new Date('2026-09-07T00:00:00Z');
const rows = [];
while (rows.length < 38) {
  const dow = d.getUTCDay();
  if (dow >= 1 && dow <= 5 && rand() < 0.75) {
    const date = d.toISOString().slice(0, 10);
    const hh = 19 + Math.floor(rand() * 4), mm = [15, 30, 45, 0][Math.floor(rand() * 4)];
    const bar = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const side = rand() < 0.5 ? 'BUY' : 'SELL';
    const atr = 8 + rand() * 12;
    const dist = Math.max(10, Math.ceil((2 * atr) / 5) * 5);
    const plannedLot = Math.round((300 / dist / 100) * 100) / 100;
    const price = 4400 + rand() * 200;
    const win = rand() < 0.6;
    const i = rows.length;
    let lot = plannedLot, entryAt = `${date} ${bar}`, outcome = win ? 'tp' : 'sl', tickets = 1;
    if ([5, 17, 29].includes(i)) lot = Math.round(plannedLot * (3 + rand() * 4) * 100) / 100;      // lot เกินแผน
    if ([9, 23].includes(i)) entryAt = `${date} ${String(hh).padStart(2, '0')}:${String(Math.max(0, mm - 10)).padStart(2, '0')}`; // เข้าก่อนดาบ
    if (i === 14) tickets = 3;                                                                        // เข้าหลายไม้
    if ([11, 31].includes(i)) outcome = 'manual';                                                     // ปิดมือ
    const sign = outcome === 'tp' ? 1 : outcome === 'sl' ? -1 : (rand() < 0.5 ? 0.4 : -0.6);
    const profit = Math.round(sign * lot * dist * 100 * 100) / 100;
    rows.push({
      trade_id: `${date.replace(/-/g, '')}-${bar.replace(':', '')}-${side}`,
      ruleset_id: cur.id, signal_date: date, bar_time: bar, session: 'evening', side,
      signal_price: +price.toFixed(2), atr: +atr.toFixed(1), trigger_usd: +(atr * (1 + rand())).toFixed(1),
      tf_count: 4, tf_list: 'H4/H1/M30/M15', ema_cross: 1,
      planned_sl: +(side === 'BUY' ? price - dist : price + dist).toFixed(2),
      planned_tp: +(side === 'BUY' ? price + dist : price - dist).toFixed(2),
      planned_dist: dist, planned_lot: plannedLot, rr: 1,
      wall_state: ['clear', 'clear', 'tight', 'crossed'][Math.floor(rand() * 4)],
      entry_price: +(price + (rand() - 0.5)).toFixed(2), entry_at: entryAt,
      exit_at: `${date} ${String(Math.min(23, hh + 1 + Math.floor(rand() * 2))).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
      lot, mt4_tickets: tickets, profit, outcome,
    });
  }
  d = new Date(d.getTime() + 86400000);
}
for (const r of rows) insertTrade(r);
console.log(`seed แล้ว ${rows.length} ไม้ ลง ${target} (ruleset ${cur.code})`);
