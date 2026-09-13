/* <svg> 根元件：吃 model 與 layout() 算好的 Geometry，純渲染、無狀態、SSR 安全。
   繪製順序＝z-order：defs（zoom-layer 外）→ g.zoom-layer → 欄位標題 → 帶（先畫）→ 帶上數字 → 卡片 → 殘差（最後）。
   <g class="zoom-layer"> 是 zoom 的 hook：它的 transform 由 zoom.ts 直接改，這裡絕不把 transform 當 prop——
   React 只 diff 它知道的 props，不會洗掉 imperative 設的值。 */
import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { Geometry } from '../layout/geometry.js';
import type { TraceModelOk } from '../model/types.js';
import { PAD_SIDE, PAD_TOP } from '../layout/constants.js';
import { colCaption, wrapperColCaption } from '../layout/tips.js';
import { Defs } from './Defs.js';
import { Band, BandLabel } from './Band.js';
import { Card, Residual, WrapperBox } from './cards.js';

export interface TraceSvgProps {
  model: TraceModelOk;
  geo: Geometry;
  /** Node 端字串渲染：帶子輸出原生 <title> 當 hover 備援。瀏覽器路徑有 JS tooltip，不輸出。 */
  headless?: boolean;
  /** 漸層 id 前綴（多實例安全）；空字串＝跟以前同名。非空時把 hover 用的漸層以 CSS 變數掛在 <svg> 上 */
  idPrefix?: string;
  /** 有 onNodeClick 時為 true：可定位的卡（locatable）加 .clickable。headless 不給，golden 輸出無此 class */
  clickable?: boolean;
}

export const TraceSvg = memo(function TraceSvg({ model, geo, headless = false, idPrefix = '', clickable = false }: TraceSvgProps) {
  const E = (id: string) => geo.edges.get(id)!;
  const N = (id: string) => geo.nodes.get(id)!;
  const p = idPrefix;
  /* CSS 的 .band:hover 只能寫死一個 url(#…)，多實例時靠變數各拿自己的；沒有前綴就不掛（輸出不變） */
  const hoverVars = p ? {
    '--gband-h': 'url(#' + p + 'gband-h)',
    '--gband-back-h': 'url(#' + p + 'gband-back-h)',
    '--gband-w-h': 'url(#' + p + 'gband-w-h)'
  } as CSSProperties : undefined;
  return (
    /* 尺寸交給 CSS（.chart svg）：SVG 填滿容器，meet-fit 就是「符合視窗」。 */
    <svg viewBox={'0 0 ' + geo.width + ' ' + geo.height} preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg" role="img" aria-label="追查 Sankey" style={hoverVars}>
      <Defs model={model} p={p} />
      <g className="zoom-layer">
        {/* 只剩 root 的空 k8s node 外框時不算空：外框就是要畫的東西 */}
        {!model.nodes.length && !geo.wrappers.length && (
          <text className="col-cap" x={PAD_SIDE} y={PAD_TOP}>顯示門檻／通道過濾之後沒有任何節點</text>
        )}
        {/* 欄位標題：x 用欄的 x（被外框包住的 pod 自己的 x 縮了 WRAP_PAD）；
            只有空外框的 pod 欄沒有節點可問，標題自己印 */}
        {geo.cols.map((col, ci) => (col && col.length) ? (
          <text key={ci} className="col-cap" x={geo.colX[ci]} y="24">{colCaption(col, model.dir)}</text>
        ) : (ci === geo.podCol && geo.wrappers.length) ? (
          <text key={ci} className="col-cap" x={geo.colX[ci]} y="24">{wrapperColCaption(ci)}</text>
        ) : null)}
        {/* 帶：先畫，壓在盒子下面 */}
        {model.edges.map((e, ei) => <Band key={e.id} e={e} ei={ei} g={E(e.id)} model={model} headless={headless} p={p} />)}
        {model.edges.map((e) => <BandLabel key={e.id} e={e} g={E(e.id)} />)}
        {/* k8s node 外框（layout:'node'）：畫在帶之上、卡片之下，pod 卡壓在框裡 */}
        {geo.wrappers.map((wg) => <WrapperBox key={wg.wrapper.id} g={wg} model={model} clickable={clickable} />)}
        {/* 盒子 */}
        {model.nodes.map((n) => <Card key={n.id} n={n} g={N(n.id)} model={model} nsColor={geo.nsColor} clickable={clickable} />)}
        {/* 殘差最後畫 */}
        {model.nodes.map((n) => n.kind !== 'node' ? null :
          N(n.id).leftSlots.concat(N(n.id).rightSlots).map((sl) => sl.res
            ? <Residual key={n.id + ':' + sl.res} n={n} g={N(n.id)} sl={sl} /> : null))}
      </g>
    </svg>
  );
});
