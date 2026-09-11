/* 'trace-sankey/react'：React 元件與 hooks。
   <TraceSankey> 是完整接線（建模、版面、SVG、縮放、tooltip）；
   <TraceSvg> 是純渲染的 <svg>（自己接 layout()／縮放的人用）；
   useTraceModel 是 build() 的 memo 包裝。 */
export { TraceSankey } from './TraceSankey.js';
export type { TraceSankeyProps, TraceSankeyHandle } from './TraceSankey.js';
export { TraceSvg } from './svg/TraceSvg.js';
export type { TraceSvgProps } from './svg/TraceSvg.js';
export { useTraceModel } from './hooks/useTraceModel.js';
export { useStableDoc } from './hooks/useStableDoc.js';
export type { ZoomApi } from './hooks/useZoom.js';
