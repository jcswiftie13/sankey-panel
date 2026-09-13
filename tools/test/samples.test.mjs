/* 範例資料的單一來源。samples/*.json 與 src/samples.ts 是同一批資料的兩份表示：
   - storage 那筆：samples/storage.json 是唯一來源（原封不動取自參考 repo，只能當來源），
     由 scripts/gen-samples.mjs 產生成 src/samples.storage.ts。以前 samples.ts 裡手抄了一份
     425 行的同樣資料，註解寫著「改一邊記得改另一邊」。
   - 其餘 10 筆：samples.ts 的 N()／E() 簡寫是可讀的作者形式（產生的 JSON 反而看不懂），
     所以刻意**不**做 codegen，改用下面這條斷言守著兩邊一致。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { list, byKey } from 'trace-sankey/samples';
import { generated, OUT } from '../../packages/trace-sankey/scripts/gen-samples.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('samples/*.json 與 src/samples.ts 的每一筆完全相同', () => {
  /* 先去掉副檔名再排序：帶著 .json 排會把 k8s-source 排到 k8s 前面（'-' < '.'），
     與直接排 key 的順序不同，deepEqual 會誤報成「集合不同」（踩過一次）。 */
  const files = readdirSync(join(ROOT, 'samples'))
    .filter((f) => f.endsWith('.json')).map((f) => basename(f, '.json')).sort();
  const keys = list.map((s) => s.key).sort();
  assert.deepEqual(files, keys,
    'samples/ 的檔名集合與 samples.ts 的 key 集合不同——多的那一邊沒有被 golden 的另一個系列跑到');
  for (const key of files) {
    const disk = JSON.parse(readFileSync(join(ROOT, 'samples', key + '.json'), 'utf8'));
    assert.deepEqual(byKey[key].json, disk, key + '：兩邊的資料已經漂移（改一邊忘了另一邊）');
  }
});

test('src/samples.storage.ts 與 samples/storage.json 同步（忘了跑 gen:samples 會失敗）', () => {
  assert.equal(readFileSync(OUT, 'utf8'), generated(),
    'samples.storage.ts 與來源不同步：npm run gen:samples -w trace-sankey');
});
