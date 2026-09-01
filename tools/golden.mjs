/* golden 對拍工具：把所有範例（內建 samples ＋ samples/*.json ＋ stress/*.json）
   的 render()/summary() 輸出逐字 dump 成檔案，重構前後 diff -r 比對，要求逐 byte 相同。
   門檻（minBps）除 0 之外另跑一組 5e8，鎖住過濾路徑的行為。

   用法：
     node tools/golden.mjs --legacy dump <outDir>   # 從舊版 assets/js（IIFE 全域）載入
     node tools/golden.mjs dump <outDir>            # 從 packages/trace-sankey/src（ESM）載入
     diff -r <before> <after>

   --legacy 模式只在遷移前的 commit 有效（assets/js 移除後就沒得載了）；
   留著是為了讓 git 歷史記錄 baseline 是怎麼產生的。 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIN_BPS = [0, 5e8];

function loadLegacy() {
  /* IIFE 檔案尾端 })(window)：給 sandbox 一個指向自己的 window 即可 */
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['samples.js', 'model.js', 'render.js']) {
    vm.runInContext(readFileSync(join(ROOT, 'assets/js', f), 'utf8'), sandbox, { filename: f });
  }
  return {
    build: sandbox.TraceModel.build,
    render: sandbox.TraceRender.render,
    summary: sandbox.TraceRender.summary,
    samples: sandbox.TraceSamples.list,
  };
}

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

async function main() {
  const args = process.argv.slice(2);
  const legacy = args[0] === '--legacy';
  if (legacy) args.shift();
  const [cmd, outDir] = args;
  if (cmd !== 'dump' || !outDir) {
    console.error('usage: node tools/golden.mjs [--legacy] dump <outDir>');
    process.exit(2);
  }
  const api = legacy ? loadLegacy() : await loadEsm();
  mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const { name, doc } of inputs(api.samples)) {
    for (const min of MIN_BPS) {
      const tag = name + '.min' + min;
      const model = api.build(doc, { minBps: min });
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

main().catch((e) => { console.error(e); process.exit(1); });
