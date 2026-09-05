// ตัวเชื่อม: ทำให้ app.js เรียก api() ได้เหมือนเดิม แต่ไปจบที่ store ในเบราว์เซอร์ ไม่ใช่ HTTP
//
// ★ ทำไมทำเป็น shim แทนที่จะแก้ app.js: app.js เป็นไฟล์เดียวกับที่เวอร์ชัน Node ใช้
//   ถ้าแก้มัน = โค้ดสองชุดที่ต้องแก้คู่กันตลอดไป ซึ่งเป็นกับดักที่โปรเจกต์นี้เจอมาแล้วหลายรอบ
//   (Pine indicator กับ _strategy ค้างคนละเวอร์ชัน · basis สองฝั่ง)
//   shim นี้ทำ routing ให้ตรงกับ src/server.js ทุก endpoint → แก้ที่ src/ ที่เดียวเหมือนเดิม

async function api(path, opts) {
  const [p, qs] = String(path).split('?');
  const q = new URLSearchParams(qs ?? '');
  const method = opts?.method ?? 'GET';
  const body = opts?.body ? JSON.parse(opts.body) : null;
  const cur = store.current();

  if (p === '/api/bootstrap') {
    return {
      rulesets: store.rulesets(), current: cur, carried: store.carried(),
      settings: store.settings(), trades: store.trades(),
    };
  }

  if (p === '/api/analytics') {
    const rid = Number(q.get('ruleset') ?? cur?.id);
    const ruleset = store.rulesets().find((r) => r.id === rid);
    if (!ruleset) throw new Error('ไม่มี ruleset นี้');
    return { ruleset, ...analyze(store.trades(rid), store.settings()) };
  }

  if (p === '/api/plan') {
    const cfg = store.settings();
    const plan = planGeometry({
      price: q.get('price'), atr: q.get('atr'), side: q.get('side'), dist: q.get('dist'),
    }, cfg);
    const date = q.get('date') || new Date().toISOString().slice(0, 10);
    const session = q.get('session') || 'evening';
    const today = store.trades(cur?.id).filter((t) => t.signal_date === date && t.outcome !== 'not_taken');
    const inSession = today.filter((t) => (t.session ?? 'evening') === session);
    const openNow = store.trades(cur?.id).filter((t) => t.outcome === 'open');
    const max = Number(cfg.max_per_session ?? 1);
    return {
      plan, cfg, date, session,
      quota: { max, used: inSession.length, left: Math.max(0, max - inSession.length),
               blocked: inSession.length >= max, ids: inSession.map((t) => t.trade_id) },
      today_all: today.length,
      open: openNow.map((t) => ({ id: t.id, trade_id: t.trade_id, side: t.side,
        signal_price: t.signal_price, planned_sl: t.planned_sl, planned_tp: t.planned_tp,
        planned_lot: t.planned_lot, at: signalCloseAt(t) })),
    };
  }

  if (p === '/api/parse' && method === 'POST') {
    const { row, warnings } = parseTelegram(body?.text ?? '');
    if (cur) row.ruleset_id = cur.id;
    return { row, warnings };
  }

  if (p === '/api/trades' && method === 'POST') return store.add(body);

  const m = p.match(/^\/api\/trades\/(\d+)$/);
  if (m && method === 'PATCH')  return store.update(Number(m[1]), body);
  if (m && method === 'DELETE') return { deleted: store.remove(Number(m[1])) ? 1 : 0 };

  if (p === '/api/settings' && method === 'PATCH') {
    let out = store.settings();
    for (const [k, v] of Object.entries(body ?? {})) out = store.setSetting(k, v);
    return out;
  }

  throw new Error('ไม่มี endpoint นี้: ' + path);
}

// ---------- แถบสำรองข้อมูล — ของที่เวอร์ชัน Node ไม่ต้องมี เพราะ DB อยู่เป็นไฟล์บนเครื่องอยู่แล้ว ----------
function backupBar() {
  const el = document.getElementById('backup');
  if (!el) return;
  const last = store.lastBackup();
  const n = store.trades().length;
  const days = last ? Math.floor((Date.now() - new Date(last)) / 86400000) : null;
  const stale = n > 0 && (last === null || days >= 1);
  el.className = 'backup' + (stale ? ' stale' : '');
  el.innerHTML = `
    <div>
      <b>${n ? `${n} ไม้ในสมุด` : 'สมุดยังว่าง'}</b>
      <span class="dim"> · เก็บอยู่ในเบราว์เซอร์ตัวนี้เท่านั้น — ล้างข้อมูลเบราว์เซอร์เมื่อไหร่ก็หายเมื่อนั้น</span>
      ${n ? `<div class="dim" style="font-size:12.5px">สำรองล่าสุด: ${last ? new Date(last).toLocaleString('th-TH') + (days >= 1 ? ` (${days} วันที่แล้ว)` : '') : '<b>ยังไม่เคยสำรอง</b>'}</div>` : ''}
    </div>
    <div class="row" style="margin:0">
      <button id="bk-export"${n ? '' : ' disabled style="opacity:.4"'}>⬇ สำรองข้อมูล</button>
      <button class="ghost" id="bk-import">⬆ กู้คืนจากไฟล์</button>
      ${n ? '' : '<button class="ghost" id="bk-demo">ใส่ข้อมูลตัวอย่าง</button>'}
    </div>`;

  document.getElementById('bk-export')?.addEventListener('click', () => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trade-journal-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    store.markBackup();
    backupBar();
  });

  document.getElementById('bk-import')?.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.addEventListener('change', async () => {
      const f = inp.files?.[0]; if (!f) return;
      const merge = store.trades().length > 0 &&
        confirm('สมุดนี้มีไม้อยู่แล้ว\n\nตกลง = รวมไฟล์เข้ากับของเดิม (ไม้ trade_id ซ้ำจะถูกข้าม ไม่เขียนทับ)\nยกเลิก = แทนที่ของเดิมทั้งหมด');
      try {
        const r = store.importJSON(await f.text(), { merge });
        alert(`กู้คืนแล้ว: เพิ่ม ${r.added} ไม้${r.skipped ? ` · ข้าม ${r.skipped} ไม้ที่ซ้ำ` : ''}`);
        location.reload();
      } catch (e) { alert('อ่านไฟล์ไม่สำเร็จ: ' + e.message); }
    });
    inp.click();
  });

  document.getElementById('bk-demo')?.addEventListener('click', () => {
    if (!confirm('ใส่ข้อมูลตัวอย่าง 38 ไม้เพื่อดูว่าหน้าตาเป็นยังไง?\n\nกู้คืนไฟล์จริงทับได้ทีหลัง')) return;
    seedDemo(); location.reload();
  });
}

// ---------- ข้อมูลตัวอย่าง — logic เดียวกับ scripts/seed-demo.js ----------
function seedDemo() {
  let seed = 20260905;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const cur = store.current();
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
      const i = rows.length;
      let lot = plannedLot, entryAt = `${date} ${bar}`, outcome = rand() < 0.6 ? 'tp' : 'sl', tickets = 1;
      if ([5, 17, 29].includes(i)) lot = Math.round(plannedLot * (3 + rand() * 4) * 100) / 100;
      if ([9, 23].includes(i)) entryAt = `${date} ${String(hh).padStart(2, '0')}:${String(Math.max(0, mm - 10)).padStart(2, '0')}`;
      if (i === 14) tickets = 3;
      if ([11, 31].includes(i)) outcome = 'manual';
      const sign = outcome === 'tp' ? 1 : outcome === 'sl' ? -1 : (rand() < 0.5 ? 0.4 : -0.6);
      rows.push({
        trade_id: `${date.replace(/-/g, '')}-${bar.replace(':', '')}-${side}`,
        ruleset_id: cur.id, signal_date: date, bar_time: bar, session: 'evening', side,
        signal_price: +price.toFixed(2), atr: +atr.toFixed(1),
        planned_sl: +(side === 'BUY' ? price - dist : price + dist).toFixed(2),
        planned_tp: +(side === 'BUY' ? price + dist : price - dist).toFixed(2),
        planned_dist: dist, planned_lot: plannedLot, rr: 1,
        wall_state: ['clear', 'clear', 'tight', 'crossed'][Math.floor(rand() * 4)],
        entry_price: +(price + (rand() - 0.5)).toFixed(2), entry_at: entryAt,
        exit_at: `${date} ${String(Math.min(23, hh + 1 + Math.floor(rand() * 2))).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
        lot, mt4_tickets: tickets,
        profit: Math.round(sign * lot * dist * 100 * 100) / 100,
        outcome,
      });
    }
    d = new Date(d.getTime() + 86400000);
  }
  for (const r of rows) { try { store.add(r); } catch { /* ข้ามตัวซ้ำ */ } }
}
