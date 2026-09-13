/* 「同一份清單散在兩個檔案」的守門測試。這幾組是**刻意不收斂**的（語意不同、
   或收斂的代價比漂移的代價高，理由見 CLAUDE.md），所以改成用斷言抓漂移。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, models, unescapeAttr } from './_cases.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (p) => readFileSync(join(ROOT, 'packages/trace-sankey/src', p), 'utf8');
const arrayLiteral = (text, name) => {
  const m = new RegExp('export const ' + name + '\\s*(?::[^=]*)?=\\s*\\[([^\\]]*)\\]').exec(text);
  assert.ok(m, name + ' 的宣告找不到了（測試要跟著改）');
  return m[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
};

/* DEVICE_TYPES（layout/constants.ts，虛線邊框的視覺清單）與 HOP_TYPES（model/classify.ts，
   畫成盒子的結構清單）是兩個不同的問題，不該合併成一份。但設備一定是 hop——
   新增一個 hop 型別時，這條會迫使人想一次「它要不要也算設備」。 */
test('DEVICE_TYPES ⊆ HOP_TYPES', () => {
  const dev = arrayLiteral(src('layout/constants.ts'), 'DEVICE_TYPES');
  const hop = arrayLiteral(src('model/classify.ts'), 'HOP_TYPES');
  assert.ok(dev.length > 0 && hop.length > 0);
  for (const t of dev) assert.ok(hop.includes(t), 'DEVICE_TYPES 的 ' + t + ' 不在 HOP_TYPES 裡');
});

/* bandMeta（layout/tips.ts，序列化進 data-tip）與 BandTip（tooltip/tips.tsx，渲染成畫面）
   刻意各自一份：前者要精簡穩定（沒有值的鍵完全不出現，golden 才逐 byte 可比），
   後者要中文標籤與條件排版。代價是「加新鍵要兩處一起改」——這條就是抓那件事的。
   鍵不是從原始碼讀的，是從所有範例實際產生的 data-tip 收集來的。
   已知限制（實測過）：它抓得到「bandMeta 加了新鍵但 BandTip 沒有對應的列」，
   抓不到「把某一列刪掉、但同一行還留著那個鍵的其他引用」——後者只能靠 golden 的
   瀏覽器實測。這條守的是最常見的那個方向（加鍵時漏改），不是全部。 */
test('bandMeta 實際產生的每個鍵都在 BandTip 裡被讀到', () => {
  const tip = src('tooltip/tips.tsx');
  const bandKeys = new Set(), extraKeys = new Set();
  for (const { model } of models) {
    const svg = api.render(model);
    for (const m of svg.matchAll(/data-tip="([^"]*)"/g)) {
      const d = JSON.parse(unescapeAttr(m[1]));
      if (d.node) continue;                       /* 卡片的 tooltip 走 rows，不是明確列鍵 */
      for (const k of Object.keys(d)) bandKeys.add(k);
      for (const k of Object.keys(d.extra || {})) extraKeys.add(k);
    }
  }
  assert.ok(bandKeys.size > 5, '沒收集到 data-tip，render 或選擇器變了');
  for (const k of bandKeys) {
    if (k === 'extra') continue;                  /* extra 的內容在下面逐鍵檢查 */
    assert.ok(tip.includes('d.' + k), 'bandMeta 的鍵 ' + k + ' 在 BandTip 裡沒有對應的列');
  }
  for (const k of extraKeys) {
    assert.ok(tip.includes('x.' + k), 'metrics 的 extra 鍵 ' + k + ' 在 BandTip 裡沒有對應的列');
  }
});
