/* 圖的縮放與平移：只動 <g class="zoom-layer"> 的 transform 屬性。
   刻意維持 imperative、不走 React 狀態：stress/05-huge 有 5.4 萬個 SVG 元素，
   滾輪每格都跑一次 reconciliation 不可接受；直接 setAttribute 一個 <g> 是常數時間。
   React 那邊絕不把 transform 當 prop，這裡設的值才不會被洗掉。
   縮放狀態是暫時的，不進 query string——滾輪一格推一筆 history 是災難。 */
const MIN_K = 0.25;               /* 相對「符合視窗」最多再縮小到這 */
const MAX_SCREEN = 8;             /* 放大上限用「螢幕上的實際倍率」定義，不是相對 fit —— */
const MIN_MAX_K = 4;              /* 超大圖 fit 可能只有 0.2%，相對倍率會把人卡在看不見字 */
const STEP = 1.25;                /* 按鈕／快捷鍵一格 */
const DRAG_MIN = 4;               /* 超過這個位移才算拖曳，免得吃掉 band 的 click */
const EDGE = 0.35;                /* 平移夾住：內容至少要蓋住視窗這個比例 */

export interface ZoomOptions {
  onPanStart?: () => void;
  onPanEnd?: () => void;
  /** 螢幕實際倍率（1 = 原始大小）；量不到（display:none）時是 null */
  onChange?: (screenScale: number | null) => void;
}
export interface ZoomInstance {
  /** wrap 內要有 svg 與 <g class="zoom-layer">；同一 layer 重 attach 沿用縮放，reset 強制重新 fit */
  attach(wrap: HTMLElement, opts?: ZoomOptions, reset?: boolean): boolean;
  detach(): void;
  /** 徹底收掉：解綁全部 listener，之後這個實例不能再用 */
  dispose(): void;
  refresh(): void;
  fit(): void;
  actual(): void;
  zoomBy(factor: number): void;
  step: number;
  isPanning(): boolean;
}

interface State { wrap: HTMLElement; svg: SVGSVGElement; layer: Element; k: number; tx: number; ty: number; measured: boolean }
interface Pt { x: number; y: number }

/* 一個 createZoom() 實例管一個容器。dispose() 把 listener 全解掉——
   單例時代「bind 一次永不解綁」沒關係，變成可重複建立的實例後，
   mount/unmount 循環（尤其 React StrictMode 的雙重掛載）不解綁就會疊 listener。 */
export const createZoom = (): ZoomInstance => {
  let st: State | null = null;
  let opts: ZoomOptions = {};
  let boundWrap: HTMLElement | null = null;
  let panning = false, moved = false, pid: number | null = null;
  let sx = 0, sy = 0, sTx = 0, sTy = 0, raf = 0;
  const pts = new Map<number, Pt>();      /* 雙指 */
  let pinch: { d: number; mx: number; my: number } | null = null;

  /* ---------- 幾何 ---------- */
  const ctm = (): DOMMatrix | null => {
    if (!st) return null;
    const m = st.svg.getScreenCTM();      /* 分頁 display:none 時是 null */
    return (m && m.a) ? m : null;         /* 容器寬高 0 時 a=0，inverse() 會丟例外 */
  };
  const toVB = (m: DOMMatrix, cx: number, cy: number): DOMPoint => {   /* client px -> viewBox 座標 */
    const p = st!.svg.createSVGPoint();
    p.x = cx; p.y = cy;
    return p.matrixTransform(m.inverse());
  };
  const vbScale = (m: DOMMatrix): number => Math.abs(m.a) || 1;   /* 一個 viewBox 單位幾個 CSS px */
  const boxW = (): number => st!.svg.viewBox.baseVal.width || 1;
  const boxH = (): number => st!.svg.viewBox.baseVal.height || 1;

  /* 看得到的 viewBox 矩形：反解 client rect 兩個角，letterbox 自動算進去 */
  const visible = (m: DOMMatrix) => {
    const r = st!.svg.getBoundingClientRect();
    const a = toVB(m, r.left, r.top), b = toVB(m, r.right, r.bottom);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  };
  const clampPan = (m: DOMMatrix | null): void => {   /* 內容不准整個被拖出視窗 */
    if (!st || !m) return;
    const v = visible(m), cw = st.k * boxW(), ch = st.k * boxH();
    const mx = Math.min(v.w, cw) * EDGE, my = Math.min(v.h, ch) * EDGE;
    st.tx = Math.min(Math.max(st.tx, v.x + mx - cw), v.x + v.w - mx);
    st.ty = Math.min(Math.max(st.ty, v.y + my - ch), v.y + v.h - my);
  };

  /* ---------- 套用 ---------- */
  const apply = (): void => {
    if (!st) return;
    st.layer.setAttribute('transform',
      'translate(' + st.tx.toFixed(2) + ',' + st.ty.toFixed(2) + ') scale(' + st.k.toFixed(5) + ')');
    if (opts.onChange) {
      const m = ctm();
      opts.onChange(m ? st.k * vbScale(m) : null);   /* 螢幕上的實際倍率，1 = 原始大小 */
    }
  };
  const schedule = (): void => {          /* 滾輪／拖曳一秒幾十次，合併成一 frame 一次 */
    if (raf) return;
    raf = window.requestAnimationFrame(() => { raf = 0; apply(); });
  };

  const zoomAt = (k2: number, cx: number, cy: number): void => {   /* 以畫面點 (cx,cy) 為錨點縮放 */
    if (!st) return;
    const m = ctm();
    /* 上限 = 螢幕上放大到原尺寸的 MAX_SCREEN 倍；小圖至少也能放大 MIN_MAX_K 倍 */
    const hi = m ? Math.max(MIN_MAX_K, MAX_SCREEN / vbScale(m)) : MIN_MAX_K;
    k2 = Math.min(hi, Math.max(MIN_K, k2));
    if (m) {
      const p = toVB(m, cx, cy);
      st.tx = p.x - (k2 / st.k) * (p.x - st.tx);
      st.ty = p.y - (k2 / st.k) * (p.y - st.ty);
    }
    st.k = k2;
    clampPan(m);
    schedule();
  };
  const center = (): [number, number] => {
    const r = st!.svg.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };

  /* ---------- 三個基準 ---------- */
  const fit = (): void => {              /* 符合視窗：meet 本來就置中，identity 就是 */
    if (!st) return;
    st.k = 1; st.tx = 0; st.ty = 0; apply();
  };
  const actual = (): void => {           /* 1:1：一個 viewBox 單位＝一個 CSS px */
    if (!st) return;
    const m = ctm();
    if (!m) { fit(); return; }
    const c = center();
    zoomAt(1 / vbScale(m), c[0], c[1]);
  };
  const initial = (): void => {          /* 開場：符合視窗，但絕不放大超過原始大小 */
    fit();
    const m = ctm();
    st!.measured = !!m;                  /* 分頁隱藏時量不到，下次 attach() 再補 */
    if (!m) return;
    if (vbScale(m) > 1) actual();
  };
  const zoomBy = (f: number): void => {
    if (!st) return;
    const c = center();
    zoomAt(st.k * f, c[0], c[1]);
  };
  const refresh = (): void => {
    if (!st) return;
    clampPan(ctm());
    apply();
  };

  /* ---------- 滾輪 ---------- */
  const onWheel = (ev: WheelEvent): void => {
    if (!st) return;
    ev.preventDefault();                /* 不讓頁面跟著捲 */
    let d = ev.deltaY;
    if (ev.deltaMode === 1) d *= 16;         /* Firefox: DOM_DELTA_LINE */
    else if (ev.deltaMode === 2) d *= 400;   /* DOM_DELTA_PAGE */
    const f = Math.min(4, Math.max(0.25, Math.exp(-d * 0.0018)));
    zoomAt(st.k * f, ev.clientX, ev.clientY);
  };

  /* ---------- 拖曳平移 ---------- */
  const onDown = (ev: PointerEvent): void => {
    if (!st) return;
    const t = ev.target as Element | null;
    if (t && t.closest && t.closest('.zoom-ctl')) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (!pinch && pts.size === 2) { startPinch(); return; }
    if (pid !== null) return;
    pid = ev.pointerId; moved = false;
    sx = ev.clientX; sy = ev.clientY; sTx = st.tx; sTy = st.ty;
    try { st.wrap.setPointerCapture(ev.pointerId); } catch (e) { /* 舊瀏覽器沒有 pointer capture */ }
  };

  const onMove = (ev: PointerEvent): void => {
    if (!st) return;
    const p = pts.get(ev.pointerId);
    if (p) { p.x = ev.clientX; p.y = ev.clientY; }
    if (pinch) { movePinch(); return; }
    if (ev.pointerId !== pid) return;
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (!moved) {
      if (Math.abs(dx) + Math.abs(dy) < DRAG_MIN) return;   /* 門檻：click 還是 click */
      moved = true; panning = true;
      st.wrap.classList.add('is-panning');
      if (opts.onPanStart) opts.onPanStart();               /* 使用端收掉 tooltip */
    }
    const m = ctm();
    if (!m) return;
    const s = vbScale(m);
    st.tx = sTx + dx / s; st.ty = sTy + dy / s;
    clampPan(m); schedule();
  };

  const onUp = (ev: PointerEvent): void => {
    pts.delete(ev.pointerId);
    if (pinch && pts.size < 2) pinch = null;
    if (ev.pointerId !== pid) return;
    if (st) { try { st.wrap.releasePointerCapture(ev.pointerId); } catch (e) { /* 同上 */ } }
    pid = null;
    endPan();
    moved = false;
  };
  const endPan = (): void => {
    if (!panning) return;
    panning = false;
    if (st) st.wrap.classList.remove('is-panning');
    if (opts.onPanEnd) opts.onPanEnd();
  };

  /* ---------- 雙指 ---------- */
  const twoPts = (): Pt[] => [...pts.values()];
  const dist = (a: Pt, b: Pt): number => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));

  const startPinch = (): void => {
    const a = twoPts();
    if (a.length < 2) return;
    pinch = { d: dist(a[0], a[1]), mx: (a[0].x + a[1].x) / 2, my: (a[0].y + a[1].y) / 2 };
    if (pid !== null && st) { try { st.wrap.releasePointerCapture(pid); } catch (e) { /* 同上 */ } }
    pid = null;
    endPan();
  };
  const movePinch = (): void => {
    const a = twoPts();
    if (!st || !pinch || a.length < 2 || !pinch.d) return;
    const d = dist(a[0], a[1]);
    const mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2;
    const m = ctm();
    if (m) {                              /* 中點移動也要跟著平移 */
      const s = vbScale(m);
      st.tx += (mx - pinch.mx) / s; st.ty += (my - pinch.my) / s;
    }
    zoomAt(st.k * (d / pinch.d), mx, my);
    pinch.d = d; pinch.mx = mx; pinch.my = my;
  };

  /* ---------- attach / detach ---------- */
  /* listener 只綁一次：.chart-wrap 不會被重畫掉，裡面的 svg 才會。
     每次 attach() 只抽換 st，否則一次重畫就疊一組 listener。 */
  const bind = (wrap: HTMLElement): void => {
    if (boundWrap === wrap) return;
    boundWrap = wrap;
    wrap.addEventListener('wheel', onWheel, { passive: false });
    wrap.addEventListener('pointerdown', onDown);
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerup', onUp);
    wrap.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', refresh);
  };

  /* 同一個 layer 再 attach 就沿用縮放（React 重畫時 <g class="zoom-layer"> 的 DOM 節點不換，
     所以改門檻／通道之後縮放會留著）；換了一份 doc 由呼叫端傳 reset=true 重新 fit。 */
  const attach = (wrap: HTMLElement, o?: ZoomOptions, reset?: boolean): boolean => {
    const svg = wrap && wrap.querySelector('svg');
    const layer = svg && svg.querySelector('.zoom-layer');
    if (!svg || !layer) { detach(); return false; }
    const same = !reset && !!(st && st.layer === layer && st.measured);
    const k = same ? st!.k : 1, tx = same ? st!.tx : 0, ty = same ? st!.ty : 0;
    detach();
    opts = o || {};
    bind(wrap);
    st = { wrap, svg, layer, k, tx, ty, measured: same };
    if (same) refresh(); else initial();
    return true;
  };

  const detach = (): void => {
    if (st) st.wrap.classList.remove('is-panning');
    st = null; opts = {};
    panning = false; moved = false; pid = null; pts.clear(); pinch = null;
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
  };

  const isPanning = (): boolean => panning;

  /* 徹底收掉：解綁全部 listener，之後這個實例不能再用 */
  const dispose = (): void => {
    detach();
    if (boundWrap) {
      boundWrap.removeEventListener('wheel', onWheel);
      boundWrap.removeEventListener('pointerdown', onDown);
      boundWrap.removeEventListener('pointermove', onMove);
      boundWrap.removeEventListener('pointerup', onUp);
      boundWrap.removeEventListener('pointercancel', onUp);
      boundWrap = null;
    }
    window.removeEventListener('resize', refresh);
  };

  return { attach, detach, dispose, refresh, fit, actual, zoomBy, step: STEP, isPanning };
};

/* 工具列／快捷鍵的一格倍率，跟實例的 step 同值——使用端不必先有實例才能拿到 */
export const zoomStep = STEP;
