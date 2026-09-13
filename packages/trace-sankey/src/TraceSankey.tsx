/* <TraceSankey>：把「建模 → 版面 → 畫 SVG → 縮放 → tooltip（→ 路徑高亮／點擊／專注）」接成一個 React 元件。
   使用端只要給一個有高度的容器（高度由 className／style 決定，元件不猜版面）。

   props：
     doc           追查 JSON（必填）。內容相同的新物件不重算、縮放保留（useStableDoc）
     minBps        顯示門檻（bps），只留增量大於它的帶子；0＝不過濾
     channels      'both'（預設）／'read'／'write'：storage 資料的 read／write 帶只看其中一種；
                   被藏起來的通道併進其他輸入／其他輸出（與門檻同一套機制）。無通道的邊不受影響
     layout        'flat'（預設）／'node'：k8s node 外框（參考面板的 Layout: Node），資料要有 pod-node 邊
     roots         參考面板的 root 選擇；省略＝現行超集（no-flow 全保留）。內容相同的新物件不重算
     pathHighlight hover 卡片時亮整條路徑（其餘變淡），可隨時開關
     onNodeClick   可定位的卡（locatable）被點到時呼叫 (id, node)；有給才把那些卡標成 .clickable
     focus         專注模式：body.chart-focus（套件 CSS 讓容器去框；使用端自己藏工具列）＋ refresh 縮放
     onModel       每次 build 成功時拿到 model（使用端拼 legend／警告用）
     onError       build 失敗時拿到 errors 字串陣列（元件不畫錯誤 UI，文案是使用端的事）
     onZoom        縮放倍率變化（螢幕實際倍率，量不到時是 null）
   ref：{ refresh, model, zoom: { fit, actual, zoomBy, refresh, isPanning } }
   會改 model 的選項（minBps／channels／layout／roots）都是 props、都在 useTraceModel 的 deps 裡；
   pathHighlight／onNodeClick／focus 不進 model，各自是一個 effect。handle 沒有 setter：props 驅動。

   套件裡沒有任何 innerHTML：SVG 由 React 直接渲染，Trusted Types 開著也能畫。
   同一頁可以掛多張：漸層 id 用 useId() 加前綴，CSS hover 透過 CSS 變數拿到自己那組。 */
import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { Channel, StorageRoots, TraceModelOk, TraceNode, TraceWrapper } from './model/types.js';
import { layout } from './layout/layout.js';
import { TraceSvg } from './svg/TraceSvg.js';
import { TraceTooltip } from './tooltip/TraceTooltip.js';
import type { TraceTooltipHandle } from './tooltip/TraceTooltip.js';
import { useLatest } from './hooks/useLatest.js';
import { useStableDoc } from './hooks/useStableDoc.js';
import { useStableJson } from './hooks/useStableJson.js';
import { useTraceModel } from './hooks/useTraceModel.js';
import { useZoom } from './hooks/useZoom.js';
import type { ZoomApi } from './hooks/useZoom.js';
import { useHighlight } from './hooks/useHighlight.js';
import { useNodeClick } from './hooks/useNodeClick.js';
import { useFocus } from './hooks/useFocus.js';

export interface TraceSankeyProps {
  /** 追查 JSON（契約見 README）。換一個「內容相同的新物件」不會重畫、縮放保留。 */
  doc: unknown;
  /** 顯示門檻（bps），預設 0 */
  minBps?: number;
  /** storage 資料只看其中一個通道，預設 'both' */
  channels?: 'both' | Channel;
  /** 'node'：k8s node 外框（pod 欄依所在 node 分區）；預設 'flat' */
  layout?: 'flat' | 'node';
  /** 參考面板的 root 選擇；省略＝no-flow hop 全保留 */
  roots?: StorageRoots | null;
  /** hover 卡片時亮整條路徑 */
  pathHighlight?: boolean;
  /** 可定位的卡被點到時呼叫；有給才把那些卡標成 .clickable */
  onNodeClick?: (id: string, node: TraceNode | TraceWrapper) => void;
  /** 專注模式（body.chart-focus） */
  focus?: boolean;
  /** 容器高度由這兩個決定，元件不設高度 */
  className?: string;
  style?: CSSProperties;
  onModel?: (model: TraceModelOk) => void;
  onError?: (errors: string[]) => void;
  onZoom?: (screenScale: number | null) => void;
}

export interface TraceSankeyHandle {
  /** 容器尺寸變了呼叫這個（重夾平移、更新倍率） */
  refresh(): void;
  /** 最近一次成功 build 的 model（失敗後是 null） */
  readonly model: TraceModelOk | null;
  zoom: ZoomApi;
}

export const TraceSankey = forwardRef<TraceSankeyHandle, TraceSankeyProps>(function TraceSankey(props, ref) {
  const { minBps = 0, channels = 'both', layout: lay = 'flat', pathHighlight = false, focus = false, className, style } = props;
  const latest = useLatest(props);
  const doc = useStableDoc(props.doc);
  const roots = useStableJson(props.roots ?? null);
  const model = useTraceModel(doc, { minBps, channels, layout: lay, roots });
  const geo = useMemo(() => (model.ok ? layout(model) : null), [model]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<TraceTooltipHandle | null>(null);
  /* useId 的字元（React 18 是 :r0:、19 是 «r0»）在 url(#…) 裡不保險，只留安全字元 */
  const idPrefix = useId().replace(/[^A-Za-z0-9_-]/g, '') + '-';

  /* 拖曳開始：tooltip 與路徑高亮都收掉（拖曳吃事件，mouseleave 不一定來） */
  const hlRef = useRef<{ clear(): void } | null>(null);
  const zoom = useZoom(wrapRef, model, doc, {
    onPanStart: () => { tipRef.current?.hide(); hlRef.current?.clear(); },
    onChange: (s) => latest.current.onZoom?.(s)
  });
  hlRef.current = useHighlight(wrapRef, model, pathHighlight, zoom.isPanning);
  useNodeClick(wrapRef, model, props.onNodeClick, zoom.isPanning);
  useFocus(focus, zoom.refresh);

  /* onModel／onError 在 commit 之後才叫：使用端在裡面 setState 才不會撞到「render 中更新別的元件」 */
  const modelRef = useRef<TraceModelOk | null>(null);
  useEffect(() => {
    if (model.ok) { modelRef.current = model; latest.current.onModel?.(model); }
    else { modelRef.current = null; tipRef.current?.hide(); latest.current.onError?.(model.errors); }
  }, [model]);

  useImperativeHandle(ref, () => ({
    refresh: () => zoom.refresh(),
    get model() { return modelRef.current; },
    zoom
  }), [zoom]);

  return (
    <div ref={wrapRef} className={['trace-sankey', 'chart-wrap', className].filter(Boolean).join(' ')} style={style}>
      {/* .chart 不會被重畫掉：tooltip 的委派 listener 掛這裡 */}
      <div ref={chartRef} className="chart">
        {model.ok && geo && <TraceSvg model={model} geo={geo} idPrefix={idPrefix} clickable={!!props.onNodeClick} />}
      </div>
      <TraceTooltip ref={tipRef} hostRef={chartRef} isPanning={zoom.isPanning} />
    </div>
  );
});
