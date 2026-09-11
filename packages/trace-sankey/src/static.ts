/* 字串渲染入口（Node／SSR／golden 用）：render(model) 回傳完整 SVG 字串，不碰 DOM。
   刻意獨立成子路徑 'trace-sankey/static'：渲染層改成 React 元件之後這裡會拉進
   react-dom/server，它沒宣告 sideEffects:false，放在主入口會被整包烤進使用端的 bundle。 */
export { render, summary, esc } from './render.js';
