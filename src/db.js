// สมุดไม้จริง — schema + query layer
// ตั้งใจให้บาง เพราะวันหนึ่งจะย้ายไป Turso (libSQL) แล้ว query ชุดนี้ต้องใช้ต่อได้เกือบทั้งหมด
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.JOURNAL_DB ?? join(ROOT, 'data', 'journal.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS rulesets (
  id             INTEGER PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to   TEXT,
  notes          TEXT
);

-- ★ invariant ของทั้งระบบนี้: สถิติถูกนับ "ต่อ ruleset" เท่านั้น
--   ruleset_id จึง NOT NULL เสมอ และไม่มี query ไหนใน repo นี้ที่ aggregate ข้าม ruleset
CREATE TABLE IF NOT EXISTS trades (
  id              INTEGER PRIMARY KEY,
  trade_id        TEXT NOT NULL UNIQUE,   -- 20260907-2100-SELL (agent สร้างตอนดาบออก)
  ruleset_id      INTEGER NOT NULL REFERENCES rulesets(id),

  -- ── ฝั่งระบบ: TradingView + geo ที่ agent คำนวณ ──────────────────
  signal_date     TEXT NOT NULL,          -- YYYY-MM-DD (เวลาไทย)
  bar_time        TEXT,                   -- HH:MM เวลาปิดแท่ง M15 ที่ยิง
  session         TEXT CHECK (session IN ('morning','evening')),
  side            TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  system          TEXT DEFAULT 'v5',
  signal_price    REAL,                   -- ราคาตอนดาบออก (ไม่ใช่ราคา fill)
  atr             REAL,
  trigger_usd     REAL,
  bars            INTEGER,
  tf_count        INTEGER,
  tf_list         TEXT,
  ema_cross       INTEGER,
  planned_sl      REAL,
  planned_tp      REAL,
  planned_dist    REAL,
  planned_lot     REAL,
  rr              REAL,

  -- ── กำแพง OI (ตัวแปรที่ backtest ไม่เคยมี = เหตุผลที่สมุดนี้มีอยู่) ──
  wall_state      TEXT CHECK (wall_state IN ('clear','tight','blocked','crossed')),
  wall_dist_ahead REAL,
  wall_ahead      REAL,
  wall_ahead_name TEXT,
  basis           REAL,
  put_wall        REAL,
  call_wall       REAL,

  -- ── ฝั่งเงิน: MT4 (ความจริงเรื่องเงิน) ─────────────────────────
  mt4_ticket      TEXT,
  entry_price     REAL,
  entry_at        TEXT,                   -- 'YYYY-MM-DD HH:MM' เวลาไทย (ฟอร์แมตเดียวกับ signal_date+bar_time → เทียบสตริงได้ตรงๆ)
  exit_price      REAL,
  exit_at         TEXT,                   -- ฟอร์แมตเดียวกัน
  lot             REAL,
  spread          REAL,
  commission      REAL,
  swap            REAL,
  profit          REAL,

  -- ── ผล ────────────────────────────────────────────────────────
  -- 'manual' คือฟิลด์ที่เกิดจากไม้ 4 ก.ย. 69: ปิดมือตอน 23:00 ไม่ชน TP/SL
  -- ไม้ manual ห้ามนับรวมกับไม้ที่จบตามกฎ — เป็นคนละประชากร
  outcome         TEXT CHECK (outcome IN ('tp','sl','manual','open','not_taken')) DEFAULT 'open',
  mfe             REAL,                   -- ราคาไปไกลสุดฝั่งกำไร
  mae             REAL,                   -- ไกลสุดฝั่งขาดทุน
  wall_touched    INTEGER,                -- ราคาแตะกำแพงแล้วเด้งจริงไหม (กลไกที่ด่านอ้าง)
  news            TEXT,
  note            TEXT,

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trades_ruleset ON trades(ruleset_id, signal_date);
CREATE INDEX IF NOT EXISTS idx_trades_wall    ON trades(ruleset_id, wall_state);

-- ตัวนับที่ "ยกมา" จากสมุด markdown เล่มเก่า — รีเซ็ตสถิติแพ้/ชนะ แต่ไม่รีเซ็ตของพวกนี้
CREATE TABLE IF NOT EXISTS carried (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  note  TEXT
);
`);

// ★ upsert ไม่ใช่ DO NOTHING — ไฟล์นี้ต้องเป็นแหล่งความจริงของ rulesets เสมอ
// เจอมาแล้ว 5 ก.ย. 69: ตอนปิด R3 ด้วย DO NOTHING แถวเดิมไม่ถูกแก้ → DB ยังบอกว่า R3 เปิดอยู่
// ขณะที่โค้ดบอกว่าปิดแล้ว = อาการเดียวกับ _strategy ที่ค้างคนละเวอร์ชันกับ indicator
// ---------- migration แบบเบา: เพิ่มคอลัมน์ให้ DB ที่มีอยู่แล้ว (CREATE TABLE IF NOT EXISTS ไม่แตะตารางเดิม) ----------
// SQLite ไม่มี ADD COLUMN IF NOT EXISTS → เช็คจาก pragma ก่อน
function addColumn(table, col, ddl) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}
addColumn('trades', 'mt4_tickets', 'INTEGER DEFAULT 1');  // จำนวน ticket MT4 ต่อสัญญาณ (>1 = ตัวจับผิด "เข้าหลายไม้")
addColumn('trades', 'tags', 'TEXT');                       // ป้ายอิสระ คั่นด้วย , เช่น "nfp,fomo"

// ตั้งค่าที่ต้นแก้เองได้ไม่ต้องแตะโค้ด — seed แบบ DO NOTHING โดยตั้งใจ (ค่าที่ต้นตั้งต้องอยู่รอดตอนรีสตาร์ต)
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, note TEXT)`);
const seedSetting = db.prepare(`INSERT INTO settings (key, value, note) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`);
seedSetting.run('freeze_min_trades', '20',
  'ห้ามแก้คอนฟิกจนกว่าไม้ที่จบด้วย TP/SL ใน ruleset ปัจจุบันจะครบเท่านี้ · ที่ 20 ไม้ SE ของ Win% ยัง ≈ 11 จุด — ต่ำกว่านั้นแยก noise ไม่ออก');
// ★ 4 ตัวข้างล่างต้องตรงกับ ema50_lightsaber_v5.pine เสมอ — ถ้าไม่ตรง เครื่องคิด lot จะบอกเลขคนละชุดกับเส้นบนชาร์ต
//   (กับดักเดิมของโปรเจกต์: ของสองฝั่งค้างคนละค่าโดยไม่มีอะไรฟ้อง)
seedSetting.run('risk_usd',      '300', 'ยอมเสียต่อไม้ (USD) — ตรงกับ riskUSD ใน Pine');
seedSetting.run('sltp_mult',     '2.0', 'ตัวคูณ ATR ของ SL/TP — ตรงกับ slTpMult');
seedSetting.run('sltp_step',     '5',   'ปัดระยะขั้นละ (USD) — ตรงกับ sltpStep');
seedSetting.run('sltp_min_dist', '10',  'ระยะขั้นต่ำ (USD) — ตรงกับ sltpMinDist');
seedSetting.run('max_per_session', '1', 'โควตาไม้ต่อวินโดว์ (กฎข้อ 5) — 1 session 1 ไม้');

const seedRuleset = db.prepare(
  `INSERT INTO rulesets (code, name, effective_from, effective_to, notes)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(code) DO UPDATE SET
     name = excluded.name,
     effective_from = excluded.effective_from,
     effective_to = excluded.effective_to,
     notes = excluded.notes`
);
seedRuleset.run('R1', 'ด่านกำแพงยังบล็อกไม้ได้', '2026-08-19', '2026-08-28',
  'confirmOn=false ตั้งแต่ 20 ส.ค. · agent ตีตกไม้ที่จ่อกำแพงได้');
seedRuleset.run('R2', 'ถอดด่านกำแพงออก', '2026-08-29', '2026-09-02',
  'กำแพงเหลือเป็นคำเตือน 4 สถานะ ไม่บล็อกไม้');
seedRuleset.run('R3', 'V5.13 + V5.14', '2026-09-03', '2026-09-05',
  'V5.13 นิยาม Bias ใหม่ (H4/H1/M30=ราคา×EMA12 · M15=EMA12×EMA50) · V5.14 ปิด Stochastic · ' +
  'ปิดระบอบ 5 ก.ย. 69 หลังรอบ D วัดได้ว่าแพ้ (PF 1.239 vs 1.533 · DD 1,753 vs 1,612)');
// ★ R4 — ระบอบแรกที่ "ค่าที่ใช้อยู่มาจากการวัด" ไม่ใช่จากอาการรายวัน
seedRuleset.run('R4', 'V5.15 — ย้อน Bias กลับเป็นราคา×EMA50', '2026-09-05', null,
  'biasMode = ทุก TF ราคา×EMA50 (ผลรอบ D) · Stoch ยังปิด (V5.14 ยังไม่ถูกวัด = รอบ B ค้าง) · ' +
  'H4 อยู่ในชุด · SL/TP 2.0×ATR กริด 5 · วินโดว์เย็น 19:00-23:00');

const seedCarried = db.prepare(
  `INSERT INTO carried (key, value, note) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`
);
seedCarried.run('wall_blocked_entered', '1',
  'ไม้ blocked/tight ที่เข้าจริงจากสมุดเก่า (31 ส.ค. 69) — เกณฑ์ pre-registered ต้องครบ 5–8 ไม้ ตัวนับนี้เดินต่อ ไม่รีเซ็ต');
seedCarried.run('wall_gate_wrong', '3',
  'ด่านกำแพงตีตกแล้วอ่านผลได้ 3 ครั้ง ผิดทั้ง 3 (20/28/31 ส.ค. 69)');
seedCarried.run('price_ends_at_wall', '3',
  'ราคาไปจบตรงกำแพง n=3 (31 ส.ค. · 1 ก.ย. · 3 ก.ย.) — อ่านย้อนหลัง ยังห้ามแปลงเป็นกฎ');

// ── queries ────────────────────────────────────────────────────────
export const q = {
  rulesets: () => db.prepare('SELECT * FROM rulesets ORDER BY effective_from').all(),

  currentRuleset: () =>
    db.prepare('SELECT * FROM rulesets WHERE effective_to IS NULL ORDER BY effective_from DESC LIMIT 1').get(),

  trades: (rulesetId) =>
    rulesetId
      ? db.prepare('SELECT * FROM trades WHERE ruleset_id = ? ORDER BY signal_date DESC, bar_time DESC').all(rulesetId)
      : db.prepare('SELECT * FROM trades ORDER BY signal_date DESC, bar_time DESC').all(),

  carried: () => db.prepare('SELECT * FROM carried').all(),

  settings: () => Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value])),
  settingsRows: () => db.prepare('SELECT * FROM settings ORDER BY key').all(),

  // ★ คืนค่าเป็น array ต่อ ruleset เสมอ — ไม่มี grand total โดยตั้งใจ
  //   ถ้ามีใครอยากได้ตัวเลขรวม แปลว่ากำลังจะทำสิ่งที่สมุดเล่มเก่าพิสูจน์แล้วว่าอ่านผิด
  statsByRuleset: () => db.prepare(`
    SELECT r.id, r.code, r.name, r.effective_from, r.effective_to,
           COUNT(t.id)                                            AS total,
           SUM(CASE WHEN t.outcome = 'tp'        THEN 1 ELSE 0 END) AS tp,
           SUM(CASE WHEN t.outcome = 'sl'        THEN 1 ELSE 0 END) AS sl,
           SUM(CASE WHEN t.outcome = 'manual'    THEN 1 ELSE 0 END) AS manual,
           SUM(CASE WHEN t.outcome = 'open'      THEN 1 ELSE 0 END) AS open,
           SUM(CASE WHEN t.outcome = 'not_taken' THEN 1 ELSE 0 END) AS not_taken,
           SUM(CASE WHEN t.wall_state IN ('blocked','tight')
                     AND t.outcome IN ('tp','sl')                 THEN 1 ELSE 0 END) AS wall_blocked_settled,
           ROUND(SUM(COALESCE(t.profit, 0)), 2)                     AS pl
    FROM rulesets r LEFT JOIN trades t ON t.ruleset_id = r.id
    GROUP BY r.id ORDER BY r.effective_from
  `).all(),
};

const FIELDS = [
  'trade_id','ruleset_id','signal_date','bar_time','session','side','system','signal_price','atr',
  'trigger_usd','bars','tf_count','tf_list','ema_cross','planned_sl','planned_tp','planned_dist',
  'planned_lot','rr','wall_state','wall_dist_ahead','wall_ahead','wall_ahead_name','basis','put_wall',
  'call_wall','mt4_ticket','entry_price','entry_at','exit_price','exit_at','lot','spread','commission',
  'swap','profit','outcome','mfe','mae','wall_touched','news','note','mt4_tickets','tags',
];

export function insertTrade(row) {
  const cols = FIELDS.filter((f) => row[f] !== undefined && row[f] !== null && row[f] !== '');
  if (!cols.includes('trade_id') || !cols.includes('ruleset_id') ||
      !cols.includes('signal_date') || !cols.includes('side')) {
    throw new Error('ต้องมีอย่างน้อย: trade_id, ruleset_id, signal_date, side');
  }
  const stmt = db.prepare(
    `INSERT INTO trades (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  );
  const info = stmt.run(...cols.map((c) => row[c]));
  return db.prepare('SELECT * FROM trades WHERE id = ?').get(info.lastInsertRowid);
}

export function updateTrade(id, patch) {
  const cols = FIELDS.filter((f) => patch[f] !== undefined);
  if (!cols.length) return db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
  db.prepare(
    `UPDATE trades SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`
  ).run(...cols.map((c) => patch[c]), id);
  return db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
}

export function setSetting(key, value) {
  if (!/^[a-z_]+$/.test(String(key))) throw new Error('key ไม่ถูกต้อง');
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
  return q.settings();
}

export function deleteTrade(id) {
  return db.prepare('DELETE FROM trades WHERE id = ?').run(id).changes;
}

if (process.argv.includes('--reset')) {
  db.exec('DELETE FROM trades');
  console.log('ลบไม้ทั้งหมดแล้ว (rulesets กับ carried ยังอยู่)');
}
