#!/usr/bin/env bash
# ประกอบ docs/index.html — ไฟล์เดียวจบ ไม่มี dependency ไม่ต้องมี server (ขึ้น GitHub Pages ได้)
#
# ★ กติกาข้อเดียวที่ทั้งไฟล์นี้มีไว้รักษา: **แก้ที่ src/ กับ public/ ที่เดียวเสมอ**
#   ไฟล์เดียวกันนั้นรันได้ทั้งสองโหมด (Node localhost / static บนเบราว์เซอร์)
#   ถ้าวันหนึ่งไปแก้ docs/index.html ตรงๆ = โค้ดสองชุดที่ต้องแก้คู่กันตลอดไป
#   ซึ่งเป็นกับดักที่โปรเจกต์นี้เจอมาแล้วหลายรอบ (Pine indicator vs _strategy · basis สองฝั่ง)
#
# รัน: bash web/build.sh   แล้ว commit docs/index.html
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
import re, pathlib

def strip_mod(src):
    """ตัด import/export ออก ให้เอามาต่อกันในสโคปเดียวได้"""
    # ⚠️ ต้องผูกกับต้นบรรทัด **ไม่มี indent** และตามด้วยตัวคั่นจริงๆ
    #   ไม่งั้นจะไปกินเมธอดที่ชื่อขึ้นต้นว่า import เช่น importJSON() ของ store (เจอมาแล้ว)
    src = re.sub(r'^import[\s{\'"*][^\n]*\n', '', src, flags=re.M)
    src = re.sub(r'^export\s+', '', src, flags=re.M)
    return src.strip()

read = lambda p: pathlib.Path(p).read_text(encoding='utf-8')

analytics = strip_mod(read('src/analytics.js'))
parse     = strip_mod(read('src/parse.js'))
charts    = strip_mod(read('public/charts.js'))
store     = strip_mod(read('web/store.js'))
shim      = strip_mod(read('web/api-shim.js'))
app       = strip_mod(read('public/app.js'))

# ---- parse.js มี helper ชื่อ num เหมือน analytics.js (คนละตัว ใช้ภายในไฟล์ทั้งคู่)
#      ทั้งสองไม่ได้ export ออกไปไหน → เปลี่ยนชื่อฝั่ง parse ตอนประกอบได้ปลอดภัย
parse = re.sub(r'\bnum\b', 'pnum', parse)

# ---- ชนกันชื่อเดียว: FLAG_LABELS มีทั้งใน analytics (ข้อความยาว ใช้ในแผงวินัย)
#      และ app.js (ข้อความสั้น ใช้ในชิปบนตาราง) → เปลี่ยนชื่อฝั่ง app ตอนประกอบ
app = re.sub(r'\bFLAG_LABELS\b', 'UI_FLAG_LABELS', app)

# ---- app.js เรียก api() ผ่าน fetch ตอนรันบน Node · เวอร์ชัน static ใช้ shim แทน
app = re.sub(r'const api = async \(path, opts\) => \{.*?\n\};\n', '', app, flags=re.S)

# ---- ต่อ backupBar() เข้ากับ load() ให้แถบสำรองอัปเดตทุกครั้งที่ข้อมูลเปลี่ยน
app = app.replace('  renderCarried();\n  await loadAnalytics', '  renderCarried();\n  backupBar();\n  await loadAnalytics')

html = read('public/index.html')
title = re.search(r'<title>(.*?)</title>', html, re.S).group(1)
style = re.search(r'<style>(.*?)</style>', html, re.S).group(1)
body  = re.search(r'<body>(.*)</body>', html, re.S).group(1)
body  = re.sub(r'<script[^>]*src="[^"]*"[^>]*></script>', '', body).strip()

# แถบสำรองข้อมูล + คำเตือนว่าข้อมูลอยู่ในเบราว์เซอร์ — แทรกไว้บนสุด ก่อนแผงหน้างาน
body = body.replace('<section id="desk-sec"', '<div class="backup" id="backup"></div>\n\n<section id="desk-sec"', 1)

extra_css = """
/* ---- เฉพาะเวอร์ชัน static: แถบสำรองข้อมูล ---- */
.backup{margin-top:18px;background:var(--sunken);border:1px solid var(--line-strong);padding:12px 16px;
  display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.backup.stale{background:var(--loss-soft);border-color:var(--loss)}
.backup.stale b{color:var(--loss)}
.backup button{padding:6px 14px;font-size:13px}
"""

out = f"""<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bai+Jamjuree:wght@500;600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>{style}{extra_css}</style>
</head>
<body>
{body}

<script>
// ============================================================
//  ⚠️ ไฟล์นี้ถูก "ประกอบ" ขึ้นมา — ห้ามแก้ตรงนี้
//  ★ ใช้ <script> ธรรมดา ไม่ใช่ type="module" โดยตั้งใจ:
//    module ถูก CORS บล็อกเมื่อเปิดด้วย file:// → ดับเบิลคลิกไฟล์แล้วหน้าขาว
//    แบบนี้เปิดได้ทั้งจาก GitHub Pages และจากไฟล์บนเครื่องตรงๆ (ไม่ต้องมีเน็ต)
//     แก้ที่ src/analytics.js · src/parse.js · public/charts.js · public/app.js
//     · web/store.js · web/api-shim.js  แล้วรัน `bash web/build.sh`
// ============================================================

// ---------- src/analytics.js ----------
{analytics}

// ---------- src/parse.js ----------
{parse}

// ---------- public/charts.js ----------
{charts}

// ---------- web/store.js (แทน src/db.js) ----------
{store}

// ---------- web/api-shim.js (แทน src/server.js) ----------
{shim}

// ---------- public/app.js ----------
{app}
</script>
</body>
</html>
"""

pathlib.Path('docs').mkdir(exist_ok=True)
pathlib.Path('docs/index.html').write_text(out, encoding='utf-8')
kb = len(out.encode()) / 1024
print(f'✅ docs/index.html  {kb:.0f} KB')

# กันพลาด: ชื่อ top-level ที่ประกาศซ้ำจะทำให้ทั้งไฟล์ตายเงียบ (SyntaxError ตอนโหลด)
names = {}
for label, src in [('analytics', analytics), ('parse', parse), ('charts', charts),
                   ('store', store), ('shim', shim), ('app', app)]:
    for n in re.findall(r'^(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)', src, flags=re.M):
        names.setdefault(n, []).append(label)
dup = {n: w for n, w in names.items() if len(w) > 1}
if dup:
    print('⛔ ชื่อซ้ำ — ไฟล์นี้จะพังตอนโหลด:', dup)
    raise SystemExit(1)
print('✅ ไม่มีชื่อ top-level ซ้ำ')
PY
