/* trace-sankey 主入口（不載 React）。
   build/validate/summary/layout 是純函式（Node 也能跑，SSR 安全）；createZoom 需要瀏覽器 DOM。
   SVG 字串渲染走子路徑 'trace-sankey/static'（它拉進 react-dom/server，刻意不放這裡），
   範例資料走 'trace-sankey/samples'，React 元件走 'trace-sankey/react'。 */
export { build } from './model/build.js';
export { validate, direction } from './model/validate.js';
export { fmtBps, fmtDelta, fmtBytes, fmtRate, fmtAmount, gbps } from './model/format.js';
export { HOP_TYPES, GROUP_TYPES, FLOW_TYPES, TYPE_LABEL } from './model/classify.js';
export { summary } from './summary.js';
export { flowTables } from './tables.js';
export type { FlowTables, FlowRow, AppRow, NsRow } from './tables.js';
export { esc } from './layout/text.js';
export { layout } from './layout/layout.js';
export { locatable } from './locatable.js';
export type { Geometry, NodeGeom, EdgeGeom, Slot, WrapperGeom } from './layout/geometry.js';
export { createZoom, zoomStep } from './zoom.js';
export type {
  WireInvestigation, WireUsage, WireClient, WireNodeData, WireIoMetrics, WireEdgeData, WireGraph,
  Channel, RateUnit, Direction, Channels, Status, NodeInfo, NodeUsage, NodeClient,
  TraceNode, TraceEdge, TraceModelOk, TraceModelError, TraceModel, BuildOptions,
  WireNodeInvestigation, StorageRoots, TraceWrapper
} from './model/types.js';
export type { ZoomInstance, ZoomOptions } from './zoom.js';
