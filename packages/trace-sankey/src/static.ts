/* 字串渲染入口（Node／SSR／golden 用）：render(model) 回傳完整 SVG 字串，不碰 DOM。
   刻意獨立成子路徑 'trace-sankey/static'：這裡拉進 react-dom/server，它沒宣告
   sideEffects:false，放在主入口會被整包烤進使用端的 bundle。
   headless：帶子輸出原生 <title>，headless 產出的 .svg 才有 hover 資訊。

   geo 可以從外面傳進來（形狀刻意與 flowTables(model, geo) 一致）：同一份 model 要同時產
   SVG 與三張表時算一次就好，圖與表保證出自同一份版面。**版面選項一律只掛 layout()**——
   render／flowTables 不各自複製一份選項參數，否則加一個版面選項就得兩邊各穿一次，
   漏一邊會變成「圖照新選項畫、表照預設排」，而且不會有任何錯誤。
   layout 一併從這個子路徑 re-export：要傳 geo 的人不必為了一個函式去 import 主入口。 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TraceModelOk } from './model/types.js';
import type { Geometry } from './layout/geometry.js';
import { layout } from './layout/layout.js';
import { TraceSvg } from './svg/TraceSvg.js';

export const render = (model: TraceModelOk, geo: Geometry = layout(model)): string =>
  renderToStaticMarkup(createElement(TraceSvg, { model, geo, headless: true }));

export { layout } from './layout/layout.js';
export { summary } from './summary.js';
export { flowTables } from './tables.js';
export { esc } from './layout/text.js';
