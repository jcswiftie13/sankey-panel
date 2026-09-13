/* 點擊回呼（參考面板的 Locate）：可定位的卡（locatable）被點到就呼叫 onNodeClick(id, node)。
   事件走容器上的 click 委派（closest('g[data-n]')），跟 tooltip／高亮同一套。
   拖曳結束的那個 click 不算（zoom 在拖曳中把 isPanning 設成 true）。
   .clickable（cursor:pointer）不是這裡加的：cards.tsx 依同一份 locatable() 當 className 輸出。
   回呼經 useLatest：換一個新的函式不會重綁 listener。 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { TraceModel, TraceNode, TraceWrapper } from '../model/types.js';
import { locatable } from '../locatable.js';

export type NodeClickHandler = (id: string, node: TraceNode | TraceWrapper) => void;

export const useNodeClick = (
  wrapRef: RefObject<HTMLElement | null>,
  model: TraceModel,
  onNodeClick: NodeClickHandler | undefined,
  isPanning: () => boolean
): void => {
  const latest = useRef(onNodeClick);
  latest.current = onNodeClick;
  const isPanningRef = useRef(isPanning);
  isPanningRef.current = isPanning;
  const enabled = !!onNodeClick;

  useEffect(() => {
    const el = wrapRef.current;
    if (!enabled || !model.ok || !el) return;
    const m = model;
    const wrappers = new Map(m.wrappers.map((w) => [w.id, w]));
    const onClick = (ev: MouseEvent): void => {
      const t = ev.target as Element | null;
      const hit = t && t.closest ? t.closest('g[data-n]') : null;
      if (!hit || !el.contains(hit)) return;
      if (isPanningRef.current()) return;
      const id = hit.getAttribute('data-n')!;
      const n: TraceNode | TraceWrapper | undefined = m.nodeMap[id] ?? wrappers.get(id);
      if (!n || !locatable(n)) return;
      ev.stopPropagation();
      latest.current?.(id, n);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [wrapRef, model, enabled]);
};
