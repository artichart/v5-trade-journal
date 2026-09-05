// วาดกราฟเป็น SVG เอง — zero dependency เท่ากับฝั่ง server
// ทุกฟังก์ชันคืน { svg, table, meta }: svg = มาร์กอัป · table = ตารางคู่แฝด (อ่านได้โดยไม่ต้อง hover) · meta = ข้อมูลให้ hover
//
// สเปกมาร์กที่ยึดตลอดไฟล์ (จาก dataviz): เส้น 2px มุมมน · แท่ง ≤24px ปลายมน 4px ฐานเหลี่ยม · จุดปลาย r≥4 + วงแหวนสีพื้น 2px
// · กริดเส้นบาง 1px ทึบ (ไม่ใช้เส้นประ) · ข้อความใช้สีข้อความเสมอ ไม่ใช้สีซีรีส์ · ป้ายตัวเลขใส่เฉพาะจุดสำคัญ ไม่ใส่ทุกจุด

export const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtUSD = (v) => (v == null ? '—' : (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 }));
export const fmtR = (v) => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + 'R');

// ขีดแกนสวยๆ: 0 / 1,000 / 2,000 — ไม่ใช่ 0 / 873 / 1,746
function niceTicks(min, max, n = 5) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? mag * 10;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks };
}

const FONT = 'font-family="system-ui,-apple-system,sans-serif"';
const axisText = (x, y, txt, anchor = 'middle', extra = '') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="11" fill="var(--muted)" ${FONT} style="font-variant-numeric:tabular-nums" ${extra}>${esc(txt)}</text>`;

// แท่งปลายมนเฉพาะด้านที่ห่างจากฐาน (ฐานเหลี่ยมเสมอ) — วาดจากฐานเดียว
function barPath(x, y0, y1, w) {
  const up = y1 < y0, top = Math.min(y0, y1), h = Math.abs(y1 - y0);
  const r = Math.min(4, w / 2, h);
  if (h < 0.5) return '';
  if (up)  return `M${x},${y0} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${y0} Z`;
  const bot = y0 + h;
  return `M${x},${y0} V${bot - r} Q${x},${bot} ${x + r},${bot} H${x + w - r} Q${x + w},${bot} ${x + w},${bot - r} V${y0} Z`;
}

/**
 * กราฟเส้นหลายซีรีส์บนแกน x เดียว (ดัชนีไม้) — legend เสมอเมื่อ ≥2 ซีรีส์ + ป้ายค่าปลายเส้น
 * series: [{ name, color: 'var(--series-1)', values: number[] }]
 * points: [{ label, sub }] ยาวเท่ากับ values ใช้ทำ tooltip / ป้ายแกน x
 */
export function lineChart({ series, points, width = 760, height = 280, yFmt = fmtUSD, title = '' }) {
  const n = points.length;
  const pad = { l: 60, r: 96, t: series.length > 1 ? 34 : 14, b: 30 };
  const W = width, H = height, pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const all = series.flatMap((s) => s.values).concat([0]);
  const { lo, hi, ticks } = niceTicks(Math.min(...all), Math.max(...all));
  const sx = (i) => pad.l + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const sy = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * ph;

  let g = '';
  for (const tv of ticks) {
    const y = sy(tv);
    g += `<line x1="${pad.l}" x2="${pad.l + pw}" y1="${y}" y2="${y}" stroke="${tv === 0 ? 'var(--axis)' : 'var(--grid)'}" stroke-width="1"/>`;
    g += axisText(pad.l - 8, y + 4, yFmt(tv), 'end');
  }
  // ป้ายแกน x ห่างกันพอไม่ทับ (~90px)
  const every = Math.max(1, Math.ceil(90 / (pw / Math.max(1, n - 1))));
  for (let i = 0; i < n; i += every) g += axisText(sx(i), H - 8, points[i].label);

  let lines = '', ends = '', legend = '';
  series.forEach((s, k) => {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('');
    lines += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const li = n - 1, ex = sx(li), ey = sy(s.values[li]);
    ends += `<circle cx="${ex}" cy="${ey}" r="6" fill="var(--surface)"/><circle cx="${ex}" cy="${ey}" r="4" fill="${s.color}"/>`;
    // ป้ายปลายเส้น: ค่า (เด่น) + ชื่อ — ใช้สีข้อความ ไม่ใช้สีเส้น · ถ้าปลายสองเส้นชิดกันให้ดันแยกด้วย leader
    ends += `<text x="${ex + 10}" y="${ey + 4 + (k && series.length > 1 && Math.abs(sy(series[0].values[li]) - ey) < 14 ? (ey >= sy(series[0].values[li]) ? 12 : -12) : 0)}" font-size="11.5" fill="var(--ink)" ${FONT} font-weight="600">${esc(yFmt(s.values[li]))}<tspan fill="var(--muted)" font-weight="400"> ${esc(s.name)}</tspan></text>`;
    if (series.length > 1) legend += `<g transform="translate(${pad.l + k * 150},12)"><line x1="0" x2="18" y1="0" y2="0" stroke="${s.color}" stroke-width="2" stroke-linecap="round"/><text x="24" y="4" font-size="11.5" fill="var(--ink)" ${FONT}>${esc(s.name)}</text></g>`;
  });

  // ชั้น hover: เส้นตั้ง + จุดต่อซีรีส์ (ซ่อนไว้ · app.js ควบคุม) + สี่เหลี่ยมโปร่งรับ pointer ทั้ง plot
  const hover = `<g class="hover" style="display:none"><line class="xh" y1="${pad.t}" y2="${pad.t + ph}" stroke="var(--axis)" stroke-width="1"/>` +
    series.map((s) => `<circle class="hd" r="6" fill="var(--surface)"/><circle class="hd2" r="4" fill="${s.color}"/>`).join('') + `</g>` +
    `<rect class="hit" x="${pad.l}" y="${pad.t}" width="${pw}" height="${ph}" fill="transparent" style="cursor:crosshair"/>`;

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(title)}" style="display:block;max-width:100%;height:auto">${legend}${g}${lines}${ends}${hover}</svg>`;
  const table = `<table class="tv"><thead><tr><th>#</th><th>ไม้</th>${series.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr></thead><tbody>` +
    points.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.label)}${p.sub ? ` <span class="dim">${esc(p.sub)}</span>` : ''}</td>${series.map((s) => `<td class="n">${esc(yFmt(s.values[i]))}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
  return { svg, table, meta: { kind: 'line', xs: points.map((_, i) => sx(i)), sy: series.map((s) => s.values.map(sy)), series, points, yFmt } };
}

/** พื้นที่ซีรีส์เดียว (drawdown): เส้น 2px + สีล้าง ~10% — ไม่มี legend เพราะชื่อกราฟบอกอยู่แล้ว */
export function areaChart({ values, points, color = 'var(--series-1)', width = 760, height = 160, yFmt = fmtUSD, title = '' }) {
  const n = values.length;
  const pad = { l: 60, r: 96, t: 12, b: 30 };
  const W = width, H = height, pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const { lo, hi, ticks } = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 3);
  const sx = (i) => pad.l + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const sy = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * ph;
  let g = '';
  for (const tv of ticks) {
    const y = sy(tv);
    g += `<line x1="${pad.l}" x2="${pad.l + pw}" y1="${y}" y2="${y}" stroke="${tv === 0 ? 'var(--axis)' : 'var(--grid)'}" stroke-width="1"/>` + axisText(pad.l - 8, y + 4, yFmt(tv), 'end');
  }
  const every = Math.max(1, Math.ceil(90 / (pw / Math.max(1, n - 1))));
  for (let i = 0; i < n; i += every) g += axisText(sx(i), H - 8, points[i].label);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('');
  const area = `${line}L${sx(n - 1).toFixed(1)},${sy(0)}L${sx(0).toFixed(1)},${sy(0)}Z`;
  const minI = values.indexOf(Math.min(...values));
  const mark = values[minI] < 0 ? `<circle cx="${sx(minI)}" cy="${sy(values[minI])}" r="6" fill="var(--surface)"/><circle cx="${sx(minI)}" cy="${sy(values[minI])}" r="4" fill="${color}"/>` +
    `<text x="${sx(minI) + (minI > n * 0.7 ? -10 : 10)}" y="${sy(values[minI]) + 14}" text-anchor="${minI > n * 0.7 ? 'end' : 'start'}" font-size="11.5" fill="var(--ink)" ${FONT} font-weight="600">${esc(yFmt(values[minI]))}<tspan fill="var(--muted)" font-weight="400"> ลึกสุด</tspan></text>` : '';
  const hover = `<g class="hover" style="display:none"><line class="xh" y1="${pad.t}" y2="${pad.t + ph}" stroke="var(--axis)" stroke-width="1"/><circle class="hd" r="6" fill="var(--surface)"/><circle class="hd2" r="4" fill="${color}"/></g>` +
    `<rect class="hit" x="${pad.l}" y="${pad.t}" width="${pw}" height="${ph}" fill="transparent" style="cursor:crosshair"/>`;
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(title)}" style="display:block;max-width:100%;height:auto">${g}<path d="${area}" fill="${color}" fill-opacity="0.1"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${mark}${hover}</svg>`;
  const table = `<table class="tv"><thead><tr><th>#</th><th>ไม้</th><th>${esc(title)}</th></tr></thead><tbody>` +
    points.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.label)}</td><td class="n">${esc(yFmt(values[i]))}</td></tr>`).join('') + '</tbody></table>';
  return { svg, table, meta: { kind: 'line', xs: points.map((_, i) => sx(i)), sy: [values.map(sy)], series: [{ name: title, color, values }], points, yFmt } };
}

/**
 * แท่งแยกขั้ว (บวก/ลบรอบฐาน 0): น้ำเงิน = บวก · แดง = ลบ (คู่ diverging ที่วาลิเดตแล้ว)
 * items: [{ label, value, tip, muted? }] — muted = แท่งที่ไม่ใช่ประเด็น (หรี่)
 * labelExtremes: ใส่ป้ายตัวเลขเฉพาะสูงสุด/ต่ำสุด ที่เหลืออยู่ใน tooltip + ตาราง
 */
export function barChart({ items, width = 760, height = 220, yFmt = fmtUSD, title = '', labelExtremes = true, xEvery = 1 }) {
  const n = items.length;
  const pad = { l: 60, r: 16, t: 14, b: 30 };
  const W = width, H = height, pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const vals = items.map((d) => d.value ?? 0);
  const { lo, hi, ticks } = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const sy = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * ph;
  const slot = pw / Math.max(1, n);
  const bw = Math.max(2, Math.min(24, slot - 2));           // ≤24px · เว้นช่องสีพื้น 2px
  const y0 = sy(0);
  let g = '';
  for (const tv of ticks) {
    const y = sy(tv);
    g += `<line x1="${pad.l}" x2="${pad.l + pw}" y1="${y}" y2="${y}" stroke="${tv === 0 ? 'var(--axis)' : 'var(--grid)'}" stroke-width="1"/>` + axisText(pad.l - 8, y + 4, yFmt(tv), 'end');
  }
  const maxI = vals.indexOf(Math.max(...vals)), minI = vals.indexOf(Math.min(...vals));
  let bars = '', hits = '';
  items.forEach((d, i) => {
    const x = pad.l + i * slot + (slot - bw) / 2;
    const v = d.value ?? 0;
    const color = v >= 0 ? 'var(--pos)' : 'var(--neg)';
    bars += `<path d="${barPath(x, y0, sy(v), bw)}" fill="${color}"${d.muted ? ' fill-opacity="0.45"' : ''}/>`;
    if (i % xEvery === 0) g += axisText(x + bw / 2, H - 8, d.label);
    if (labelExtremes && v !== 0 && (i === maxI || i === minI) && n > 1) {
      g += `<text x="${x + bw / 2}" y="${v > 0 ? sy(v) - 6 : sy(v) + 14}" text-anchor="middle" font-size="11" fill="var(--ink)" ${FONT} font-weight="600">${esc(yFmt(v))}</text>`;
    }
    hits += `<rect class="hit" data-tip="${esc(d.tip ?? `${d.label}: ${yFmt(v)}`)}" x="${pad.l + i * slot}" y="${pad.t}" width="${slot}" height="${ph}" fill="transparent"/>`;
  });
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(title)}" style="display:block;max-width:100%;height:auto">${g}${bars}${hits}</svg>`;
  const table = `<table class="tv"><thead><tr><th>${esc(title)}</th><th>ค่า</th></tr></thead><tbody>` +
    items.map((d) => `<tr><td>${esc(d.tipLabel ?? d.label)}</td><td class="n">${esc(yFmt(d.value ?? 0))}</td></tr>`).join('') + '</tbody></table>';
  return { svg, table, meta: { kind: 'bars' } };
}

/**
 * ปฏิทิน P&L รายวัน (จ–ศ): 7 ชั้นสี diverging น้ำเงิน↔แดง กลางเป็นเทา · ไม่มีไม้ = โครงจาง
 * byDate: [{ date: 'YYYY-MM-DD', net, n }]
 */
export function calendar({ byDate, width = 760, cell = 18, gap = 2, title = 'P&L รายวัน' }) {
  if (!byDate.length) return { svg: '', table: '', meta: {} };
  const map = new Map(byDate.map((d) => [d.date, d]));
  const first = new Date(`${byDate[0].date}T00:00:00Z`), last = new Date(`${byDate[byDate.length - 1].date}T00:00:00Z`);
  // เริ่มวันจันทร์ของสัปดาห์แรก
  const start = new Date(first); start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const maxAbs = Math.max(1, ...byDate.map((d) => Math.abs(d.net)));
  const bin = (v) => { const t = Math.abs(v) / maxAbs; return t < 1e-9 ? 0 : t < 1 / 3 ? 1 : t < 2 / 3 ? 2 : 3; };
  const padL = 28, padT = 22;
  let g = '', weeks = 0, monthMarks = '';
  const W = width;
  let d = new Date(start), lastMonth = -1;
  while (d <= last) {
    const dow = (d.getUTCDay() + 6) % 7;   // จ=0
    if (dow < 5) {
      const key = d.toISOString().slice(0, 10);
      const x = padL + weeks * (cell + gap), y = padT + dow * (cell + gap);
      const rec = map.get(key);
      if (d.getUTCMonth() !== lastMonth && dow === 0) {
        lastMonth = d.getUTCMonth();
        monthMarks += axisText(x, 12, d.toLocaleString('th-TH', { month: 'short', timeZone: 'UTC' }), 'start');
      }
      if (rec) {
        const b = bin(rec.net), col = rec.net >= 0 ? 'var(--pos)' : 'var(--neg)';
        const op = b === 0 ? 0 : [0, 0.33, 0.66, 1][b];
        g += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${b === 0 ? 'var(--mid)' : col}" fill-opacity="${b === 0 ? 1 : op}"/>`;
        g += `<rect class="hit" data-tip="${esc(`${key} · ${rec.n} ไม้ · ${fmtUSD(rec.net)}`)}" x="${x - 1}" y="${y - 1}" width="${cell + 2}" height="${cell + 2}" fill="transparent"/>`;
      } else {
        g += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="none" stroke="var(--grid)" stroke-width="1"/>`;
      }
    }
    if (dow === 6) weeks += 1;
    d = new Date(d.getTime() + 86400000);
    if (d > last && dow < 6) weeks += 1;
  }
  ['จ', 'อ', 'พ', 'พฤ', 'ศ'].forEach((t, i) => { g += axisText(padL - 8, padT + i * (cell + gap) + cell / 2 + 4, t, 'end'); });
  const H = padT + 5 * (cell + gap) + 8;
  const svg = `<svg viewBox="0 0 ${Math.max(W, padL + weeks * (cell + gap) + 8)} ${H}" width="100%" role="img" aria-label="${esc(title)}" style="display:block;max-width:100%;height:auto">${monthMarks}${g}</svg>`;
  const table = `<table class="tv"><thead><tr><th>วัน</th><th>ไม้</th><th>P&L</th></tr></thead><tbody>` +
    byDate.map((r) => `<tr><td>${esc(r.date)}</td><td class="n">${r.n}</td><td class="n">${esc(fmtUSD(r.net))}</td></tr>`).join('') + '</tbody></table>';
  return { svg, table, meta: { kind: 'cells' } };
}

// ---------- hover ----------
// เส้นตั้งวิ่งตาม pointer แล้ว snap ไปดัชนีที่ใกล้สุด · tooltip แสดงทุกซีรีส์ที่ x นั้น (ค่าเด่น ชื่อรอง)
export function attachHover(container, meta, tip) {
  const svg = container.querySelector('svg');
  if (!svg) return;
  const hit = svg.querySelector('.hit');
  const show = (html, ev) => {
    tip.innerHTML = html; tip.hidden = false;
    const r = container.getBoundingClientRect();
    const x = Math.min(ev.clientX - r.left + 14, r.width - tip.offsetWidth - 8);
    tip.style.transform = `translate(${Math.max(0, x)}px, ${ev.clientY - r.top + 14}px)`;
  };
  const hide = () => { tip.hidden = true; const h = svg.querySelector('.hover'); if (h) h.style.display = 'none'; };

  if (meta.kind === 'line' && hit) {
    const hov = svg.querySelector('.hover');
    const dots = [...svg.querySelectorAll('.hd')], dots2 = [...svg.querySelectorAll('.hd2')], xh = svg.querySelector('.xh');
    const vb = svg.viewBox.baseVal;
    hit.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * vb.width;
      let best = 0, bd = Infinity;
      meta.xs.forEach((x, i) => { const d = Math.abs(x - px); if (d < bd) { bd = d; best = i; } });
      hov.style.display = '';
      xh.setAttribute('x1', meta.xs[best]); xh.setAttribute('x2', meta.xs[best]);
      meta.sy.forEach((ys, k) => { dots[k].setAttribute('cx', meta.xs[best]); dots[k].setAttribute('cy', ys[best]); dots2[k].setAttribute('cx', meta.xs[best]); dots2[k].setAttribute('cy', ys[best]); });
      const p = meta.points[best];
      const rows = meta.series.map((s) => `<div class="tr"><span class="key" style="background:${s.color}"></span><b>${esc(meta.yFmt(s.values[best]))}</b><span>${esc(s.name)}</span></div>`).join('');
      show(`<div class="th">${esc(p.label)}${p.sub ? ` <span class="dim">${esc(p.sub)}</span>` : ''}</div>${rows}`, ev);
    });
    hit.addEventListener('pointerleave', hide);
  } else {
    svg.querySelectorAll('.hit').forEach((el) => {
      el.addEventListener('pointermove', (ev) => show(`<div class="th">${esc(el.dataset.tip)}</div>`, ev));
      el.addEventListener('pointerleave', hide);
    });
  }
}
