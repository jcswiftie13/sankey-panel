/* golden 對拍工具：把所有範例（內建 samples ＋ samples/*.json ＋ stress/*.json）
   的 render()/summary() 輸出逐字 dump 成檔案，重構前後 diff -r 比對，要求逐 byte 相同。
   門檻（minBps）除 0 之外另跑一組 5e8，鎖住過濾路徑的行為；圖上有 read／write 通道的範例
   另跑一組 channels:'read'（只有 storage 資料會多出這組檔案，switch 資料的檔案集合不變）。

   用法：
     node tools/golden.mjs dump <outDir>    # dump 所有輸出
     node tools/golden.mjs check            # 所有範例 build 都要 ok（make check）
     diff -r <before> <after> */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIN_BPS = [0, 5e8];

async function loadEsm() {
  const src = (f) => import(join(ROOT, 'packages/trace-sankey/src', f));
  const [model, render, samples] = await Promise.all([src('model.js'), src('render.js'), src('samples.js')]);
  return { build: model.build, render: render.render, summary: render.summary, samples: samples.list };
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
      writeFileSync(join(outDir, tag + '.svg'), api.render(model));
      writeFileSync(join(outDir, tag + '.summary.html'), api.summary(model));
      writeFileSync(join(outDir, tag + '.warnings.json'), JSON.stringify(model.warnings, null, 2) + '\n');
      n += 3;
    }
  }
  console.log('dumped ' + n + ' files to ' + outDir);
}

/* 迴歸哨兵：每份範例在每個變體下都要 build 成功且 render 不炸 */
function check(api) {
  let fail = 0, total = 0;
  for (const { name, doc } of inputs(api.samples)) {
    for (const v of variants(api, doc)) {
      total++;
      const model = api.build(doc, v.opts);
      if (!model.ok) { fail++; console.error('FAIL ' + name + v.tag + ': ' + model.errors.join(' / ')); continue; }
      try { api.render(model); api.summary(model); }
      catch (e) { fail++; console.error('FAIL ' + name + v.tag + ': render threw ' + e.message); }
    }
  }
  if (fail) { console.error(fail + ' / ' + total + ' 失敗。'); process.exit(1); }
  console.log('所有範例都通過（' + total + ' 組）。');
}

async function main() {
  const [cmd, outDir] = process.argv.slice(2);
  const api = await loadEsm();
  if (cmd === 'dump' && outDir) return dump(api, outDir);
  if (cmd === 'check') return check(api);
  console.error('usage: node tools/golden.mjs dump <outDir> | check');
  process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
