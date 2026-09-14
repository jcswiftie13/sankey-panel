/* 顏色的單一來源：src/layout/colors.ts。這幾條是「收斂完不准漂回去」的守門測試。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, models } from './_cases.mjs';
/* colors.ts 不在套件的 exports 裡（是內部單一來源），所以走相對路徑讀 dist */
import { COLORS } from '../../packages/trace-sankey/dist/layout/colors.js';
import { generated } from '../../packages/trace-sankey/scripts/gen-css.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'packages/trace-sankey/src');
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

/* 這條是整個收斂的核心不變量：色值只能有一個出處。
   註解裡的色值也算：寫在別處的「這個色值為什麼不行」也是一份會漂移的抄本，
   理由要帶色值就連同註解一起住在 colors.ts。 */
test('套件 src 裡的十六進位色值只出現在 layout/colors.ts', () => {
  const offenders = [];
  for (const p of walk(SRC)) {
    if (relative(SRC, p) === join('layout', 'colors.ts')) continue;
    const hits = (readFileSync(p, 'utf8').match(HEX) || []);
    if (hits.length) offenders.push(relative(ROOT, p) + ': ' + [...new Set(hits)].join(' '));
  }
  assert.deepEqual(offenders, [], '這些檔案自己寫了色值，應該改讀 layout/colors.ts 的 COLORS');
});

/* 產物要 commit，所以「忘了跑 gen:css」必須被抓到——否則 CSS 會安靜地停在舊配色 */
test('styles/ 的色票區塊與 colors.ts 同步（忘了跑 gen:css 會失敗）', () => {
  for (const [path, want] of Object.entries(generated())) {
    assert.equal(readFileSync(path, 'utf8'), want,
      relative(ROOT, path) + ' 與 colors.ts 不同步：npm run gen:css -w trace-sankey');
  }
});

/* 使用端抄一份色票是原本漂移的來源（圖例的 write 漸層要手動對齊 Defs 的兩個 stop）。
   app 自己一次性的顏色（輸入框底、按鈕底）不在這條的管轄內——它們沒有第二份。 */
test('app.css 沒有再抄一份套件的色票', () => {
  const css = readFileSync(join(ROOT, 'app/src/app.css'), 'utf8');
  const dup = Object.entries(COLORS).filter(([, v]) => css.toLowerCase().includes(v.toLowerCase()));
  assert.deepEqual(dup.map(([k]) => k), [], 'app.css 直接寫了套件的色值，應該改用 tokens.css 的 var()');
  const app = readFileSync(join(ROOT, 'app/src/App.jsx'), 'utf8');
  assert.match(app, /trace-sankey\/tokens\.css/, 'App.jsx 沒有 import tokens.css，那些 var() 會解析不到');
});

/* headless 的 SVG 字串不掛任何 CSS：顏色一旦寫成 var(--x)，單獨嵌用那份 SVG
   （存成圖檔、貼進不含樣式表的頁面）會整片變黑。這條擋的就是「順手把 SVG 改吃 CSS 變數」。 */
test('render() 產出的 SVG 不依賴 CSS 變數上色', () => {
  for (const { name, tag, model } of models) {
    const svg = api.render(model);
    assert.ok(!/(?:fill|stroke|stop-color)="var\(/.test(svg),
      name + tag + '：SVG 用 var() 上色，headless 輸出會失去顏色');
  }
});
