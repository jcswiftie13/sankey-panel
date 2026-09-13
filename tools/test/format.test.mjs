/* 「何時在數字前面加 +」只能有一份定義（model/format.ts 的 fmtDelta）。
   原本 summary.ts 與 svg/cards.tsx 各自手刻了一次那個判斷，而且判斷的是 isIn／resIn(n)
   這個**布林**而不是數值本身，結果「其他輸入」帶 + 而「其他輸出」不帶，兩側不對稱。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, models, unescapeAttr } from './_cases.mjs';
import { fmtDelta, fmtRate, fmtAmount } from 'trace-sankey';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'packages/trace-sankey/src');
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

test('加號的判斷只出現在 model/format.ts', () => {
  const offenders = walk(SRC)
    .filter((p) => relative(SRC, p) !== join('model', 'format.ts'))
    .filter((p) => /'\+'|"\+"/.test(readFileSync(p, 'utf8')))
    .map((p) => relative(ROOT, p));
  assert.deepEqual(offenders, [], '這些檔案自己決定何時加 +，應該改呼叫 fmtDelta／fmtRate');
});

test('fmtDelta 看數值不看旗標：0 與負值不加號', () => {
  assert.equal(fmtDelta(0), fmtAmount(0, 'bps'), '0 不該帶 +（那不是「增加 0」）');
  assert.ok(fmtDelta(1e9).startsWith('+'));
  assert.ok(!fmtDelta(-1e9).startsWith('+'));
  /* bytes/s 是絕對速率，一律不帶號 */
  assert.ok(!fmtRate(1e6, 'bytesPerSec').startsWith('+'));
  assert.ok(fmtRate(1e9, 'bps').startsWith('+'));
});

/* 行為面：同一張圖上，兩側殘差標籤的帶號規則必須一致（以前「其他輸出」缺 +）。
   殘差標籤是 .res-label 的第二個 <text>，第一個是「其他輸入」／「其他輸出」那個詞。 */
const resLabels = (svg) => [...svg.matchAll(/其他(輸入|輸出)<\/text><text class="res-label"[^>]*>([^<]*)</g)]
  .map((m) => ({ side: m[1], text: unescapeAttr(m[2]) }));

test('bps 圖：兩側殘差標籤都帶 +', () => {
  let checked = 0;
  for (const { name, tag, model } of models) {
    for (const l of resLabels(api.render(model))) {
      assert.ok(l.text.startsWith('+'), `${name}${tag} 的「其他${l.side}」沒帶 +：${l.text}`);
      checked++;
    }
  }
  assert.ok(checked > 0, '語料裡沒有任何殘差標籤');
});

/* bytes/s 的殘差在內建語料裡測不到：參考 fixture 每個中間節點逐方向守恆（殘差 ≈ 0 不畫），
   被門檻濾光時那幾台整台被移除、也不會留下殘差色塊。所以用一份合成資料補這條分支——
   顯式給 other_out_bps，圖上就會有一塊 bytes/s 單位的殘差。 */
test('bytes/s 圖：殘差標籤一律不帶 +（絕對速率不是增量）', () => {
  const doc = {
    kind: 'destination',
    elements: {
      nodes: [
        /* 刻意不給 investigation：錨邊的 delta_bps 是 bps，會把這張圖變成混單位的，
           殘差就跑到 netapp-node 上並以 bps 印出來（實際踩過）。 */
        { data: { id: 'n1', type: 'netapp-node', name: 'ontap-1' } },
        { data: { id: 'a1', type: 'netapp-aggr', name: 'aggr1', other_out_bps: 5e6 } }
      ],
      edges: [
        { data: { id: 'e1', type: 'storage-flow', source: 'n1', target: 'a1',
          metrics: { read_bytes_per_sec: 4e6, write_bytes_per_sec: 2e6 } } }
      ]
    }
  };
  const m = api.build(doc, { minBps: 0 });
  assert.ok(m.ok, m.ok ? '' : m.errors.join(' / '));
  const labels = resLabels(api.render(m));
  assert.ok(labels.length > 0, '合成資料沒有畫出殘差色塊，這條測不到（檢查 other_out_bps 是否過了 resEps）');
  for (const l of labels) {
    assert.ok(/B\/s$/.test(l.text), `應該是 bytes/s 單位：${l.text}`);
    assert.ok(!l.text.startsWith('+'), `bytes/s 的「其他${l.side}」不該帶 +：${l.text}`);
  }
});
