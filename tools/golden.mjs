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
  return { build: model.build, render: render.render, summary: render.summary, flowTables: render.flowTables, samples: samples.list };
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
  /* 有 pod-node 邊的範例另跑 layout:'node'（k8s node 外框）；flat 的檔案集合不變 */
  const hasPodNode = doc.elements.edges.some((e) => e.data && e.data.labels && e.data.labels.tier === 'pod-node');
  if (m.ok && hasPodNode) out.push({ tag: '.node', opts: { layout: 'node' } });
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
      writeFileSync(join(outDir, tag + '.tables.html'), api.flowTables(model).html);
      writeFileSync(join(outDir, tag + '.warnings.json'), JSON.stringify(model.warnings, null, 2) + '\n');
      n += 3;
    }
  }
  console.log('dumped ' + n + ' files to ' + outDir);
}

/* 遞迴凍結：build() 只能讀不能寫 doc（參考 spec 同樣要求 derivation 不得 mutate）。
   凍結後任何寫入在 strict mode 下直接拋錯，比 diff 前後 JSON 更早抓到。 */
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/* 頂層 investigation 已 deprecated 但仍接受：把節點形式的起點程式化搬回頂層，render 輸出
   必須逐 byte 相同。不留舊形式的範例，兩條路徑共用同一批資料才不會漂移。 */
function legacyTopLevel(doc) {
  const root = doc.elements.nodes.find((nd) => nd.data.investigation);
  if (!root) return null;
  const inv = { node_id: root.data.id, ...root.data.investigation };
  const nodes = doc.elements.nodes.map((nd) => {
    if (nd !== root) return nd;
    const { investigation, ...rest } = nd.data;
    return { ...nd, data: rest };
  });
  return { ...doc, investigation: inv, elements: { ...doc.elements, nodes } };
}

/* 迴歸哨兵：每份範例在每個變體下都要 build 成功且 render 不炸、且不改動輸入 */
function check(api) {
  let fail = 0, total = 0;
  for (const { name, doc } of inputs(api.samples)) {
    deepFreeze(doc);
    const legacy = legacyTopLevel(doc);
    for (const v of variants(api, doc)) {
      total++;
      let model;
      try { model = api.build(doc, v.opts); }
      catch (e) { fail++; console.error('FAIL ' + name + v.tag + ': build threw（可能改動了輸入 doc）' + e.message); continue; }
      if (!model.ok) { fail++; console.error('FAIL ' + name + v.tag + ': ' + model.errors.join(' / ')); continue; }
      let svg;
      try { svg = api.render(model); api.summary(model); api.flowTables(model); }
      catch (e) { fail++; console.error('FAIL ' + name + v.tag + ': render threw ' + e.message); continue; }
      if (legacy) {
        const lm = api.build(legacy, v.opts);
        if (!lm.ok) { fail++; console.error('FAIL ' + name + v.tag + ' (頂層 investigation): ' + lm.errors.join(' / ')); continue; }
        if (api.render(lm) !== svg) { fail++; console.error('FAIL ' + name + v.tag + ': 頂層 investigation 的輸出與節點形式不同'); continue; }
        if (!lm.warnings.some((w) => w.indexOf('deprecated') >= 0)) {
          fail++; console.error('FAIL ' + name + v.tag + ': 頂層 investigation 沒有 deprecated 警告');
        }
      }
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
