/* tooltip：帶子的 hover 高亮純靠 CSS（.band:hover），JS 只管 tooltip——
   少了要還原的顏色狀態，mouseleave 沒觸發（觸控、游標衝出視窗、拖曳吃事件）
   也不會有帶子卡在高亮色。
   元素用 portal 掛在 document.body 上（position:fixed）：掛進圖的容器會被 overflow:hidden 裁掉。
   事件走 .chart 上的三個原生 listener 委派（mouseover／mousemove／mouseout ＋ closest()），
   不是每個元素各綁 React handler：stress/05-huge 有 5.4 萬個元素，那會是 16 萬個 handler。
   內容來源是每條 .band 與每張卡的 <g> 上的 data-tip JSON（layout/tips.ts 產生）：
   帶子是 {from,to,fi,ti,bps,...}、節點是 {node:1,title,rows:[[k,v],...]}。
   滑鼠座標不進 state：mousemove 直接改 ref 上的 style，一秒幾十次不該 re-render。 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { BandMeta, NodeTip } from '../layout/tips.js';
import { BandTip, NodeTipView } from './tips.js';

export interface TraceTooltipHandle { hide(): void }
export interface TraceTooltipProps {
  /** 委派 listener 掛的元素（.chart），svg 重畫也不會換 */
  hostRef: RefObject<HTMLElement | null>;
  /** 拖曳中不彈 tooltip */
  isPanning: () => boolean;
}

const SELECTOR = '.band, g[data-tip]';

export const TraceTooltip = forwardRef<TraceTooltipHandle, TraceTooltipProps>(function TraceTooltip({ hostRef, isPanning }, ref) {
  const [data, setData] = useState<BandMeta | NodeTip | null>(null);
  const el = useRef<HTMLDivElement | null>(null);
  const cur = useRef<Element | null>(null);
  const mouse = useRef({ x: 0, y: 0 });
  const isPanningRef = useRef(isPanning);
  isPanningRef.current = isPanning;

  const position = () => {
    const t = el.current;
    if (!t) return;
    const w = t.offsetWidth || 260, h = t.offsetHeight || 90;
    t.style.left = Math.min(mouse.current.x + 14, window.innerWidth - w - 10) + 'px';
    t.style.top = Math.max(8, Math.min(mouse.current.y + 14, window.innerHeight - h - 10)) + 'px';
  };
  const hide = () => { cur.current = null; setData(null); };
  useImperativeHandle(ref, () => ({ hide }), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onOver = (ev: MouseEvent) => {
      const t = ev.target as Element | null;
      const hit = t && t.closest ? t.closest(SELECTOR) : null;
      if (!hit || !host.contains(hit)) return;
      if (hit === cur.current) return;              /* 同一張卡的 rect → text：不重設 */
      if (isPanningRef.current()) return;
      let d: BandMeta | NodeTip;
      try { d = JSON.parse(hit.getAttribute('data-tip')!); } catch (e) { return; }
      cur.current = hit;
      mouse.current = { x: ev.clientX, y: ev.clientY };
      setData(d);
    };
    const onMove = (ev: MouseEvent) => {
      if (!cur.current) return;
      mouse.current = { x: ev.clientX, y: ev.clientY };
      position();
    };
    const onOut = (ev: MouseEvent) => {
      const c = cur.current;
      if (!c) return;
      const rel = ev.relatedTarget as Node | null;
      if (rel && c.contains(rel)) return;            /* 還在同一個目標裡面移動 */
      hide();
    };
    host.addEventListener('mouseover', onOver);
    host.addEventListener('mousemove', onMove);
    host.addEventListener('mouseout', onOut);
    return () => {
      host.removeEventListener('mouseover', onOver);
      host.removeEventListener('mousemove', onMove);
      host.removeEventListener('mouseout', onOut);
    };
  }, [hostRef]);

  /* 內容換了尺寸就變，要在畫出來之後重新夾邊界 */
  useEffect(() => { if (data) position(); }, [data]);

  if (typeof document === 'undefined') return null;   /* SSR：tooltip 純瀏覽器 */
  return createPortal(
    <div ref={el} className="trace-sankey-tooltip" hidden={!data}>
      {data ? ('node' in data ? <NodeTipView d={data} /> : <BandTip d={data} />) : null}
    </div>,
    document.body
  );
});
