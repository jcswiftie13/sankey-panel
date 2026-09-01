/* 圖的縮放與平移：只動 <g class="zoom-layer"> 的 transform 屬性。
 縮放狀態是暫時的，不進 query string —— query string 是「你在看哪份資料」
 （?sample=&tab=），滾輪一格推一筆 history 是災難。 */
var MIN_K = 0.25;               /* 相對「符合視窗」最多再縮小到這 */
var MAX_SCREEN = 8;             /* 放大上限用「螢幕上的實際倍率」定義，不是相對 fit —— */
var MIN_MAX_K = 4;              /* 超大圖 fit 可能只有 0.2%，相對倍率會把人卡在看不見字 */
var STEP = 1.25;                /* 按鈕／快捷鍵一格 */
var DRAG_MIN = 4;               /* 超過這個位移才算拖曳，免得吃掉 band 的 click */
var EDGE = 0.35;                /* 平移夾住：內容至少要蓋住視窗這個比例 */

/* 一個 createZoom() 實例管一個容器。dispose() 把 listener 全解掉——
   單例時代「bind 一次永不解綁」沒關係，變成可重複建立的實例後，
   mount/destroy 循環（尤其 React StrictMode 的雙重掛載）不解綁就會疊 listener。 */
export function createZoom() {
  var st = null;                  /* {wrap, svg, layer, k, tx, ty} */
  var opts = {};
  var boundWrap = null;
  var panning = false, moved = false, pid = null;
  var sx = 0, sy = 0, sTx = 0, sTy = 0, raf = 0;
  var pts = {}, pinch = null;     /* 雙指 */

  /* ---------- 幾何 ---------- */
  function ctm() {
    if (!st || !st.svg) return null;
    var m = st.svg.getScreenCTM();      /* 分頁 display:none 時是 null */
    return (m && m.a) ? m : null;       /* 容器寬高 0 時 a=0，inverse() 會丟例外 */
  }
  function toVB(m, cx, cy) {            /* client px -> viewBox 座標 */
    var p = st.svg.createSVGPoint();
    p.x = cx; p.y = cy;
    return p.matrixTransform(m.inverse());
  }
  function vbScale(m) { return Math.abs(m.a) || 1; }   /* 一個 viewBox 單位幾個 CSS px */
  function boxW() { return st.svg.viewBox.baseVal.width || 1; }
  function boxH() { return st.svg.viewBox.baseVal.height || 1; }

  /* 看得到的 viewBox 矩形：反解 client rect 兩個角，letterbox 自動算進去 */
  function visible(m) {
    var r = st.svg.getBoundingClientRect();
    var a = toVB(m, r.left, r.top), b = toVB(m, r.right, r.bottom);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }
  function clampPan(m) {                /* 內容不准整個被拖出視窗 */
    if (!st || !m) return;
    var v = visible(m), cw = st.k * boxW(), ch = st.k * boxH();
    var mx = Math.min(v.w, cw) * EDGE, my = Math.min(v.h, ch) * EDGE;
    st.tx = Math.min(Math.max(st.tx, v.x + mx - cw), v.x + v.w - mx);
    st.ty = Math.min(Math.max(st.ty, v.y + my - ch), v.y + v.h - my);
  }

  /* ---------- 套用 ---------- */
  function apply() {
    if (!st) return;
    st.layer.setAttribute('transform',
      'translate(' + st.tx.toFixed(2) + ',' + st.ty.toFixed(2) + ') scale(' + st.k.toFixed(5) + ')');
    if (opts.onChange) {
      var m = ctm();
      opts.onChange(m ? st.k * vbScale(m) : null);   /* 螢幕上的實際倍率，1 = 原始大小 */
    }
  }
  function schedule() {                 /* 滾輪／拖曳一秒幾十次，合併成一 frame 一次 */
    if (raf) return;
    raf = window.requestAnimationFrame(function () { raf = 0; apply(); });
  }

  function zoomAt(k2, cx, cy) {         /* 以畫面點 (cx,cy) 為錨點縮放 */
    if (!st) return;
    var m = ctm();
    /* 上限 = 螢幕上放大到原尺寸的 MAX_SCREEN 倍；小圖至少也能放大 MIN_MAX_K 倍 */
    var hi = m ? Math.max(MIN_MAX_K, MAX_SCREEN / vbScale(m)) : MIN_MAX_K;
    k2 = Math.min(hi, Math.max(MIN_K, k2));
    if (m) {
      var p = toVB(m, cx, cy);
      st.tx = p.x - (k2 / st.k) * (p.x - st.tx);
      st.ty = p.y - (k2 / st.k) * (p.y - st.ty);
    }
    st.k = k2;
    clampPan(m);
    schedule();
  }
  function center() {
    var r = st.svg.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  /* ---------- 三個基準 ---------- */
  function fit() {                      /* 符合視窗：meet 本來就置中，identity 就是 */
    if (!st) return;
    st.k = 1; st.tx = 0; st.ty = 0; apply();
  }
  function actual() {                   /* 1:1：一個 viewBox 單位＝一個 CSS px */
    if (!st) return;
    var m = ctm();
    if (!m) { fit(); return; }
    var c = center();
    zoomAt(1 / vbScale(m), c[0], c[1]);
  }
  function initial() {                  /* 開場：符合視窗，但絕不放大超過原始大小 */
    fit();
    var m = ctm();
    st.measured = !!m;                  /* 分頁隱藏時量不到，下次 attach() 再補 */
    if (!m) return;
    if (vbScale(m) > 1) actual();
  }
  function zoomBy(f) {
    if (!st) return;
    var c = center();
    zoomAt(st.k * f, c[0], c[1]);
  }
  function refresh() {
    if (!st) return;
    clampPan(ctm());
    apply();
  }

  /* ---------- 滾輪 ---------- */
  function onWheel(ev) {
    if (!st) return;
    ev.preventDefault();                /* 不讓頁面跟著捲 */
    var d = ev.deltaY;
    if (ev.deltaMode === 1) d *= 16;         /* Firefox: DOM_DELTA_LINE */
    else if (ev.deltaMode === 2) d *= 400;   /* DOM_DELTA_PAGE */
    var f = Math.min(4, Math.max(0.25, Math.exp(-d * 0.0018)));
    zoomAt(st.k * f, ev.clientX, ev.clientY);
  }

  /* ---------- 拖曳平移 ---------- */
  function onDown(ev) {
    if (!st) return;
    if (ev.target && ev.target.closest && ev.target.closest('.zoom-ctl')) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    pts[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    if (!pinch && countPts() === 2) { startPinch(); return; }
    if (pid !== null) return;
    pid = ev.pointerId; moved = false;
    sx = ev.clientX; sy = ev.clientY; sTx = st.tx; sTy = st.ty;
    try { st.wrap.setPointerCapture(ev.pointerId); } catch (e) {}
  }

  function onMove(ev) {
    if (!st) return;
    if (pts[ev.pointerId]) { pts[ev.pointerId].x = ev.clientX; pts[ev.pointerId].y = ev.clientY; }
    if (pinch) { movePinch(); return; }
    if (ev.pointerId !== pid) return;
    var dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (!moved) {
      if (Math.abs(dx) + Math.abs(dy) < DRAG_MIN) return;   /* 門檻：click 還是 click */
      moved = true; panning = true;
      st.wrap.classList.add('is-panning');
      if (opts.onPanStart) opts.onPanStart();               /* app.js 收掉 tooltip */
    }
    var m = ctm();
    if (!m) return;
    var s = vbScale(m);
    st.tx = sTx + dx / s; st.ty = sTy + dy / s;
    clampPan(m); schedule();
  }

  function onUp(ev) {
    delete pts[ev.pointerId];
    if (pinch && countPts() < 2) pinch = null;
    if (ev.pointerId !== pid) return;
    if (st) { try { st.wrap.releasePointerCapture(ev.pointerId); } catch (e) {} }
    pid = null;
    endPan();
    moved = false;
  }
  function endPan() {
    if (!panning) return;
    panning = false;
    if (st) st.wrap.classList.remove('is-panning');
    if (opts.onPanEnd) opts.onPanEnd();
  }

  /* ---------- 雙指 ---------- */
  function countPts() { var n = 0; for (var k in pts) if (pts.hasOwnProperty(k)) n++; return n; }
  function twoPts() { var a = []; for (var k in pts) if (pts.hasOwnProperty(k)) a.push(pts[k]); return a; }
  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }

  function startPinch() {
    var a = twoPts();
    if (a.length < 2) return;
    pinch = { d: dist(a[0], a[1]), mx: (a[0].x + a[1].x) / 2, my: (a[0].y + a[1].y) / 2 };
    if (pid !== null && st) { try { st.wrap.releasePointerCapture(pid); } catch (e) {} }
    pid = null;
    endPan();
  }
  function movePinch() {
    var a = twoPts();
    if (a.length < 2 || !pinch.d) return;
    var d = dist(a[0], a[1]);
    var mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2;
    var m = ctm();
    if (m) {                              /* 中點移動也要跟著平移 */
      var s = vbScale(m);
      st.tx += (mx - pinch.mx) / s; st.ty += (my - pinch.my) / s;
    }
    zoomAt(st.k * (d / pinch.d), mx, my);
    pinch.d = d; pinch.mx = mx; pinch.my = my;
  }

  /* ---------- attach / detach ---------- */
  /* listener 只綁一次：.chart-wrap 不會被重畫掉，#chart 的子節點才會。
     每次 attach() 只抽換 st，否則一次重畫就疊一組 listener。 */
  function bind(wrap) {
    if (boundWrap === wrap) return;
    boundWrap = wrap;
    wrap.addEventListener('wheel', onWheel, { passive: false });
    wrap.addEventListener('pointerdown', onDown);
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerup', onUp);
    wrap.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', refresh);
  }

  /* 同一個 layer 再 attach（只是切分頁回來）就沿用縮放；換了圖才重新 initial()。 */
  function attach(wrap, o) {
    var svg = wrap && wrap.querySelector('svg');
    var layer = svg && svg.querySelector('.zoom-layer');
    if (!layer) { detach(); return false; }
    var same = !!(st && st.layer === layer && st.measured);
    var k = same ? st.k : 1, tx = same ? st.tx : 0, ty = same ? st.ty : 0;
    detach();
    opts = o || {};
    bind(wrap);
    st = { wrap: wrap, svg: svg, layer: layer, k: k, tx: tx, ty: ty, measured: same };
    if (same) refresh(); else initial();
    return true;
  }

  function detach() {
    if (st) st.wrap.classList.remove('is-panning');
    st = null; opts = {};
    panning = false; moved = false; pid = null; pts = {}; pinch = null;
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
  }

  function isPanning() { return panning; }

  /* 徹底收掉：解綁全部 listener，之後這個實例不能再用 */
  function dispose() {
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
  }

  return {
    attach: attach, detach: detach, dispose: dispose, refresh: refresh,
    fit: fit, actual: actual, zoomBy: zoomBy, step: STEP,
    isPanning: isPanning
  };
}

/* 工具列／快捷鍵的一格倍率，跟實例的 step 同值——使用端不必先有實例才能拿到 */
export var zoomStep = STEP;
