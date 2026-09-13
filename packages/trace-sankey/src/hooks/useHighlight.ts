/* 路徑高亮（參考面板的 hover path highlight，prop pathHighlight 打開才綁）：
   滑到一張卡片，往上游沿 inEdges、往下游沿 outEdges（穿過推導邊與歸屬線）走到底，
   路徑上的帶與卡片加 .lit、容器加 .hl-on，其餘由 CSS 變淡。k8s node 外框取成員 pod 路徑的聯集。

   狀態只在 class 上、樣式全在 CSS——跟帶子的 :hover 高亮同一個理由（4a752b9）：
   mouseleave 沒觸發（游標衝出視窗、觸控中斷、拖曳吃事件）也不會有東西卡在高亮。
   額外在容器 pointerleave 與拖曳開始時（TraceSankey 把 clear 接進 useZoom 的 onPanStart）清一次，保險。

   事件走容器上的 mouseover／mouseout 委派（closest('g[data-n]')），跟 tooltip 同一套，不逐張卡綁：
   stress/05-huge 有上千張卡。DOM ↔ model 的對應靠 render 輸出的 data-e（model.edges 索引）與
   data-n（節點／外框 id），不靠 DOM 順序。

   React 只在 className prop 變時重寫 class 屬性，model 換了但 key 相同的元素會被沿用、.lit 會殘留——
   所以 effect 的 cleanup 一定要 clear()，且索引每次 model 變都重建。 */
import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import type { TraceModel, TraceModelOk } from '../model/types.js';

export interface HighlightApi { clear(): void }

const SELECTOR = 'g[data-n]';

/* 從一組起點節點沿兩個方向走到底，回傳路徑上的邊索引與節點 id */
const pathOf = (m: TraceModelOk, startIds: string[]): { edges: Set<number>; nodes: Set<string> } => {
  const edgeIdx = new Map<object, number>();
  m.edges.forEach((e, i) => edgeIdx.set(e, i));
  const es = new Set<number>(), ns = new Set<string>();
  const walk = (id: string, key: 'inEdges' | 'outEdges', next: (e: { fromId: string; toId: string }) => string): void => {
    const stack = [id], seen = new Set<string>([id]);
    while (stack.length) {
      const n = m.nodeMap[stack.pop()!];
      if (!n) continue;
      ns.add(n.id);
      for (const e of n[key]) {
        es.add(edgeIdx.get(e)!);
        const to = next(e);
        if (!seen.has(to)) { seen.add(to); stack.push(to); }
      }
    }
  };
  for (const id of startIds) {
    walk(id, 'inEdges', (e) => e.fromId);
    walk(id, 'outEdges', (e) => e.toId);
  }
  return { edges: es, nodes: ns };
};

export const useHighlight = (
  wrapRef: RefObject<HTMLElement | null>,
  model: TraceModel,
  enabled: boolean,
  isPanning: () => boolean
): HighlightApi => {
  const clearRef = useRef<() => void>(() => {});
  const isPanningRef = useRef(isPanning);
  isPanningRef.current = isPanning;

  useEffect(() => {
    const el = wrapRef.current;
    if (!enabled || !model.ok || !el) return;
    const m = model;
    /* 索引一次建好：hover 時不再掃 DOM */
    const bands: Element[] = [];
    el.querySelectorAll('.band[data-e]').forEach((b) => { bands[Number(b.getAttribute('data-e'))] = b; });
    const cards = new Map<string, Element>();
    el.querySelectorAll(SELECTOR).forEach((g) => cards.set(g.getAttribute('data-n')!, g));
    const wrappers = new Map(m.wrappers.map((w) => [w.id, w]));

    let litEls: Element[] = [];
    let cur: Element | null = null;
    const clear = (): void => {
      cur = null;
      if (!litEls.length) return;
      el.classList.remove('hl-on');
      for (const x of litEls) x.classList.remove('lit');
      litEls = [];
    };
    const show = (id: string): void => {
      const w = wrappers.get(id);
      const starts = w ? w.podIds : [id];
      if (!starts.length) return;               /* 空外框：沒有路徑可亮 */
      const p = pathOf(m, starts);
      clear();
      for (const i of p.edges) { const b = bands[i]; if (b) { b.classList.add('lit'); litEls.push(b); } }
      for (const k of p.nodes) { const c = cards.get(k); if (c) { c.classList.add('lit'); litEls.push(c); } }
      if (w) { const c = cards.get(id); if (c) { c.classList.add('lit'); litEls.push(c); } }
      el.classList.add('hl-on');
    };
    const onOver = (ev: MouseEvent): void => {
      const t = ev.target as Element | null;
      const hit = t && t.closest ? t.closest(SELECTOR) : null;
      if (!hit || !el.contains(hit)) return;
      if (hit === cur) return;                  /* 同一張卡的 rect → text：不重算 */
      if (isPanningRef.current()) return;
      cur = hit;
      show(hit.getAttribute('data-n')!);
    };
    const onOut = (ev: MouseEvent): void => {
      const c = cur;
      if (!c) return;
      const rel = ev.relatedTarget as Node | null;
      if (rel && c.contains(rel)) return;       /* 還在同一個目標裡面移動 */
      clear();
    };
    el.addEventListener('mouseover', onOver);
    el.addEventListener('mouseout', onOut);
    el.addEventListener('pointerleave', clear);
    clearRef.current = clear;
    return () => {
      clear();
      el.removeEventListener('mouseover', onOver);
      el.removeEventListener('mouseout', onOut);
      el.removeEventListener('pointerleave', clear);
      clearRef.current = () => {};
    };
  }, [wrapRef, model, enabled]);

  return useMemo<HighlightApi>(() => ({ clear: () => clearRef.current() }), []);
};
