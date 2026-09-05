// วิเคราะห์สมุดไม้จริง — ฟังก์ชันล้วน ไม่แตะ DB (เทสได้ด้วยข้อมูลสังเคราะห์ · ใช้ซ้ำได้ทั้ง server/CLI)
//
// ★ หลักสามข้อที่ฝังอยู่ในไฟล์นี้ (มาจากสมุดเล่มเก่า ไม่ใช่ความชอบ):
//   1) ทุกอย่างคิด "ต่อ ruleset" — ตัวเรียกต้องส่ง trades ของ ruleset เดียวเข้ามา ไม่มีการรวมข้ามระบอบ
//   2) "ตามแผน" กับ "ทำจริง" แยกกันเสมอ — planned_lot/planned_sl มาจาก TradingView (ตั้งใจ)
//      lot/entry_price/profit มาจาก MT4 (ทำจริง) → เทียบสองฝั่งได้ = ตัวจับผิดที่ไม่ต้องให้คนรายงานตัวเอง
//   3) ไม้ที่จบด้วย 'manual' ไม่ปนกับไม้ที่จบตามกฎ (tp/sl) — คนละประชากร (บทเรียนไม้ 4 ก.ย. 69)

// XAUUSD: 1 lot = 100 oz → ราคาขยับ 1 USD = 100 USD ต่อ lot (0.15 lot × 20 USD × 100 = 300 ✓ ตรงกับสมุดเก่า)
export const USD_PER_LOT_PER_DOLLAR = 100;

export const SETTLED = new Set(['tp', 'sl']);          // จบตามกฎ → นับสถิติ Win % ได้
export const CLOSED  = new Set(['tp', 'sl', 'manual']); // มีเงินจริงเข้า-ออก → นับ P&L ได้

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** "2026-09-04" + "21:00" → เวลาปิดแท่งที่ดาบออก (สตริงเทียบได้ตรงๆ เพราะฟอร์แมต ISO เรียงตามตัวอักษร) */
export function signalCloseAt(t) {
  if (!t.signal_date) return null;
  return `${t.signal_date} ${t.bar_time ?? '00:00'}`;
}

/** เวลาที่ใช้เรียงลำดับไม้: ปิดจริง > เข้าจริง > แท่งที่ยิง */
export function sortKey(t) {
  return t.exit_at || t.entry_at || signalCloseAt(t) || '';
}

/** ความเสี่ยงที่ "ตั้งใจ" ไว้ตอนดาบออก (USD) = planned_lot × ระยะ SL × 100 */
export function plannedRisk(t) {
  const lot = num(t.planned_lot), dist = num(t.planned_dist);
  if (lot == null || dist == null || lot <= 0 || dist <= 0) return null;
  return lot * dist * USD_PER_LOT_PER_DOLLAR;
}

/** R-multiple = กำไรจริง ÷ ความเสี่ยงที่ตั้งใจไว้ — ไม้ที่ lot เกินแผน 3 เท่าจะโผล่เป็น ±3R ทันที */
export function rMultiple(t) {
  const risk = plannedRisk(t), p = num(t.profit);
  if (!CLOSED.has(t.outcome) || risk == null || p == null) return null;
  return p / risk;
}

/** P&L "ถ้าเข้าตามแผน" = กำไรจริง × (planned_lot ÷ lot) — ราคาเข้า/ออกเท่าเดิม แค่ขนาดไม้ตามแผน */
export function planProfit(t) {
  const p = num(t.profit);
  if (!CLOSED.has(t.outcome) || p == null) return null;
  const lot = num(t.lot), plan = num(t.planned_lot);
  if (lot && plan && lot > 0) return p * (plan / lot);
  return p;
}

// ---------- เครื่องคิดแผนก่อนเข้าไม้ — สูตรต้องตรงกับ f_roundDist() ใน Pine เป๊ะ ----------
// เหตุผลที่ต้องอยู่ฝั่ง server: มันคือ "แหล่งความจริงเดียว" ของเลขที่ต้นจะเอาไปตั้งที่โบรก
// ถ้าปล่อยให้ UI คิดเอง วันหนึ่งสองฝั่งจะค้างคนละสูตร แล้วไม่มีอะไรฟ้อง
export function planGeometry({ price, atr, side, dist: distIn }, cfg = {}) {
  const mult = Number(cfg.sltp_mult ?? 2.0), step = Number(cfg.sltp_step ?? 5);
  const minDist = Number(cfg.sltp_min_dist ?? 10), risk = Number(cfg.risk_usd ?? 300);
  const p = num(price), a = num(atr), given = num(distIn);

  let dist = given, raw = null;
  if (dist == null && a != null) {
    raw = mult * a;
    const floor = Math.max(minDist, step);
    dist = step <= 0 ? Math.max(minDist, raw) : Math.max(floor, Math.ceil(raw / step) * step);
  }
  if (dist == null) return { error: 'ต้องมี ATR หรือระยะอย่างน้อยหนึ่งอย่าง' };

  // lot ปัด **ลง** เสมอ — ปัดขึ้นแปลว่าเสี่ยงเกินที่ตั้งใจ ซึ่งคือสิ่งที่ทั้งเว็บนี้มีไว้กัน
  const oz = risk / dist;
  const lot = Math.floor((oz / 100) * 100) / 100;
  const realRisk = lot * dist * USD_PER_LOT_PER_DOLLAR;

  const buy = String(side).toUpperCase() === 'BUY';
  return {
    dist, raw_dist: raw == null ? null : Math.round(raw * 100) / 100,
    rounded: raw != null && Math.abs(dist - raw) > 0.05,
    lot, risk_target: risk, risk_actual: Math.round(realRisk * 100) / 100,
    sl: p == null ? null : Math.round((buy ? p - dist : p + dist) * 100) / 100,
    tp: p == null ? null : Math.round((buy ? p + dist : p - dist) * 100) / 100,
    cfg: { mult, step, min_dist: minDist, risk },
  };
}

// ---------- ธงจับผิด 4 ตัว (ของที่ต้นเคยเขียนเองในชีททุกเดือน แต่โปรแกรมตรวจได้เอง) ----------
// ⚠️ held_past_23 เป็น "ข้อมูล" ไม่ใช่ "ความผิด" — กฎเว็บข้อ 06 (ปิดจอ 23:00) กับคอนฟิก closeEnd=ปิด
//    ขัดกันอยู่และยังไม่ได้วัด (รอบ E ค้าง) → ห้ามนับเป็นแหกแผนจนกว่ารอบ E จะมีตัวเลข
export const VIOLATION_KEYS = ['early_entry', 'oversize', 'multi_ticket', 'moved_sltp', 'manual_close'];
export const FLAG_LABELS = {
  early_entry:  'เข้าก่อนดาบออก',
  oversize:     'lot เกินแผน',
  multi_ticket: 'เข้าหลายไม้',
  moved_sltp:   'ขยับ SL/TP',
  manual_close: 'ปิดมือ',
  held_past_23: 'ถือเลย 23:00 (รอบ E ยังไม่ตัดสิน · ไม่นับเป็นแหกแผน)',
};

// เผื่อสลิป/สเปรด: 10% ของระยะ แต่ไม่ต่ำกว่า 1 USD — กว้างกว่านี้ธงจะไม่จับ แคบกว่านี้จะยิงมั่วตอนข่าว
// (ระยะ 20 → เผื่อ 2.0 · ระยะ 40 → เผื่อ 4.0)
export function sltpTolerance(dist) {
  return Math.max(1.0, (dist ?? 0) * 0.1);
}

export function flags(t) {
  const sig = signalCloseAt(t);
  const lot = num(t.lot), plan = num(t.planned_lot);
  // ★ ขยับ SL/TP: ไม้ที่ระบบบอกว่าจบด้วย TP/SL ต้องปิดที่ราคานั้นจริง (เผื่อสลิปแล้ว)
  //   ปิดคนละราคา = เลื่อนเส้นที่โบรก หรือปิดมือแล้วรายงานเป็น tp/sl — ทั้งสองอย่างคือไม้ที่ไม่ได้เดินตามแผน
  //   ต้องมีทั้ง exit_price และเส้นที่ตั้งไว้ถึงจะตัดสิน — ขาดข้อมูล = ไม่ยิงธง (ไม่เดา)
  const exit = num(t.exit_price), dist = num(t.planned_dist);
  const target = t.outcome === 'tp' ? num(t.planned_tp) : t.outcome === 'sl' ? num(t.planned_sl) : null;
  const f = {
    early_entry:  !!(t.entry_at && sig && t.entry_at < sig),
    oversize:     !!(lot != null && plan != null && plan > 0 && lot > plan * 1.05), // เผื่อปัด lot 5%
    multi_ticket: (num(t.mt4_tickets) ?? 1) > 1,
    moved_sltp:   !!(exit != null && target != null && Math.abs(exit - target) > sltpTolerance(dist)),
    manual_close: t.outcome === 'manual',
    held_past_23: !!(t.exit_at && t.exit_at.length >= 16 &&
                     (t.exit_at.slice(0, 10) > (t.signal_date ?? '') || t.exit_at.slice(11, 16) > '23:00')),
  };
  f.violations = VIOLATION_KEYS.filter((k) => f[k]);
  f.clean = f.violations.length === 0;
  return f;
}

/** แปะค่าที่คำนวณได้ลงบนไม้ (ไม่แก้ของเดิม) — UI กับ API ใช้ตัวเดียวกัน จะได้ไม่มีสองมาตรฐาน */
export function enrich(t) {
  return {
    ...t,
    planned_risk: plannedRisk(t),
    r: rMultiple(t),
    plan_profit: planProfit(t),
    flags: flags(t),
    sort_key: sortKey(t),
  };
}

// ---------- สถิติ ----------
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const sd = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const round = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

/** equity curve + drawdown จากลำดับกำไรต่อไม้ */
function equityPath(vals) {
  let eq = 0, peak = 0, maxDD = 0;
  const equity = [], dd = [];
  for (const v of vals) {
    eq += v;
    peak = Math.max(peak, eq);
    const d = eq - peak;
    maxDD = Math.min(maxDD, d);
    equity.push(eq);
    dd.push(d);
  }
  return { equity, dd, maxDD: -maxDD };
}

function streaks(outcomes) {
  let cur = 0, curType = null, maxLoss = 0, maxWin = 0, run = 0, runType = null;
  for (const o of outcomes) {
    const type = o === 'tp' ? 'W' : o === 'sl' ? 'L' : null;
    if (!type) continue;
    if (type === runType) run += 1; else { run = 1; runType = type; }
    if (type === 'W') maxWin = Math.max(maxWin, run); else maxLoss = Math.max(maxLoss, run);
    cur = run; curType = runType;
  }
  return { current: cur, current_type: curType, max_win: maxWin, max_loss: maxLoss };
}

const WEEKDAYS_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

/**
 * สรุปทั้ง ruleset — รับ trades ของ ruleset เดียว (ผู้เรียกต้องกรองมาก่อน)
 * @param {object[]} trades แถวจากตาราง trades
 * @param {{freeze_min_trades?: number}} settings
 */
export function analyze(trades, settings = {}) {
  const all = trades.map(enrich).sort((a, b) => a.sort_key.localeCompare(b.sort_key));
  const closed  = all.filter((t) => CLOSED.has(t.outcome) && num(t.profit) != null);
  const settled = all.filter((t) => SETTLED.has(t.outcome));
  const wins = settled.filter((t) => t.outcome === 'tp');
  const losses = settled.filter((t) => t.outcome === 'sl');

  const profits = closed.map((t) => Number(t.profit));
  const plans   = closed.map((t) => t.plan_profit ?? Number(t.profit));
  const grossWin  = profits.filter((p) => p > 0).reduce((s, p) => s + p, 0);
  const grossLoss = -profits.filter((p) => p < 0).reduce((s, p) => s + p, 0);

  const actual = equityPath(profits);
  const plan   = equityPath(plans);

  const rs = closed.map((t) => t.r).filter((r) => r != null);
  const rMean = mean(rs), rSd = sd(rs);
  const rSe = rSd != null ? rSd / Math.sqrt(rs.length) : null;

  // ---- ตัวจับผิด ----
  const viol = Object.fromEntries(VIOLATION_KEYS.map((k) => [k, closed.filter((t) => t.flags[k]).length]));
  const cleanN = closed.filter((t) => t.flags.clean).length;
  const heldPast23 = closed.filter((t) => t.flags.held_past_23).length;
  const net = profits.reduce((s, p) => s + p, 0);
  const planNet = plans.reduce((s, p) => s + p, 0);

  // ---- แจกแจงตามวัน/ชั่วโมง (นับเฉพาะไม้ที่มีเงินจริง) ----
  const byWeekday = [1, 2, 3, 4, 5].map((d) => ({ day: d, label: WEEKDAYS_TH[d], n: 0, net: 0 }));
  const byHour = new Map();
  const byDate = new Map();
  for (const t of closed) {
    const p = Number(t.profit);
    if (t.signal_date) {
      const d = new Date(`${t.signal_date}T00:00:00Z`).getUTCDay();
      const row = byWeekday.find((r) => r.day === d);
      if (row) { row.n += 1; row.net += p; }
      const c = byDate.get(t.signal_date) ?? { date: t.signal_date, n: 0, net: 0 };
      c.n += 1; c.net += p; byDate.set(t.signal_date, c);
    }
    if (t.bar_time) {
      const h = t.bar_time.slice(0, 2);
      const c = byHour.get(h) ?? { hour: h, n: 0, net: 0 };
      c.n += 1; c.net += p; byHour.set(h, c);
    }
  }

  // ---- ฮิสโตแกรม R (ช่องละ 0.5R · ปลายรวบเป็น ≤−3 / ≥+3) ----
  const rBins = new Map();
  for (const r of rs) {
    const clamped = Math.max(-3, Math.min(3, r));
    const b = Math.round(clamped * 2) / 2;
    rBins.set(b, (rBins.get(b) ?? 0) + 1);
  }

  // ---- freeze gate: ห้ามแก้คอนฟิกจนกว่าจะครบ N ไม้ที่จบตามกฎ ----
  const freezeMin = num(settings.freeze_min_trades) ?? 20;
  const remaining = Math.max(0, freezeMin - settled.length);

  return {
    counts: {
      total: all.length, closed: closed.length, settled: settled.length,
      tp: wins.length, sl: losses.length,
      manual: all.filter((t) => t.outcome === 'manual').length,
      open: all.filter((t) => t.outcome === 'open').length,
      not_taken: all.filter((t) => t.outcome === 'not_taken').length,
    },
    // Win % นับเฉพาะไม้ที่จบตามกฎ — SE ใส่มาด้วยจะได้ไม่อ่าน 5 ไม้แล้วสรุป
    win_pct: settled.length ? round((wins.length / settled.length) * 100, 1) : null,
    win_pct_se: settled.length ? round(Math.sqrt((wins.length / settled.length) * (1 - wins.length / settled.length) / settled.length) * 100, 1) : null,
    profit_factor: grossLoss > 0 ? round(grossWin / grossLoss, 3) : null,   // ไม่มีไม้แพ้เลย = PF นิยามไม่ได้ (ไม่ใช่ ∞)
    net: round(net), plan_net: round(planNet),
    leak: round(net - planNet),                      // + = แหกแผนแล้วได้เพิ่ม · − = แหกแผนแล้วเสีย (ทั้งคู่คือความเสี่ยงที่ไม่ได้วัด)
    avg_win: round(mean(profits.filter((p) => p > 0))),
    avg_loss: round(mean(profits.filter((p) => p < 0))),
    expectancy_r: round(rMean, 3), expectancy_r_se: round(rSe, 3), r_n: rs.length,
    max_dd: round(actual.maxDD), max_dd_plan: round(plan.maxDD),
    net_over_dd: actual.maxDD > 0 ? round(net / actual.maxDD, 2) : null,
    streaks: streaks(settled.map((t) => t.outcome)),
    discipline: {
      clean: cleanN, closed: closed.length,
      adherence_pct: closed.length ? round((cleanN / closed.length) * 100, 1) : null,
      violations: viol, held_past_23: heldPast23,
    },
    freeze: { min: freezeMin, settled: settled.length, remaining, unlocked: remaining === 0 },
    equity: closed.map((t, i) => ({
      i, trade_id: t.trade_id, date: t.signal_date, key: t.sort_key,
      profit: round(Number(t.profit)), r: round(t.r, 2),
      actual: round(actual.equity[i]), plan: round(plan.equity[i]), dd: round(actual.dd[i]),
      clean: t.flags.clean, outcome: t.outcome,
    })),
    by_weekday: byWeekday.map((r) => ({ ...r, net: round(r.net) })),
    by_hour: [...byHour.values()].sort((a, b) => a.hour.localeCompare(b.hour)).map((r) => ({ ...r, net: round(r.net) })),
    by_date: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ ...r, net: round(r.net) })),
    r_hist: [...rBins.entries()].sort((a, b) => a[0] - b[0]).map(([r, n]) => ({ r, n })),
    trades: all,
  };
}
