// เรนเดอร์กราฟจากผล /api/analytics เป็น HTML นิ่ง (ไม่มี JS) ไว้แคปดูด้วยตา — ใช้ CSS ชุดเดียวกับหน้าจริง
//   node scripts/preview.js <analytics.json> <out.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const { lineChart, areaChart, barChart, calendar, fmtUSD, fmtR } = await import(resolve(here, '../public/charts.js'));

const [,, inPath, outPath] = process.argv;
const A = JSON.parse(readFileSync(inPath, 'utf8'));
const css = readFileSync(resolve(here, '../public/index.html'), 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];

const eq = A.equity;
const points = eq.map((e) => ({ label: e.date.slice(5), sub: e.trade_id }));
const card = (t, sub, c) => `<div class="card"><div class="hd"><h3>${t}</h3><span class="sub">${sub}</span></div><div class="chart">${c.svg}</div></div>`;
const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>${css}</style></head><body><div class="wrap">
<div class="hero"><div><div class="lbl">Net P&L · ${A.ruleset.code} · USD</div><div class="big">+${A.net.toLocaleString()}</div></div>
<div class="sub">ตามแผน +${A.plan_net.toLocaleString()} · ส่วนต่าง ${A.leak}</div></div>
${card('Equity', 'USD สะสม', lineChart({ title: 'Equity', points, series: [
  { name: 'ทำจริง', color: 'var(--series-1)', values: eq.map((e) => e.actual) },
  { name: 'ตามแผน', color: 'var(--series-2)', values: eq.map((e) => e.plan) }] }))}
${card('Drawdown', 'ระยะจากจุดสูงสุด', areaChart({ title: 'Drawdown', points, values: eq.map((e) => e.dd) }))}
${card('R ต่อไม้', 'ไม้ตามแผนหรี่ · แหกแผนเต็มสี', barChart({ title: 'R', yFmt: fmtR, xEvery: 4,
  items: eq.map((e) => ({ label: e.date.slice(5), value: e.r ?? 0, muted: e.clean })) }))}
<div class="grid2">
${card('การแจกแจง R', 'ช่องละ 0.5R', barChart({ title: 'R hist', yFmt: (v) => String(Math.round(v)), labelExtremes: false, height: 200,
  items: A.r_hist.map((b) => ({ label: (b.r > 0 ? '+' : '') + b.r + 'R', value: b.n })) }))}
${card('ตามวันในสัปดาห์', 'P&L สุทธิ', barChart({ title: 'wd', height: 200, items: A.by_weekday.map((d) => ({ label: d.label, value: d.net })) }))}
</div><div class="grid2">
${card('ตามชั่วโมง', 'P&L สุทธิ', barChart({ title: 'hr', height: 200, items: A.by_hour.map((d) => ({ label: d.hour + ':00', value: d.net })) }))}
${card('ปฏิทิน', 'P&L รายวัน', calendar({ byDate: A.by_date }))}
</div></div></body></html>`;
writeFileSync(outPath, html);
console.log('เขียน', outPath, `(${(html.length / 1024).toFixed(0)} KB)`);
