// แกะข้อความแจ้งเตือนจาก Telegram ของ V5 TraderMode ให้เป็นแถวของสมุด
//
// ทำไมต้องแกะข้อความแทนที่จะรับ POST จาก agent ตรงๆ:
//   เว็บนี้รันบน localhost → agent บน Render ยิงเข้ามาไม่ได้
//   เมื่อไหร่ย้าย DB ขึ้น Turso ค่อยให้ agent เขียนเอง แล้วไฟล์นี้จะเหลือเป็นทางสำรอง
//
// รูปแบบบรรทัดอ้างอิงจาก main.py (inputs_seen):
//   💰 ราคา {price} · ATR {atr} · {th_time}
//   📐 bias {bias} · {fast}×50 ผ่าน ({scope}) · trigger {trig} USD ({bars} แท่ง)
//   🧱 กำแพง {put_wall} / {call_wall} (strike {ps}/{cs})
//   🎯 SL {sl} · TP {tp} · R:R {rr} (เกณฑ์ {min}) · lot {lot}

const num = (s) => (s === undefined || s === null || s === '' ? null : Number(String(s).replace(/,/g, '')));
const grab = (text, re) => { const m = text.match(re); return m ? m : null; };

const TH_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

/** แปลง "4 ก.ย. 69" (พ.ศ. 2 หลัก) → "2026-09-04" */
function thaiDateToISO(day, monthTh, yy) {
  const mi = TH_MONTHS.indexOf(monthTh);
  if (mi < 0) return null;
  const year = 2500 + Number(yy) - 543;           // 69 → 2569 → ค.ศ. 2026
  return `${year}-${String(mi + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseTelegram(text, { today = new Date() } = {}) {
  const out = {};
  const warn = [];
  const t = String(text ?? '');

  // ── ราคา / ATR / เวลา ────────────────────────────────────────────
  const price = grab(t, /ราคา\s*([\d.,]+)/);
  if (price) out.signal_price = num(price[1]); else warn.push('ไม่เจอราคา');

  const atr = grab(t, /ATR\s*([\d.,]+)/);
  if (atr) out.atr = num(atr[1]); else warn.push('ไม่เจอ ATR');

  const hhmm = grab(t, /\b([0-2]?\d):([0-5]\d)\b/);
  if (hhmm) out.bar_time = `${hhmm[1].padStart(2, '0')}:${hhmm[2]}`; else warn.push('ไม่เจอเวลาแท่ง');

  const thDate = grab(t, /(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{2})/);
  const isoDate = grab(t, /\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (thDate) out.signal_date = thaiDateToISO(thDate[1], thDate[2], thDate[3]);
  else if (isoDate) out.signal_date = isoDate[0];
  else {
    out.signal_date = today.toISOString().slice(0, 10);
    warn.push('ไม่เจอวันที่ในข้อความ — ใช้วันนี้แทน ตรวจก่อนบันทึก');
  }

  // ── ทาง / trigger / แท่ง ─────────────────────────────────────────
  const bias = grab(t, /bias\s*(buy|sell)/i);
  if (bias) out.side = bias[1].toUpperCase();
  else if (/\bSELL\b/.test(t)) out.side = 'SELL';
  else if (/\bBUY\b/.test(t)) out.side = 'BUY';
  else warn.push('ไม่เจอทาง (BUY/SELL)');

  const trig = grab(t, /trigger\s*([\d.,]+)\s*USD/i);
  if (trig) out.trigger_usd = num(trig[1]);

  const bars = grab(t, /\((\d+)\s*แท่ง\)/);
  if (bars) out.bars = Number(bars[1]);

  const cross = grab(t, /×50\s*(ผ่าน|ไม่ผ่าน)/);
  if (cross) out.ema_cross = cross[1] === 'ผ่าน' ? 1 : 0;

  // ── SL / TP / lot / R:R ─────────────────────────────────────────
  const sltp = grab(t, /SL\s*([\d.,]+)\s*·\s*TP\s*([\d.,]+)/);
  if (sltp) { out.planned_sl = num(sltp[1]); out.planned_tp = num(sltp[2]); }
  else warn.push('ไม่เจอ SL/TP');

  const rr = grab(t, /R:R\s*([\d.,]+)/);
  if (rr) out.rr = num(rr[1]);

  const lot = grab(t, /lot\s*([\d.,]+)/i);
  if (lot) out.planned_lot = num(lot[1]);

  if (out.planned_sl != null && out.planned_tp != null && out.signal_price != null) {
    out.planned_dist = Math.round(Math.abs(out.planned_tp - out.signal_price) * 100) / 100;
  }

  // ── กำแพง OI ────────────────────────────────────────────────────
  const walls = grab(t, /กำแพง\s*([\d.,]+)\s*\/\s*([\d.,]+)/);
  if (walls) { out.put_wall = num(walls[1]); out.call_wall = num(walls[2]); }

  const basis = grab(t, /basis[^\d\-]*(-?[\d.,]+)/i);
  if (basis) out.basis = num(basis[1]);

  const wallState = grab(t, /\b(clear|tight|blocked|crossed)\b/i);
  if (wallState) out.wall_state = wallState[1].toLowerCase();
  else warn.push('ไม่เจอ wall_state — กรอกเองถ้ารู้ (ตัวนี้คือของที่สมุดนี้มีไว้วัด)');

  const distAhead = grab(t, /ห่าง(?:แค่)?\s*([\d.,]+)\s*จุด/);
  if (distAhead) out.wall_dist_ahead = num(distAhead[1]);

  // ── ระบบ / session ──────────────────────────────────────────────
  out.system = /\bV6\b/.test(t) ? 'v6' : 'v5';
  if (out.bar_time) {
    const h = Number(out.bar_time.slice(0, 2));
    out.session = h < 12 ? 'morning' : 'evening';
  }

  if (out.signal_date && out.bar_time && out.side) {
    out.trade_id = `${out.signal_date.replace(/-/g, '')}-${out.bar_time.replace(':', '')}-${out.side}`;
  } else {
    warn.push('สร้าง trade_id ไม่ได้ เพราะขาดวันที่/เวลา/ทาง');
  }

  return { row: out, warnings: warn };
}
