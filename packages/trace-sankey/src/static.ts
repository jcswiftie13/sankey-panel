/* 字串渲染入口（Node／SSR／golden 用）：render(model) 回傳完整 SVG 字串，不碰 DOM。
   刻意獨立成子路徑 'trace-sankey/static'：這裡拉進 react-dom/server，它沒宣告
   sideEffects:false，放在主入口會被整包烤進使用端的 bundle。
   headless：帶子輸出原生 <title>，headless 產出的 .svg 才有 hover 資訊。 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TraceModelOk } from './model/types.js';
import { layout } from './layout/layout.js';
import { TraceSvg } from './svg/TraceSvg.js';

export const render = (model: TraceModelOk): string =>
  renderToStaticMarkup(createElement(TraceSvg, { model, geo: layout(model), headless: true }));

export { summary } from './summary.js';
export { flowTables } from './tables.js';
export { esc } from './layout/text.js';
