/* 'trace-sankey/react'：React 元件與 hooks。
   <TraceSankey> 是完整接線（建模、版面、SVG、縮放、tooltip、路徑高亮、點擊、專注）；
   <TraceSvg> 是純渲染的 <svg>（自己接 layout()／縮放的人用）；
   useTraceModel 是 build() 的 memo 包裝；useHighlight／useNodeClick／useFocus 是互動層的三個 hook。 */
export { TraceSankey } from './TraceSankey.js';
export type { TraceSankeyProps, TraceSankeyHandle } from './TraceSankey.js';
export { TraceSvg } from './svg/TraceSvg.js';
export type { TraceSvgProps } from './svg/TraceSvg.js';
export { useTraceModel } from './hooks/useTraceModel.js';
export { useStableDoc } from './hooks/useStableDoc.js';
export { useStableJson } from './hooks/useStableJson.js';
export { useHighlight } from './hooks/useHighlight.js';
export type { HighlightApi } from './hooks/useHighlight.js';
export { useNodeClick } from './hooks/useNodeClick.js';
export type { NodeClickHandler } from './hooks/useNodeClick.js';
export { useFocus } from './hooks/useFocus.js';
export type { ZoomApi } from './hooks/useZoom.js';
