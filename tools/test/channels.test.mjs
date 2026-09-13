/* 「圖上有哪些通道」的單一來源。原本這個判定在四處各寫一次、粒度還不一樣：
   layout/tips.ts（逐節點）、tables.ts（全圖）、svg/Defs.tsx（只問有沒有 write）、
   app/src/App.jsx（只問有沒有任何通道）。最後一個因此會在只有 read 的資料上
   印出 write 圖例——宣稱存在一種圖上根本沒有的通道。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, models } from './_cases.mjs';
import { channelsIn } from 'trace-sankey';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('channelsIn 照 read、write 固定順序，忽略沒有通道的邊', () => {
  assert.deepEqual(channelsIn([]), []);
  assert.deepEqual(channelsIn([{ channel: null }, { channel: null }]), []);
  assert.deepEqual(channelsIn([{ channel: 'write' }, { channel: 'read' }]), ['read', 'write']);
  assert.deepEqual(channelsIn([{ channel: 'write' }, { channel: null }]), ['write']);
  assert.deepEqual(channelsIn([{ channel: 'read' }, { channel: 'read' }]), ['read']);
});

/* 這條是把「model 層的判定」與「SVG 實際畫了什麼」綁在一起：Defs 只在有 write 帶時才輸出
   gband-w 漸層，所以 channelsIn 說有 write 就必須看得到那個 id，反之也必須看不到。
   任何一邊改了粒度（例如又有人寫成 edges.some(e => e.channel)）這條就會炸。 */
test('channelsIn 的 write 判定與 SVG 的 gband-w 漸層一致', () => {
  let withWrite = 0, without = 0;
  for (const { name, tag, model } of models) {
    const svg = api.render(model);
    const hasGrad = svg.includes('id="gband-w"');
    const hasWrite = channelsIn(model.edges).includes('write');
    assert.equal(hasGrad, hasWrite, name + tag + '：gband-w 漸層與 channelsIn 不一致');
    if (hasWrite) withWrite++; else without++;
  }
  /* 兩種情況都要真的出現過，否則這條斷言只是在測一個常數 */
  assert.ok(withWrite > 0, '語料裡沒有任何有 write 帶的範例');
  assert.ok(without > 0, '語料裡沒有任何沒有 write 帶的範例');
});

/* app 的圖例曾經自己 model.edges.some(e => e.channel) 判一次，粒度比 Defs 粗。
   app 是 JSX、Node 不能直接 import，所以這條用原始碼斷言守著。 */
test('app 的圖例走套件的 channelsIn，沒有自己再判一次通道', () => {
  const app = readFileSync(join(ROOT, 'app/src/App.jsx'), 'utf8');
  assert.match(app, /channelsIn/, 'App.jsx 沒有用 channelsIn');
  assert.doesNotMatch(app, /edges\.some\(\s*e\s*=>\s*e\.channel\s*\)/,
    'App.jsx 又自己判了一次「有沒有任何通道」——那會在只有單一通道的資料上印錯圖例');
});
