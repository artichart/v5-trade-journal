// ที่เก็บข้อมูลฝั่งเบราว์เซอร์ — ใช้แทน src/db.js + src/server.js ในเวอร์ชัน static
//
// ★ ทำไม localStorage ไม่ใช่ IndexedDB: ไม้หนึ่งประมาณ 400 ไบต์ · 1,000 ไม้ ≈ 400KB
//   ยังห่างเพดาน ~5MB มาก และ localStorage อ่าน/เขียนแบบ sync = โค้ดตรงไปตรงมากว่ามาก
//   ถ้าวันหนึ่งไม้เกิน ~5,000 ค่อยย้าย (มี export JSON ไว้แล้ว ย้ายได้ไม่เจ็บตัว)
//
// ⚠️⚠️ ข้อมูลอยู่ใน "เบราว์เซอร์ตัวนี้ บนเครื่องนี้" เท่านั้น
//   ล้างข้อมูลเบราว์เซอร์ / เปิดโหมดไม่ระบุตัวตน / เปลี่ยนเครื่อง = ไม่เห็นสมุดเล่มเดิม
//   → ปุ่ม "สำรองข้อมูล" ไม่ใช่ของแถม มันคือทางเดียวที่สมุดจะรอด **กดทุกครั้งที่บันทึกไม้**

const KEY = 'v5-trade-journal';
const SCHEMA = 1;

// ระบอบกติกา — ต้องตรงกับ seed ใน src/db.js (ฝั่ง Node)
// ★ invariant เดิมยังอยู่: สถิตินับต่อ ruleset เท่านั้น ไม่มีที่ไหนรวมข้ามระบอบ
const RULESETS = [
  { id: 1, code: 'R1', name: 'ด่านกำแพงยังบล็อกไม้ได้', effective_from: '2026-08-19', effective_to: '2026-08-28',
    notes: 'confirmOn=false ตั้งแต่ 20 ส.ค. · agent ตีตกไม้ที่จ่อกำแพงได้' },
  { id: 2, code: 'R2', name: 'ถอดด่านกำแพงออก', effective_from: '2026-08-29', effective_to: '2026-09-02',
    notes: 'กำแพงเหลือเป็นคำเตือน 4 สถานะ ไม่บล็อกไม้' },
  { id: 3, code: 'R3', name: 'V5.13 + V5.14', effective_from: '2026-09-03', effective_to: '2026-09-05',
    notes: 'ปิดระบอบ 5 ก.ย. 69 หลังรอบ D วัดได้ว่าแพ้ (PF 1.239 vs 1.533)' },
  { id: 4, code: 'R4', name: 'V5.15 — ย้อน Bias กลับเป็นราคา×EMA50', effective_from: '2026-09-05', effective_to: null,
    notes: 'biasMode = ทุก TF ราคา×EMA50 (ผลรอบ D) · Stoch ยังปิด (รอบ B ค้าง) · H4 อยู่ในชุด · SL/TP 2.0×ATR กริด 5' },
];

// ตัวนับที่ยกมาจากสมุด markdown เล่มเก่า — รีเซ็ตสถิติแพ้/ชนะ แต่ไม่รีเซ็ตของพวกนี้
const CARRIED = [
  { key: 'wall_blocked_entered', value: '1',
    note: 'ไม้ blocked/tight ที่เข้าจริงจากสมุดเก่า (31 ส.ค. 69) — เกณฑ์ pre-registered ต้องครบ 5–8 ไม้' },
  { key: 'wall_gate_wrong', value: '3', note: 'ด่านกำแพงตีตกแล้วอ่านผลได้ 3 ครั้ง ผิดทั้ง 3 (20/28/31 ส.ค. 69)' },
  { key: 'price_ends_at_wall', value: '3', note: 'ราคาไปจบตรงกำแพง n=3 (31 ส.ค. · 1 ก.ย. · 3 ก.ย.) — ยังห้ามแปลงเป็นกฎ' },
];

// ★ ค่าพวกนี้ต้องตรงกับ ema50_lightsaber_v5.pine เสมอ
//   ถ้าสองฝั่งค้างคนละค่า เครื่องคิด lot จะบอกเลขคนละชุดกับเส้นบนกราฟโดยไม่มีอะไรฟ้อง
const DEFAULT_SETTINGS = {
  freeze_min_trades: '20',
  risk_usd: '300',
  sltp_mult: '2.0',
  sltp_step: '5',
  sltp_min_dist: '10',
  max_per_session: '1',
};

function blank() {
  return { schema: SCHEMA, settings: { ...DEFAULT_SETTINGS }, trades: [], next_id: 1 };
}

function read() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { /* โหมดไม่ระบุตัวตน / ปิดคุกกี้ */ }
  if (!raw) return blank();
  try {
    const d = JSON.parse(raw);
    return { ...blank(), ...d, settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) } };
  } catch {
    return blank();   // ข้อมูลพัง = เริ่มใหม่ ดีกว่าค้างหน้าขาว (ยังกู้จากไฟล์สำรองได้)
  }
}

let cache = null;
const db = () => (cache ??= read());

function commit() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); return true; }
  catch (e) { alert('บันทึกลงเบราว์เซอร์ไม่สำเร็จ: ' + e.message + '\n\nกด "สำรองข้อมูล" เก็บไฟล์ไว้ก่อน'); return false; }
}

export const store = {
  rulesets: () => RULESETS,
  carried:  () => CARRIED,
  current:  () => RULESETS.find((r) => !r.effective_to) ?? RULESETS.at(-1),
  settings: () => ({ ...db().settings }),

  setSetting(k, v) { db().settings[k] = String(v); commit(); return this.settings(); },

  trades(rulesetId) {
    const all = db().trades;
    return rulesetId ? all.filter((t) => Number(t.ruleset_id) === Number(rulesetId)) : all;
  },

  add(row) {
    const d = db();
    if (!row.trade_id || !row.ruleset_id || !row.signal_date || !row.side) {
      throw new Error('ต้องมีอย่างน้อย: trade_id, ruleset_id, signal_date, side');
    }
    if (d.trades.some((t) => t.trade_id === row.trade_id)) {
      throw new Error(`มีไม้ trade_id นี้อยู่แล้ว: ${row.trade_id}`);
    }
    const t = { id: d.next_id++, outcome: 'open', system: 'v5', mt4_tickets: 1, ...row };
    d.trades.push(t); commit();
    return t;
  },

  update(id, patch) {
    const t = db().trades.find((x) => x.id === Number(id));
    if (!t) throw new Error('ไม่เจอไม้นี้');
    Object.assign(t, patch); commit();
    return t;
  },

  remove(id) {
    const d = db();
    const i = d.trades.findIndex((x) => x.id === Number(id));
    if (i >= 0) { d.trades.splice(i, 1); commit(); }
    return i >= 0;
  },

  // ---- สำรอง / กู้คืน — ทางเดียวที่สมุดจะรอดจากการล้างข้อมูลเบราว์เซอร์ ----
  exportJSON() {
    return JSON.stringify({ ...db(), exported_at: new Date().toISOString() }, null, 2);
  },

  importJSON(text, { merge = false } = {}) {
    const d = JSON.parse(text);
    if (!Array.isArray(d.trades)) throw new Error('ไฟล์นี้ไม่ใช่สมุดไม้จริง (ไม่มีรายการไม้)');
    if (merge) {
      const cur = db();
      const have = new Set(cur.trades.map((t) => t.trade_id));
      let added = 0;
      for (const t of d.trades) {
        if (have.has(t.trade_id)) continue;          // trade_id ซ้ำ = ไม้เดียวกัน ไม่เขียนทับ
        cur.trades.push({ ...t, id: cur.next_id++ });
        added++;
      }
      cur.settings = { ...cur.settings, ...(d.settings ?? {}) };
      commit();
      return { added, skipped: d.trades.length - added };
    }
    cache = { ...blank(), ...d, settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) } };
    cache.next_id = Math.max(1, ...cache.trades.map((t) => Number(t.id) || 0)) + 1;
    commit();
    return { added: cache.trades.length, skipped: 0 };
  },

  clear() { cache = blank(); commit(); },

  // ใช้เตือนบนหน้าจอว่าครั้งสุดท้ายที่สำรองคือเมื่อไหร่
  markBackup() { db().last_backup = new Date().toISOString(); commit(); },
  lastBackup() { return db().last_backup ?? null; },
  isEmpty() { return db().trades.length === 0; },
};
