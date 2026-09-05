// เซิร์ฟเวอร์ localhost — node:http ล้วน ไม่มี dependency
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, insertTrade, updateTrade, deleteTrade, setSetting } from './db.js';
import { parseTelegram } from './parse.js';
import { analyze, planGeometry, signalCloseAt } from './analytics.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 4173);
const HOST = '127.0.0.1';                 // localhost เท่านั้น — ไม่เปิดออกเน็ต

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const json = (res, code, body) => {
  const b = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(b) });
  res.end(b);
};

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw new Error('body ใหญ่เกิน 1MB');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('JSON ไม่ถูกต้อง'); }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = url.pathname;

  try {
    // ── API ─────────────────────────────────────────────────────
    if (path === '/api/bootstrap' && req.method === 'GET') {
      return json(res, 200, {
        rulesets: q.rulesets(),
        current: q.currentRuleset(),
        carried: q.carried(),
        stats: q.statsByRuleset(),       // ★ ต่อ ruleset เท่านั้น ไม่มียอดรวม
        settings: q.settings(),
        trades: q.trades(),
      });
    }

    // ★ วิเคราะห์ต่อ ruleset เดียว — ไม่มี endpoint รวมข้ามระบอบ (ข้อบังคับเดียวกับ statsByRuleset)
    if (path === '/api/analytics' && req.method === 'GET') {
      const cur = q.currentRuleset();
      const rid = Number(url.searchParams.get('ruleset') ?? cur?.id);
      const ruleset = q.rulesets().find((r) => r.id === rid);
      if (!ruleset) return json(res, 404, { error: 'ไม่มี ruleset นี้' });
      return json(res, 200, { ruleset, ...analyze(q.trades(rid), q.settings()) });
    }

    // ★ แผนก่อนเข้าไม้ + โควตาวันนี้ — endpoint เดียวตอบทั้ง "ตั้งเท่าไหร่" และ "เข้าได้ไหม"
    if (path === '/api/plan' && req.method === 'GET') {
      const cfg = q.settings();
      const cur = q.currentRuleset();
      const plan = planGeometry({
        price: url.searchParams.get('price'), atr: url.searchParams.get('atr'),
        side: url.searchParams.get('side'), dist: url.searchParams.get('dist'),
      }, cfg);
      // โควตา: นับไม้ของ "วันนี้" ในระบอบปัจจุบัน แยกเช้า/เย็น (กฎข้อ 5 = 1 ไม้ต่อวินโดว์)
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
      const session = url.searchParams.get('session') || 'evening';
      const today = q.trades(cur?.id).filter((t) => t.signal_date === date && t.outcome !== 'not_taken');
      const inSession = today.filter((t) => (t.session ?? 'evening') === session);
      const openNow = q.trades(cur?.id).filter((t) => t.outcome === 'open');
      const max = Number(cfg.max_per_session ?? 1);
      return json(res, 200, {
        plan, cfg, date, session,
        quota: { max, used: inSession.length, left: Math.max(0, max - inSession.length),
                 blocked: inSession.length >= max,
                 ids: inSession.map((t) => t.trade_id) },
        today_all: today.length,
        open: openNow.map((t) => ({ id: t.id, trade_id: t.trade_id, side: t.side,
                                    signal_price: t.signal_price, planned_sl: t.planned_sl,
                                    planned_tp: t.planned_tp, planned_lot: t.planned_lot,
                                    at: signalCloseAt(t) })),
      });
    }

    if (path === '/api/settings' && req.method === 'GET') return json(res, 200, q.settingsRows());
    if (path === '/api/settings' && req.method === 'PATCH') {
      const body = await readBody(req);
      let out;
      for (const [k, v] of Object.entries(body)) out = setSetting(k, v);
      return json(res, 200, out ?? q.settings());
    }

    if (path === '/api/parse' && req.method === 'POST') {
      const { text } = await readBody(req);
      const { row, warnings } = parseTelegram(text ?? '');
      const cur = q.currentRuleset();
      if (cur) row.ruleset_id = cur.id;
      return json(res, 200, { row, warnings });
    }

    if (path === '/api/trades' && req.method === 'POST') {
      const row = await readBody(req);
      try { return json(res, 201, insertTrade(row)); }
      catch (e) {
        const dup = /UNIQUE/.test(String(e.message));
        return json(res, dup ? 409 : 400, {
          error: dup ? `มีไม้ trade_id นี้อยู่แล้ว: ${row.trade_id}` : e.message,
        });
      }
    }

    const m = path.match(/^\/api\/trades\/(\d+)$/);
    if (m && req.method === 'PATCH') return json(res, 200, updateTrade(Number(m[1]), await readBody(req)));
    if (m && req.method === 'DELETE') return json(res, 200, { deleted: deleteTrade(Number(m[1])) });

    if (path.startsWith('/api/')) return json(res, 404, { error: 'ไม่มี endpoint นี้' });

    // ── static ──────────────────────────────────────────────────
    const file = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
    if (file.includes('..')) return json(res, 400, { error: 'path ไม่ถูกต้อง' });
    const body = await readFile(join(ROOT, 'public', file));
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    return res.end(body);

  } catch (e) {
    if (e?.code === 'ENOENT') return json(res, 404, { error: 'ไม่เจอไฟล์' });
    return json(res, 500, { error: String(e.message ?? e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`สมุดไม้จริง → http://${HOST}:${PORT}`);
  const cur = q.currentRuleset();
  console.log(`ruleset ปัจจุบัน: ${cur?.code} ${cur?.name}`);
  console.log(`ไม้ในสมุด: ${q.trades().length} (เริ่มนับหนึ่งใหม่ 5 ก.ย. 69)`);
});
