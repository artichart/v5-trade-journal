import { lineChart, areaChart, barChart, calendar, attachHover, esc, fmtUSD, fmtR } from '/charts.js';

const $ = (s) => document.querySelector(s);
const api = async (path, opts) => {
  const r = await fetch(path, { ...opts, headers: opts?.body ? { 'content-type': 'application/json' } : undefined });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
};
const n = (v, d = 2) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));
const signed = (v) => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 }));

const FLAG_LABELS = {
  early_entry: 'เข้าก่อนดาบออก', oversize: 'lot เกินแผน', multi_ticket: 'เข้าหลายไม้',
  moved_sltp: 'ขยับ SL/TP', manual_close: 'ปิดมือ', held_past_23: 'ถือเลย 23:00',
};

let boot = null;      // rulesets / carried / settings
let A = null;         // analytics ของ ruleset ที่เลือก
const views = {};     // id → { svg, table, meta, showTable }

// ---------- ★ แผงหน้างาน: ตอบคำถามเดียว "ตอนนี้กดเข้าได้ไหม และตั้งเท่าไหร่" ----------
// จุดประสงค์ของเว็บทั้งเว็บอยู่ตรงนี้ — ส่วนสถิติข้างล่างคือผลพลอยได้
// กลไกที่ตั้งใจ: ต้นต้องเปิดหน้านี้อยู่แล้วเพื่อรู้ lot → การบันทึกไม้เลยเกิดเอง ไม่ใช่งานเพิ่มที่จะถูกข้าม
let deskPlan = null;

function thNow() {
  const d = new Date();
  const th = new Date(d.getTime() + (d.getTimezoneOffset() + 420) * 60000);
  const pad = (x) => String(x).padStart(2, '0');
  return {
    date: `${th.getFullYear()}-${pad(th.getMonth() + 1)}-${pad(th.getDate())}`,
    bar: `${pad(th.getHours())}:${pad(Math.floor(th.getMinutes() / 15) * 15)}`,
    hour: th.getHours(),
  };
}

async function refreshDesk() {
  const d = $('#desk');
  const now = thNow();
  const g = (id) => document.getElementById(id)?.value?.trim() ?? '';
  const price = g('dk-price'), atr = g('dk-atr'), side = g('dk-side') || 'SELL';
  const date = g('dk-date') || now.date, bar = g('dk-bar') || now.bar;
  const session = Number(bar.slice(0, 2)) < 12 ? 'morning' : 'evening';
  const qs = new URLSearchParams({ price, atr, side, date, session });
  const r = await api('/api/plan?' + qs);
  deskPlan = { ...r, price, atr, side, date, bar, session };

  // ลำดับความสำคัญของคำตอบ: ถือไม้อยู่ > โควตาหมด > พร้อมคิด
  const open = r.open[0];
  let cls = '', verdict = '', why = '';
  if (open) {
    cls = 'hold';
    verdict = `⏸ ถือไม้อยู่ — ${open.side} ที่ ${open.signal_price ?? '—'} · SL ${open.planned_sl ?? '—'} · TP ${open.planned_tp ?? '—'}`;
    why = 'ตั้ง SL/TP ไว้ที่โบรกแล้วปิดจอ · ห้ามขยับเส้น ห้ามเข้าไม้ที่สอง — พอไม้จบค่อยกลับมากรอกผล';
  } else if (r.quota.blocked) {
    cls = 'stop';
    verdict = `⛔ วินโดว์นี้เข้าไปแล้ว ${r.quota.used} ไม้ — จบวินโดว์`;
    why = `กฎข้อ 5: 1 ไม้ต่อวินโดว์ · ไม้ที่เข้าไปแล้ว ${r.quota.ids.join(', ')} · ดาบเล่มที่สองของวินโดว์เดียวกันไม่ใช่ของระบบนี้`;
  } else {
    verdict = '🗡 เข้าได้ — กรอกราคากับ ATR ตอนดาบออก';
    why = `${date} · วินโดว์${session === 'morning' ? 'เช้า' : 'เย็น'} · เหลือโควตา ${r.quota.left} ไม้` +
      (now.hour < 19 || now.hour >= 23 ? ' · ⚠ ตอนนี้อยู่นอกวินโดว์เย็น 19:00–23:00' : '');
  }

  const p = r.plan;
  const canTrade = !open && !r.quota.blocked;
  const out = !canTrade ? '' : p.error ? `<div class="why" style="margin-top:12px">${esc(p.error)} — กรอก ATR แล้วตัวเลขจะขึ้นเอง</div>` : `
    <div class="out">
      <div class="lot"><div class="l">Lot ที่ต้องตั้ง</div><div class="v">${p.lot.toFixed(2)}</div><div class="n">เสี่ยง ${p.risk_actual} USD${p.risk_actual < p.risk_target ? ` (ต่ำกว่าเป้า ${p.risk_target} เพราะปัด lot ลง)` : ''}</div></div>
      <div><div class="l">ระยะ SL/TP</div><div class="v">${p.dist}</div><div class="n">${p.raw_dist != null ? `ดิบ ${p.raw_dist} → ปัดกริด ${p.cfg.step}` : 'กรอกเอง'}</div></div>
      <div><div class="l">SL</div><div class="v">${p.sl ?? '—'}</div><div class="n">ตั้งที่โบรก</div></div>
      <div><div class="l">TP</div><div class="v">${p.tp ?? '—'}</div><div class="n">ตั้งที่โบรก</div></div>
    </div>`;

  d.className = 'desk' + (cls ? ' ' + cls : '');
  d.innerHTML = `<div class="verdict">${verdict}</div><div class="why">${esc(why)}</div>
    ${!canTrade ? '' : `<div class="inputs">
      <div class="f"><label>วันที่</label><input id="dk-date" type="date" value="${esc(date)}"></div>
      <div class="f"><label>เวลาแท่ง</label><input id="dk-bar" type="time" value="${esc(bar)}"></div>
      <div class="f"><label>ทาง</label><select id="dk-side"><option${side === 'BUY' ? ' selected' : ''}>BUY</option><option${side === 'SELL' ? ' selected' : ''}>SELL</option></select></div>
      <div class="f"><label>ราคาดาบออก</label><input id="dk-price" type="number" step="any" value="${esc(price)}" placeholder="4430.50"></div>
      <div class="f"><label>ATR ตอนยิง</label><input id="dk-atr" type="number" step="any" value="${esc(atr)}" placeholder="9.2"></div>
      <button id="dk-save"${p.error || !price ? ' disabled style="opacity:.4;cursor:not-allowed"' : ''}>บันทึกดาบนี้</button>
    </div>`}
    ${out}
    <div class="rules">
      <span>เสี่ยงต่อไม้ <b>${p.cfg?.risk ?? '—'}</b> USD</span>
      <span>SL/TP <b>${p.cfg?.mult ?? '—'}×ATR</b> ปัดขั้นละ ${p.cfg?.step ?? '—'} พื้น ${p.cfg?.min_dist ?? '—'}</span>
      <span>โควตา <b>${r.quota.used}/${r.quota.max}</b> วินโดว์นี้</span>
      <span class="dim">ค่าพวกนี้ต้องตรงกับ Pine เสมอ — แก้ได้ที่ตาราง settings</span>
    </div>`;

  ['dk-date', 'dk-bar', 'dk-side', 'dk-price', 'dk-atr'].forEach((id) =>
    document.getElementById(id)?.addEventListener('change', refreshDesk));
  document.getElementById('dk-save')?.addEventListener('click', saveFromDesk);
}

async function saveFromDesk() {
  const k = deskPlan; if (!k || k.plan.error) return;
  const tid = `${k.date.replace(/-/g, '')}-${k.bar.replace(':', '')}-${k.side}`;
  const body = {
    ruleset_id: boot.current?.id, trade_id: tid, signal_date: k.date, bar_time: k.bar,
    side: k.side, session: k.session, system: 'v5',
    signal_price: Number(k.price), atr: k.atr ? Number(k.atr) : undefined,
    planned_sl: k.plan.sl, planned_tp: k.plan.tp, planned_dist: k.plan.dist,
    planned_lot: k.plan.lot, rr: 1,
  };
  try {
    await api('/api/trades', { method: 'POST', body: JSON.stringify(body) });
    await load();
    $('#desk').insertAdjacentHTML('afterbegin',
      `<div class="ok" style="margin:0 0 12px">บันทึก <b class="mono">${esc(tid)}</b> แล้ว — ไปตั้ง SL ${k.plan.sl} / TP ${k.plan.tp} ที่โบรกด้วย lot ${k.plan.lot.toFixed(2)} แล้วปิดจอ</div>`);
  } catch (err) {
    $('#desk').insertAdjacentHTML('afterbegin', `<div class="warn" style="margin:0 0 12px">${esc(err.message)}</div>`);
  }
}

// ---------- โครงหน้า ----------
function renderGate() {
  const f = A.freeze, g = $('#gate');
  g.className = 'gate' + (f.unlocked ? ' unlocked' : '');
  g.innerHTML = f.unlocked
    ? `<div class="t">ครบ ${f.min} ไม้ที่จบตามกฎแล้ว — แก้คอนฟิกได้ <span class="dim">ถ้ามีเหตุผลเชิงกลไก + รันเทียบสองขาก่อน</span></div><div class="s mono">${f.settled} / ${f.min}</div>`
    : `<div class="t">🔒 แช่แข็งคอนฟิก — เหลืออีก <b>${f.remaining}</b> ไม้ที่ต้องจบด้วย TP/SL</div><div class="s mono">${f.settled} / ${f.min}</div>`;
  g.innerHTML += `<div class="meter"><i style="width:${Math.min(100, (f.settled / f.min) * 100).toFixed(1)}%"></i></div>` +
    `<div class="s" style="grid-column:1/-1">ข้อยกเว้นเดียวคือบั๊ก (โค้ดทำไม่ตรงสเปก) — "แพ้ 2 ไม้ติด" ไม่ใช่บั๊ก · ไม้ปิดมือไม่นับ · เกณฑ์แก้ได้ที่ settings.freeze_min_trades</div>`;
}

function renderHero() {
  const c = A.counts;
  $('#cur-ruleset').textContent = `${A.ruleset.code} · ${A.ruleset.name}`;
  $('#hero').innerHTML = `
    <div><div class="lbl">Net P&amp;L · ${esc(A.ruleset.code)} · USD</div><div class="big">${signed(A.net)}</div></div>
    <div class="sub">ตามแผน <b class="mono">${signed(A.plan_net)}</b> · ส่วนต่างจากการไม่ทำตามแผน <b class="mono">${signed(A.leak)}</b>
      · ${c.closed} ไม้มีเงินจริง (จบตามกฎ ${c.settled} · ปิดมือ ${c.manual} · ยังเปิด ${c.open})</div>`;
  const kp = (l, v, d = '') => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
  const s = A.streaks;
  $('#kpis').innerHTML =
    kp('Win % (จบตามกฎ)', A.win_pct == null ? '—' : `${A.win_pct}% <span class="se">± ${A.win_pct_se}</span>`, `${c.tp} ชนะ · ${c.sl} แพ้ · คุ้มทุน 50% ที่ R:R 1:1`) +
    kp('Profit factor', n(A.profit_factor, 3), 'กำไรรวม ÷ ขาดทุนรวม') +
    kp('Expectancy', A.expectancy_r == null ? '—' : `${fmtR(A.expectancy_r)} <span class="se">± ${n(A.expectancy_r_se, 2)}</span>`, `ต่อไม้ · n=${A.r_n} · ${A.expectancy_r != null && A.expectancy_r_se ? (Math.abs(A.expectancy_r) > 2 * A.expectancy_r_se ? 'ต่างจากศูนย์เกิน 2 SE' : 'ยังแยกจากศูนย์ไม่ออก (< 2 SE)') : ''}`) +
    kp('Max drawdown', fmtUSD(A.max_dd), `ตามแผน ${fmtUSD(A.max_dd_plan)}`) +
    kp('กำไร ÷ DD', n(A.net_over_dd, 2), 'เส้นฐาน backtest V5.15 = 3.05') +
    kp('เฉลี่ยชนะ / แพ้', `${fmtUSD(A.avg_win)} / ${fmtUSD(A.avg_loss)}`, 'USD ต่อไม้') +
    kp('สตรีค', s.current ? `${s.current}${s.current_type === 'W' ? ' ชนะ' : ' แพ้'}ติด` : '—', `แพ้ติดสูงสุด ${s.max_loss} · ชนะติดสูงสุด ${s.max_win}`);
}

function renderDiscipline() {
  const d = A.discipline, v = d.violations;
  const flag = (k, cnt, info = false) => `<div class="flag${info ? ' info' : ''}"><div class="n">${cnt}</div><div class="l">${FLAG_LABELS[k]}${info ? ' <span class="dim">· ข้อมูล ไม่นับเป็นแหกแผน (รอบ E ค้าง)</span>' : ''}</div></div>`;
  $('#disc').innerHTML = `
    <div><div class="lbl dim mono" style="font-size:11px;letter-spacing:.1em;text-transform:uppercase">ทำตามแผน</div>
      <div class="pct">${d.adherence_pct == null ? '—' : d.adherence_pct + '%'}</div>
      <div class="dim" style="font-size:13px">${d.clean} จาก ${d.closed} ไม้ ไม่ติดธงสักตัว</div></div>
    <div><div class="flags">${flag('oversize', v.oversize)}${flag('early_entry', v.early_entry)}${flag('multi_ticket', v.multi_ticket)}${flag('moved_sltp', v.moved_sltp)}${flag('manual_close', v.manual_close)}${flag('held_past_23', d.held_past_23, true)}</div>
      <div class="leak">ทำจริง <b>${signed(A.net)}</b> · ตามแผน <b>${signed(A.plan_net)}</b> → ส่วนต่าง <b>${signed(A.leak)}</b> USD
        ${A.leak > 0 ? '— ครั้งนี้แหกแผนแล้ว "ได้" แต่มันคือผลของขนาดไม้ที่ไม่ได้วัด ไม่ใช่ของระบบ · ครั้งหน้าเครื่องหมายกลับได้ทุกเมื่อ'
          : A.leak < 0 ? '— นี่คือราคาที่จ่ายให้การไม่ทำตามแผน เทียบกับกำไรระบบแล้วดูว่าคุ้มไหม' : ''}</div></div>`;
}

function mountChart(id, built, xLabel) {
  const el = $('#' + id);
  const prev = views[id];
  views[id] = { ...built, showTable: prev?.showTable ?? false };
  paint(id);
}
function paint(id) {
  const el = $('#' + id), v = views[id];
  if (!v || !v.svg) { el.innerHTML = '<p class="empty">ยังไม่มีไม้ที่มีเงินจริง</p>'; return; }
  el.innerHTML = v.showTable ? v.table : v.svg + '<div class="tip" hidden></div>';
  if (!v.showTable) attachHover(el, v.meta, el.querySelector('.tip'));
  const btn = document.querySelector(`[data-toggle="${id}"]`);
  if (btn) btn.textContent = v.showTable ? 'กราฟ' : 'ตาราง';
}
document.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
  const id = b.dataset.toggle; if (!views[id]) return;
  views[id].showTable = !views[id].showTable; paint(id);
}));

function renderCharts() {
  const eq = A.equity;
  const points = eq.map((e) => ({ label: e.date?.slice(5) ?? String(e.i + 1), sub: e.trade_id }));
  mountChart('eq', eq.length ? lineChart({
    title: 'Equity', points,
    series: [
      { name: 'ทำจริง', color: 'var(--series-1)', values: eq.map((e) => e.actual) },
      { name: 'ตามแผน', color: 'var(--series-2)', values: eq.map((e) => e.plan) },
    ],
  }) : {});
  mountChart('dd', eq.length ? areaChart({ title: 'Drawdown', points, values: eq.map((e) => e.dd) }) : {});

  mountChart('rbars', eq.length ? barChart({
    title: 'R ต่อไม้', yFmt: fmtR, xEvery: Math.max(1, Math.ceil(eq.length / 12)),
    items: eq.map((e) => ({
      label: e.date?.slice(5) ?? '', value: e.r ?? 0, muted: e.clean,
      tip: `${e.trade_id} · ${fmtR(e.r)} · ${fmtUSD(e.profit)} USD${e.clean ? '' : ' · ⚠ แหกแผน'}${e.outcome === 'manual' ? ' · ปิดมือ' : ''}`,
      tipLabel: e.trade_id,
    })),
  }) : {});

  mountChart('rhist', A.r_hist.length ? barChart({
    title: 'จำนวนไม้ตาม R', yFmt: (v) => String(Math.round(v)), labelExtremes: false, height: 200,
    items: A.r_hist.map((b) => ({ label: (b.r <= -3 ? '≤−3' : b.r >= 3 ? '≥+3' : (b.r > 0 ? '+' : '') + b.r) + 'R', value: b.n, tip: `${b.n} ไม้ ที่ ${b.r}R` })),
  }) : {});

  mountChart('wd', A.by_weekday.some((d) => d.n) ? barChart({
    title: 'P&L ตามวัน', height: 200,
    items: A.by_weekday.map((d) => ({ label: d.label, value: d.net, tip: `${d.label} · ${d.n} ไม้ · ${fmtUSD(d.net)}` })),
  }) : {});
  mountChart('hr', A.by_hour.length ? barChart({
    title: 'P&L ตามชั่วโมง', height: 200,
    items: A.by_hour.map((d) => ({ label: d.hour + ':00', value: d.net, tip: `${d.hour}:xx · ${d.n} ไม้ · ${fmtUSD(d.net)}` })),
  }) : {});
  mountChart('cal', A.by_date.length ? calendar({ byDate: A.by_date }) : {});
}

// ---------- ตารางไม้ + กรอกผล ----------
const RESULT_FIELDS = [
  ['outcome', 'ผลจบยังไง', 'select', ['open', 'tp', 'sl', 'manual', 'not_taken']],
  ['mt4_ticket', 'MT4 ticket', 'text'],
  ['mt4_tickets', 'จำนวน ticket (ไม้เดียว = 1)', 'number'],
  ['entry_price', 'ราคาเข้าจริง', 'number'],
  ['entry_at', 'เวลาเข้าจริง (YYYY-MM-DD HH:MM)', 'text'],
  ['exit_price', 'ราคาปิดจริง', 'number'],
  ['exit_at', 'เวลาปิดจริง (YYYY-MM-DD HH:MM)', 'text'],
  ['lot', 'lot จริง', 'number'],
  ['spread', 'สเปรด', 'number'],
  ['profit', 'P/L (USD)', 'number'],
  ['mfe', 'ไปไกลสุดฝั่งกำไร', 'number'],
  ['mae', 'ไกลสุดฝั่งขาดทุน', 'number'],
  ['wall_touched', 'แตะกำแพงแล้วเด้ง? (1/0)', 'number'],
  ['news', 'ข่าววันนั้น', 'text'],
  ['tags', 'ป้าย (คั่นด้วย ,)', 'text'],
  ['note', 'หมายเหตุ', 'text'],
];

function renderTrades() {
  const tb = $('#trades');
  const rows = [...A.trades].sort((a, b) => b.sort_key.localeCompare(a.sort_key));
  if (!rows.length) { tb.innerHTML = '<tr><td colspan="13" class="empty">ยังไม่มีไม้ในระบอบนี้</td></tr>'; return; }
  tb.innerHTML = rows.map((t) => {
    const fl = t.flags;
    const chips = fl.violations.map((k) => `<span class="chip v">${FLAG_LABELS[k]}</span>`).join('') + (fl.held_past_23 ? `<span class="chip i">${FLAG_LABELS.held_past_23}</span>` : '');
    return `<tr>
      <td class="n">${esc(t.signal_date)}</td><td class="n">${esc(t.bar_time ?? '')}</td><td>${esc(t.side)}</td>
      <td class="n">${n(t.signal_price)}</td><td class="n">${n(t.planned_dist, 0)}</td><td class="n">${n(t.atr, 1)}</td>
      <td class="n">${n(t.planned_lot)} → ${t.lot == null ? '—' : n(t.lot)}</td>
      <td>${t.wall_state ? esc(t.wall_state) : '—'}</td>
      <td><span class="chip ${esc(t.outcome ?? 'open')}">${esc(t.outcome ?? 'open')}</span></td>
      <td class="n">${t.profit == null ? '—' : signed(t.profit)}</td><td class="n">${t.r == null ? '—' : fmtR(t.r)}</td>
      <td>${chips || '<span class="dim">—</span>'}</td>
      <td><button class="ghost tiny" data-edit="${t.id}">กรอกผล</button></td></tr>`;
  }).join('');
  tb.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openResult(Number(b.dataset.edit))));
}

function openResult(id) {
  const t = A.trades.find((x) => x.id === id); if (!t) return;
  const fields = RESULT_FIELDS.map(([k, label, type, opts]) => {
    const v = t[k] ?? '';
    const input = type === 'select'
      ? `<select name="${k}">${opts.map((o) => `<option${o === (t.outcome ?? 'open') ? ' selected' : ''}>${o}</option>`).join('')}</select>`
      : `<input name="${k}" type="${type}" ${type === 'number' ? 'step="any"' : ''} value="${esc(v)}">`;
    return `<div class="f"><label>${label}</label>${input}</div>`;
  }).join('');
  $('#edit-out').innerHTML = `<div class="panel"><h3 style="font-size:15px">กรอกผลจาก MT4 — <span class="mono">${esc(t.trade_id)}</span></h3>
    <p class="hint">เวลาใช้ฟอร์แมต <span class="mono">YYYY-MM-DD HH:MM</span> เวลาไทย — ตัวจับผิด "เข้าก่อนดาบออก" เทียบกับแท่งที่ยิง ${esc(t.signal_date)} ${esc(t.bar_time ?? '')}</p>
    <form id="result-form"><div class="fgrid">${fields}</div>
      <div class="row"><button type="submit">บันทึกผล</button><button type="button" class="ghost" id="btn-cancel">ยกเลิก</button>
        <button type="button" class="ghost" id="btn-del" style="margin-left:auto;color:var(--loss)">ลบไม้นี้</button></div></form></div>`;
  $('#btn-cancel').addEventListener('click', () => { $('#edit-out').innerHTML = ''; });
  $('#btn-del').addEventListener('click', async () => {
    if (!confirm(`ลบ ${t.trade_id} ออกจากสมุด?`)) return;
    await api(`/api/trades/${id}`, { method: 'DELETE' }); $('#edit-out').innerHTML = ''; await load();
  });
  $('#result-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const patch = {};
    for (const [k, v] of new FormData(e.target).entries()) if (v !== '') patch[k] = v;
    try {
      await api(`/api/trades/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      $('#edit-out').innerHTML = '<div class="ok">บันทึกผลแล้ว</div>'; await load();
    } catch (err) { $('#edit-out').innerHTML = `<div class="warn">${esc(err.message)}</div>`; }
  });
  $('#edit-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- บันทึกไม้ใหม่: วางข้อความ Telegram หรือกรอกเอง ----------
// ทั้งสองทางจบที่ฟอร์มเดียวกัน — ต่างกันแค่ "ค่าตั้งต้นมาจากไหน"
// ★ ต้องมีทางกรอกเองเสมอ: Telegram เคยเงียบ 2/2 เพราะช่อง Webhook URL ในหน้าตั้ง alert ไม่ได้ติ๊ก
//   ถ้าเพิ่มไม้ได้เฉพาะตอนมีข้อความ = คืนที่ระบบเงียบก็จะไม่มีบันทึกไม้นั้นเลย

// [ฟิลด์, ป้ายไทย, ชนิด, ตัวเลือก/คำใบ้]
const NEW_FIELDS = [
  ['signal_date',    'วันที่ดาบออก *',        'date',   {}],
  ['bar_time',       'เวลาปิดแท่ง M15 *',     'time',   {}],
  ['side',           'ทาง *',                 'select', { opts: ['', 'BUY', 'SELL'] }],
  ['signal_price',   'ราคาตอนดาบออก',         'number', { hint: 'ราคาปิดแท่งที่ยิง = ราคาที่ตั้งใจเข้า' }],
  ['atr',            'ATR ตอนยิง',            'number', {}],
  ['trigger_usd',    'Trigger (USD)',         'number', {}],
  ['planned_sl',     'SL ที่ตั้ง',            'number', {}],
  ['planned_tp',     'TP ที่ตั้ง',            'number', {}],
  ['planned_dist',   'ระยะ SL/TP',            'number', { auto: 'คิดให้จาก TP − ราคา' }],
  ['planned_lot',    'lot ตามแผน',            'number', { hint: 'ตัวหารของ R — ขาดตัวนี้ R คำนวณไม่ได้' }],
  ['wall_state',     'สถานะกำแพง',            'select', { opts: ['', 'clear', 'tight', 'blocked', 'crossed'] }],
  ['wall_dist_ahead','ระยะถึงกำแพงข้างหน้า',  'number', {}],
  ['basis',          'basis',                 'number', {}],
  ['put_wall',       'put wall',              'number', {}],
  ['call_wall',      'call wall',             'number', {}],
  ['news',           'ข่าววันนั้น',           'text',   { hint: 'เช่น NFP · CPI · FOMC — ว่างได้ถ้าไม่มี' }],
  ['note',           'หมายเหตุ',              'text',   {}],
];

function newFormHTML(row) {
  const fields = NEW_FIELDS.map(([k, label, type, o]) => {
    const v = row[k] ?? '';
    const ctl = type === 'select'
      ? `<select name="${k}">${o.opts.map((op) => `<option value="${esc(op)}"${String(v) === op ? ' selected' : ''}>${op || '—'}</option>`).join('')}</select>`
      : `<input name="${k}" type="${type}" ${type === 'number' ? 'step="any"' : ''} value="${esc(v)}">`;
    return `<div class="f"><label>${label}</label>${ctl}${o.hint || o.auto ? `<div class="dim" style="font-size:11.5px;margin-top:2px">${esc(o.hint ?? o.auto)}</div>` : ''}</div>`;
  }).join('');
  return `<form id="new-form"><div class="fgrid">${fields}</div>
    <div class="row">
      <button type="submit">บันทึกลงสมุด</button>
      <span class="mono dim" style="font-size:12px">trade_id: <b id="tid">—</b> · ruleset ${esc(boot.current?.code ?? '—')} · ผลจะเป็น <b>open</b> จนกว่าจะกรอกผล</span>
    </div></form>`;
}

// เติมให้อัตโนมัติ: trade_id (วัน+เวลา+ทาง) · planned_dist (|TP − ราคา|) · session (เช้า/เย็น)
// ทำสดขณะพิมพ์ จะได้เห็นว่า trade_id จะออกมาหน้าตายังไงก่อนกดบันทึก (มันคือ key ที่ห้ามชนกัน)
function wireNewForm(afterSave) {
  const form = $('#new-form');
  const get = (k) => form.elements[k]?.value?.trim() ?? '';
  const recompute = () => {
    const d = get('signal_date'), t = get('bar_time'), sd = get('side');
    const tid = d && t && sd ? `${d.replace(/-/g, '')}-${t.replace(':', '')}-${sd}` : '—';
    $('#tid').textContent = tid;
    const price = Number(get('signal_price')), tp = Number(get('planned_tp'));
    const distEl = form.elements['planned_dist'];
    if (!distEl.value && price && tp) distEl.value = Math.round(Math.abs(tp - price) * 100) / 100;
    return tid;
  };
  form.addEventListener('input', recompute);
  recompute();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tid = recompute();
    if (tid === '—') { $('#parse-out').insertAdjacentHTML('afterbegin', '<div class="warn">ต้องมี วันที่ + เวลา + ทาง ครบก่อน (สามช่องที่มี *) เพราะสามอย่างนี้ประกอบเป็น trade_id</div>'); return; }
    const body = { ruleset_id: boot.current?.id, trade_id: tid };
    for (const [k, v] of new FormData(form).entries()) if (v !== '') body[k] = v;
    const h = Number(get('bar_time').slice(0, 2));
    if (get('bar_time')) body.session = h < 12 ? 'morning' : 'evening';
    body.system = 'v5';
    try {
      await api('/api/trades', { method: 'POST', body: JSON.stringify(body) });
      $('#tg').value = '';
      $('#parse-out').innerHTML = `<div class="ok">บันทึก <b class="mono">${esc(tid)}</b> ลงสมุดแล้ว — ไม้อยู่ในตารางด้านบน สถานะ <b>open</b> · พอไม้จบค่อยกด "กรอกผล"</div>`;
      await load();
      if (afterSave) afterSave();
    } catch (err) { $('#parse-out').innerHTML = `<div class="warn">${esc(err.message)}</div>`; }
  });
}

$('#btn-clear').addEventListener('click', () => { $('#tg').value = ''; $('#parse-out').innerHTML = ''; });

$('#btn-parse').addEventListener('click', async () => {
  const text = $('#tg').value.trim();
  if (!text) { $('#parse-out').innerHTML = '<div class="warn">ยังไม่ได้วางข้อความ — ถ้าไม่มีข้อความ Telegram ให้กดปุ่ม <b>กรอกเอง</b> แทน</div>'; return; }
  const { row, warnings } = await api('/api/parse', { method: 'POST', body: JSON.stringify({ text }) });
  $('#parse-out').innerHTML =
    (warnings.length
      ? `<div class="warn"><b>แกะไม่ได้ ${warnings.length} จุด — เติมเองแล้วตรวจก่อนบันทึก</b><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
      : '<div class="ok">แกะครบทุกฟิลด์ — ตรวจแล้วกดบันทึกได้เลย</div>') + newFormHTML(row);
  wireNewForm();
});

$('#btn-manual').addEventListener('click', () => {
  const now = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  // เวลาไทยจากเครื่อง แล้วปัดลงเป็นแท่ง M15 ที่เพิ่งปิด
  const th = new Date(now.getTime() + (now.getTimezoneOffset() + 420) * 60000);
  const row = {
    signal_date: `${th.getFullYear()}-${pad(th.getMonth() + 1)}-${pad(th.getDate())}`,
    bar_time: `${pad(th.getHours())}:${pad(Math.floor(th.getMinutes() / 15) * 15)}`,
  };
  $('#parse-out').innerHTML = '<div class="ok">กรอกเอง — ช่องที่มี <b>*</b> ต้องมี ที่เหลือเว้นได้ (เว้นแล้วสถิติที่ต้องใช้ช่องนั้นจะข้ามไม้นี้ ไม่ใช่เดาให้)</div>' + newFormHTML(row);
  wireNewForm();
  $('#parse-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------- โหลด ----------
function renderCarried() {
  $('#carried').innerHTML = `<ul>${boot.carried.map((c) => `<li><b>${esc(c.key)} = ${esc(c.value)}</b> — ${esc(c.note)}</li>`).join('')}</ul>`;
}

async function loadAnalytics(rid) {
  document.body.classList.add('loading');            // ค้างภาพเดิมไว้จางๆ ไม่กระพริบ
  try {
    A = await api(`/api/analytics?ruleset=${rid}`);
    renderGate(); renderHero(); renderDiscipline(); renderCharts(); renderTrades();
  } finally { document.body.classList.remove('loading'); }
}

async function load() {
  boot = await api('/api/bootstrap');
  const sel = $('#ruleset-sel');
  const keep = sel.value;
  sel.innerHTML = boot.rulesets.map((r) => `<option value="${r.id}">${esc(r.code)} · ${esc(r.name)}${r.effective_to ? '' : ' (ปัจจุบัน)'}</option>`).join('');
  sel.value = keep || String(boot.current?.id ?? boot.rulesets.at(-1)?.id);
  renderCarried();
  await loadAnalytics(Number(sel.value));
  await refreshDesk();
}
$('#ruleset-sel').addEventListener('change', (e) => loadAnalytics(Number(e.target.value)));
load().catch((e) => { document.body.insertAdjacentHTML('afterbegin', `<div class="warn">${esc(e.message)}</div>`); });
