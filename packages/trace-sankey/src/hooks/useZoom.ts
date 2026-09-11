/* 把 imperative 的 createZoom() 接進 React 生命週期。
   - 每個元件一個實例（useRef 懶建），卸載時 dispose()；StrictMode 的 mount→unmount→mount
     會建兩個實例，第一個已經 dispose 乾淨。
   - attach 走 useLayoutEffect：要等 <svg> 進 DOM 才量得到 getScreenCTM()，但要在瀏覽器繪製前，
     否則第一幀會閃一下沒縮放的圖。
   - 縮放狀態的保留規則：同一份 doc 底下改門檻／通道，React 重畫時 <g class="zoom-layer">
     的 DOM 節點不換，attach() 認得同一個 layer 就沿用 k/tx/ty；doc 參考變了才 reset → 重新 fit。
   - model 不 ok（.chart 沒有 svg）就 detach；恢復時新 svg → 找不到舊 layer → initial()。 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import type { TraceModel } from '../model/types.js';
import { createZoom } from '../zoom.js';
import type { ZoomInstance, ZoomOptions } from '../zoom.js';
import { useLatest } from './useLatest.js';

export interface ZoomApi {
  fit(): void;
  actual(): void;
  zoomBy(factor: number): void;
  refresh(): void;
  isPanning(): boolean;
}

export const useZoom = (wrapRef: RefObject<HTMLElement | null>, model: TraceModel, doc: unknown, opts: ZoomOptions): ZoomApi => {
  const zoomRef = useRef<ZoomInstance | null>(null);
  const get = (): ZoomInstance => (zoomRef.current ??= createZoom());
  const latest = useLatest(opts);
  const prevDoc = useRef<unknown>(undefined);

  useLayoutEffect(() => () => { zoomRef.current?.dispose(); zoomRef.current = null; }, []);

  useLayoutEffect(() => {
    const z = get();
    if (!model.ok || !wrapRef.current) { z.detach(); return; }
    const reset = prevDoc.current !== doc;
    prevDoc.current = doc;
    z.attach(wrapRef.current, {
      onPanStart: () => latest.current.onPanStart?.(),
      onPanEnd: () => latest.current.onPanEnd?.(),
      onChange: (s) => latest.current.onChange?.(s)
    }, reset);
  }, [model, doc]);

  /* 對外的 API 物件 identity 穩定：ref handle 的 deps 才不會每次重算 */
  return useMemo<ZoomApi>(() => ({
    fit: () => zoomRef.current?.fit(),
    actual: () => zoomRef.current?.actual(),
    zoomBy: (f) => zoomRef.current?.zoomBy(f),
    refresh: () => zoomRef.current?.refresh(),
    isPanning: () => !!zoomRef.current?.isPanning()
  }), []);
};
