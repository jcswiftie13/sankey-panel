/* trace-sankey 主入口。
   build/validate/summary 是純函式（Node 也能跑，SSR 安全）；
   mount/createZoom 需要瀏覽器 DOM。SVG 字串渲染走子路徑 'trace-sankey/static'，
   範例資料走 'trace-sankey/samples'，React 元件走 'trace-sankey/react'。 */
export {
  build, validate, direction, fmtBps, fmtDelta, fmtBytes, fmtRate, fmtAmount, gbps,
  HOP_TYPES, GROUP_TYPES, FLOW_TYPES, TYPE_LABEL
} from './model.js';
export { render, summary, esc } from './render.js';
export { createZoom, zoomStep } from './zoom.js';
export { createTooltip } from './tooltip.js';
export { mount } from './mount.js';
export type {
  WireInvestigation, WireUsage, WireClient, WireNodeData, WireIoMetrics, WireEdgeData, WireGraph,
  Channel, RateUnit, TraceNode, TraceEdge, TraceModelOk, TraceModelError, TraceModel, BuildOptions
} from './types.js';
export type { ZoomInstance } from './zoom.js';
export type { TooltipInstance } from './tooltip.js';
export type { MountOptions, MountInstance } from './mount.js';
