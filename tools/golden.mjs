/* golden 對拍工具：把所有範例（內建 samples ＋ samples/*.json ＋ stress/*.json）
   的 build()/render()/summary() 輸出 dump 成檔案，重構前後對拍。

   兩種嚴格度，對應兩層不同的重構風險：
     - model.json／warnings.json／summary.html／errors.json：逐 byte 相同（diff -r 或 cmp）。
       model 拆檔、語法現代化都不該動到任何一個鍵、任何一段警告文字。
     - svg：走 `cmp` 的語意等價——渲染層從手拼字串換成 React 元件之後，屬性順序、
       自閉合寫法、實體轉義（&#39; 與 &#x27;）、數值尾零都會不同，但那些不是版面差異。
       正規化後逐行相同才算過；正規化只做「明知無害」的那幾件事（見 normalizeSvg），
       文字內容（帶上的量字、卡片標題）一個字都不放過。

   門檻（minBps）除 0 之外另跑一組 5e8，鎖住過濾路徑的行為；圖上有 read／write 通道的範例
   另跑一組 channels:'read'（只有 storage 資料會多出這組檔案，switch 資料的檔案集合不變）。

   用法：
     node tools/golden.mjs dump <outDir>         # dump 所有輸出（model.json 在 render 之前寫）
     node tools/golden.mjs cmp <before> <after>  # svg 語意等價、其餘逐 byte；任何差異 exit 1
     node tools/golden.mjs norm <dir> <outDir>   # 把 <dir> 的 svg 寫成正規化版本，方便自己 diff -r
     node tools/golden.mjs selftest              # 正規化器自己的等價／不等價案例
     node tools/golden.mjs check                 # 所有範例 build 都要 ok、render 不炸、不印 console.error（make check） */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIN_BPS = [0, 5e8];

/* 走套件名（root node_modules/trace-sankey 是 workspace symlink）而不是檔案路徑：
   Node 不認 exports 的 development 條件，所以拿到的是 dist/——跟外部使用者裝到的東西
   同一份。所以要先 npm run build -w trace-sankey（make check／golden 會先做）。 */
async function loadEsm() {
  const [core, stat, samples] = await Promise.all([import('trace-sankey'), import('trace-sankey/static'), import('trace-sankey/samples')]);
  return { build: core.build, render: stat.render, summary: stat.summary, samples: samples.list };
}

function inputs(samples) {
  const docs = [];
  for (const s of samples) docs.push({ name: 'sample-' + s.key, doc: s.json });
  for (const dir of ['samples', 'stress']) {
    for (const f of readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.json')).sort()) {
      docs.push({ name: dir + '-' + basename(f, '.json'), doc: JSON.parse(readFileSync(join(ROOT, dir, f), 'utf8')) });
    }
  }
  return docs;
}

function variants(api, doc) {
  const out = [];
  for (const min of MIN_BPS) out.push({ tag: '.min' + min, opts: { minBps: min } });
  const m = api.build(doc, { minBps: 0 });
  if (m.ok && m.edges.some((e) => e.channel)) out.push({ tag: '.read', opts: { channels: 'read' } });
  return out;
}

/* build() 的輸出序列化：nodeMap 與 nodes 是同一批物件（丟掉）；inEdges／outEdges／nsEdge／
   root／anchorEdge 都指向 edges／nodes 裡已經有的物件（換成 id）。其餘鍵原樣、依插入序——
   這份就是「model 沒被動到」的證據，鍵序變了也算變。 */
function modelJson(m) {
  return JSON.stringify(m, (k, v) => {
    if (k === 'nodeMap') return undefined;
    if (k === 'inEdges' || k === 'outEdges') return v.map((e) => e.id);
    if (k === 'nsEdge' || k === 'root' || k === 'anchorEdge') return v ? v.id : v;
    return v;
  }, 1) + '\n';
}

async function dump(api, outDir) {
  mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const { name, doc } of inputs(api.samples)) {
    for (const v of variants(api, doc)) {
      const tag = name + v.tag;
      const model = api.build(doc, v.opts);
      if (!model.ok) {
        writeFileSync(join(outDir, tag + '.errors.json'), JSON.stringify(model.errors, null, 2) + '\n');
        continue;
      }
      /* 一定要在 render() 之前寫：字串版 render 的 layout() 會把版面欄位寫進 model */
      writeFileSync(join(outDir, tag + '.model.json'), modelJson(model));
      writeFileSync(join(outDir, tag + '.svg'), api.render(model));
      writeFileSync(join(outDir, tag + '.summary.html'), api.summary(model));
      writeFileSync(join(outDir, tag + '.warnings.json'), JSON.stringify(model.warnings, null, 2) + '\n');
      n += 4;
    }
  }
  console.log('dumped ' + n + ' files to ' + outDir);
}

/* ---------- SVG 正規化 ---------- */
/* 手寫 tokenizer 而不是拉 XML parser：repo 零依賴，而且我們產的 SVG 是自己拼的、形狀單純
   （沒有 CDATA、沒有 processing instruction、屬性一律雙引號）。 */
const TOKEN = /<!--[\s\S]*?-->|<\/?([A-Za-z][\w:-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([\w:-]+)(?:="([^"]*)")?/g;
/* 只有這些屬性的值被當數字四捨五入。顏色（#0e7490 會被數字正則誤判成指數）、id、class、
   文字內容一律不動。 */
const NUM_ATTRS = new Set(['d', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r',
  'viewBox', 'stroke-width', 'offset', 'stroke-opacity', 'stop-opacity', 'fill-opacity', 'stroke-dasharray']);
const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi;
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const round3 = (s) => s.replace(NUM, (n) => String(Number(Number(n).toFixed(3))));   /* 去尾零、-0 → 0 */
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITY[e.toLowerCase()] ?? m;
  });
}
function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeysDeep(v[k]);
    return o;
  }
  return v;
}
function normAttr(name, raw) {
  const v = decode(raw);
  if (name === 'data-tip') return JSON.stringify(sortKeysDeep(JSON.parse(v)));
  if (name === 'style') return v.split(';').map((s) => s.trim().replace(/\s*:\s*/, ':')).filter(Boolean).sort().join(';');
  if (name === 'class') return v.trim().split(/\s+/).sort().join(' ');
  return NUM_ATTRS.has(name) ? round3(v) : v;
}
function normalizeSvg(markup) {
  const out = [];
  for (const m of markup.matchAll(TOKEN)) {
    if (m[0].startsWith('<!--')) continue;
    if (m[4] != null) {
      const t = decode(m[4]);
      if (t.trim()) out.push(JSON.stringify(['text', t]));
      continue;
    }
    if (m[0].startsWith('</')) { out.push(JSON.stringify(['close', m[1]])); continue; }
    const attrs = [...m[2].matchAll(ATTR)].map((a) => [a[1], normAttr(a[1], a[2] ?? '')])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    out.push(JSON.stringify(['open', m[1], attrs]));
    if (m[3]) out.push(JSON.stringify(['close', m[1]]));   /* <path/> ≡ <path></path> */
  }
  return out.join('\n') + '\n';
}

function norm(inDir, outDir) {
  mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const f of readdirSync(inDir).sort()) {
    const s = readFileSync(join(inDir, f), 'utf8');
    writeFileSync(join(outDir, f), f.endsWith('.svg') ? normalizeSvg(s) : s);
    n++;
  }
  console.log('normalized ' + n + ' files to ' + outDir);
}

/* svg 正規化後逐行比、其餘檔逐 byte；缺檔與多檔都算差異。每檔最多印前 3 行差異。 */
function cmp(dirA, dirB) {
  const A = new Set(readdirSync(dirA)), B = new Set(readdirSync(dirB));
  let bad = 0;
  for (const f of [...A].filter((f) => !B.has(f)).sort()) { bad++; console.error('只在 ' + dirA + '：' + f); }
  for (const f of [...B].filter((f) => !A.has(f)).sort()) { bad++; console.error('只在 ' + dirB + '：' + f); }
  for (const f of [...A].filter((f) => B.has(f)).sort()) {
    let a = readFileSync(join(dirA, f), 'utf8'), b = readFileSync(join(dirB, f), 'utf8');
    if (f.endsWith('.svg')) { a = normalizeSvg(a); b = normalizeSvg(b); }
    if (a === b) continue;
    bad++;
    const la = a.split('\n'), lb = b.split('\n');
    let shown = 0;
    for (let i = 0; i < Math.max(la.length, lb.length) && shown < 3; i++) {
      if (la[i] === lb[i]) continue;
      shown++;
      console.error(f + ':' + (i + 1) + '\n  - ' + (la[i] ?? '<缺>').slice(0, 300) + '\n  + ' + (lb[i] ?? '<缺>').slice(0, 300));
    }
  }
  if (bad) { console.error(bad + ' 個檔案有差異。'); process.exit(1); }
  console.log('兩邊等價（' + A.size + ' 個檔案）。');
}

/* 正規化器的自我測試：左右兩邊必須等價的，以及必須抓出差異的 */
function selftest() {
  const same = [
    ['<path d="M1.0,2 L3,4"/>', '<path d="M1,2.0000001 L3,4"></path>'],
    ['<g class="b a" data-tip="{&quot;x&quot;:1,&quot;y&quot;:[2]}"><title>a&#39;b</title></g>',
     '<g data-tip="{&quot;y&quot;:[2],&quot;x&quot;:1}" class="a b"><title>a&#x27;b</title></g>'],
    ['<text style="paint-order:stroke;stroke:#0b1017">+8 Gbps</text>', '<text style="stroke:#0b1017;paint-order:stroke">+8 Gbps</text>'],
    ['<stop offset="0" stop-color="#0e7490" stop-opacity=".85"/>', '<stop stop-opacity="0.85" stop-color="#0e7490" offset="0"></stop>'],
    ['<svg><!-- c --><g>\n</g></svg>', '<svg><g></g></svg>'],
  ];
  const diff = [
    ['<text>+8 Gbps</text>', '<text>+8.0 Gbps</text>'],
    ['<path d="M1,2"/>', '<path d="M1,2.001"/>'],
    ['<stop stop-color="#0e7490"/>', '<stop stop-color="#0e7491"/>'],
    ['<g><path/></g>', '<g><path/><path/></g>'],
    ['<path data-tip="{&quot;a&quot;:1}"/>', '<path data-tip="{&quot;a&quot;:2}"/>'],
  ];
  let fail = 0;
  same.forEach(([a, b], i) => { if (normalizeSvg(a) !== normalizeSvg(b)) { fail++; console.error('same[' + i + '] 被判成不同'); } });
  diff.forEach(([a, b], i) => { if (normalizeSvg(a) === normalizeSvg(b)) { fail++; console.error('diff[' + i + '] 被判成相同'); } });
  if (fail) { console.error(fail + ' 個 selftest 失敗。'); process.exit(1); }
  console.log('selftest 通過（' + (same.length + diff.length) + ' 組）。');
}

/* 迴歸哨兵：每份範例在每個變體下都要 build 成功且 render 不炸。
   期間任何 console.error 也算失敗——React 的 key 重複／非法 prop 警告只會印、不會 throw。 */
function check(api) {
  let fail = 0, total = 0;
  const origErr = console.error;
  for (const { name, doc } of inputs(api.samples)) {
    for (const v of variants(api, doc)) {
      total++;
      const model = api.build(doc, v.opts);
      if (!model.ok) { fail++; origErr('FAIL ' + name + v.tag + ': ' + model.errors.join(' / ')); continue; }
      const logged = [];
      console.error = (...a) => logged.push(a.map(String).join(' '));
      try { api.render(model); api.summary(model); }
      catch (e) { fail++; origErr('FAIL ' + name + v.tag + ': render threw ' + e.message); }
      console.error = origErr;
      if (logged.length) { fail++; origErr('FAIL ' + name + v.tag + ': console.error 被呼叫 ' + logged.length + ' 次：' + logged[0].slice(0, 300)); }
    }
  }
  if (fail) { origErr(fail + ' / ' + total + ' 失敗。'); process.exit(1); }
  console.log('所有範例都通過（' + total + ' 組）。');
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'selftest') return selftest();
  if (cmd === 'cmp' && a && b && existsSync(a) && existsSync(b)) return cmp(a, b);
  if (cmd === 'norm' && a && b && existsSync(a)) return norm(a, b);
  const api = await loadEsm();
  if (cmd === 'dump' && a) return dump(api, a);
  if (cmd === 'check') return check(api);
  console.error('usage: node tools/golden.mjs dump <outDir> | cmp <before> <after> | norm <dir> <outDir> | selftest | check');
  process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
