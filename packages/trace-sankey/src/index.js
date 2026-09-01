/* trace-sankey 主入口。
   build/validate/render/summary 是純函式（Node 也能跑，SSR 安全）；
   mount/createZoom 需要瀏覽器 DOM。範例資料走子路徑 'trace-sankey/samples'，
   React 元件走 'trace-sankey/react'。 */
export { build, validate, direction, fmtBps, fmtDelta, gbps } from './model.js';
export { render, summary, esc } from './render.js';
export { createZoom } from './zoom.js';
export { createTooltip } from './tooltip.js';
export { mount } from './mount.js';
