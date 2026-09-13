/* tools/test 的共用語料：所有範例 × golden 的所有變體。

   刻意從 golden.mjs import inputs／variants／loadEsm，而不是自己再列一次變體：
   「有哪些變體要測」只能有一份定義，測試再抄一份就是這次要收斂掉的那種病。
   跑之前要先 npm run build -w trace-sankey（make test 會先做）。 */
import { loadEsm, inputs, variants } from '../golden.mjs';

export const api = await loadEsm();

/** [{ name, doc, tag, opts }]——name+tag 就是 golden 的檔名前綴，失敗訊息對得上 dump */
export const cases = [];
for (const { name, doc } of inputs(api.samples)) {
  for (const v of variants(api, doc)) cases.push({ name, doc, tag: v.tag, opts: v.opts });
}

/** 只保留 build 成功的（少數變體會被門檻濾成 error，那是既有行為） */
export const models = cases.map((c) => ({ ...c, model: api.build(c.doc, c.opts) }))
  .filter((c) => c.model.ok);

/** SVG 屬性裡的實體還原（React 會把 " 轉成 &quot;） */
export const unescapeAttr = (s) => s
  .replace(/&quot;/g, '"').replace(/&#x27;/gi, "'").replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
