/* 由 src/layout/colors.ts 產生兩個樣式表的色票區塊。改色只改 colors.ts，然後：
     npm run gen:css -w trace-sankey        （會先 build，因為這支讀 dist/）
   產物要 commit（使用端拿到的是檔案，不會在他們那邊跑 codegen）。
   tools/test/colors.test.mjs 會斷言「重新產生的內容與磁碟上的一致」，所以忘了跑會被抓到。

   為什麼是 TS → CSS 而不是反過來：SVG 屬性必須是字面色值（render() 產的字串不掛 CSS，
   見 colors.ts 檔頭），所以 TS 那邊非有不可；CSS 這邊則可以由它推導。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLORS, CSS_COLOR_KEYS, cssVarName } from '../dist/layout/colors.js';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const START = '/* gen:colors start';
const END = 'gen:colors end */';

const lines = (indent) => CSS_COLOR_KEYS
  .map((k) => indent + cssVarName(k) + ': ' + COLORS[k] + ';')
  .join('\n');

/** 把檔案裡 gen:colors 標記之間的內容換成產生的變數 */
const splice = (text, indent) => {
  const i = text.indexOf(START), j = text.indexOf(END);
  if (i < 0 || j < 0) throw new Error('找不到 gen:colors 標記');
  return text.slice(0, i)
    + START + ' — 由 src/layout/colors.ts 產生，不要手改（npm run gen:css -w trace-sankey） */\n'
    + lines(indent) + '\n' + indent + '/* ' + END
    + text.slice(j + END.length);
};

/** 兩個產物的完整內容（測試也用這兩支，不重複實作） */
export const generated = () => {
  const main = join(PKG, 'styles/trace-sankey.css');
  return {
    [main]: splice(readFileSync(main, 'utf8'), '  '),
    [join(PKG, 'styles/tokens.css')]:
      '/* 使用端可以選用的色票：與圖同一份色值（由 src/layout/colors.ts 產生，不要手改）。\n'
      + '   為什麼另外開一支 :root scope 的檔案——套件的主樣式表刻意把變數 scope 在 .trace-sankey 底下、\n'
      + '   不污染宿主的全域。但使用端的圖例、工具列這些元素通常是 <TraceSankey> 的**兄弟**，\n'
      + '   吃不到那個子樹裡的變數。想讓自己的 UI 跟圖同色就 import 這支（純變數、不含任何規則）：\n'
      + "     import 'trace-sankey/tokens.css';\n"
      + '   不 import 也完全不影響圖。 */\n'
      + ':root {\n' + lines('  ') + '\n}\n'
  };
};

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  for (const [path, text] of Object.entries(generated())) {
    writeFileSync(path, text);
    console.log('寫入 ' + path.replace(PKG + '/', ''));
  }
}
