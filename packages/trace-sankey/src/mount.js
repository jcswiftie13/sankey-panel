/* mount(el, doc, opts)：把「建模 → 畫 SVG → 綁縮放 → 綁 tooltip（→ 綁高亮／點擊）」接成一個實例。
   使用端只要給一個有高度的容器（高度由使用端 CSS 決定，mount 不管）；
   尺寸變了呼叫 refresh()，資料或選項變了呼叫 update()／setMinBps()／setChannels()／setLayout()／setRoots()。

   opts（改變 model 的四個進重畫 key；改變互動的三個不重畫）：
     minBps        顯示門檻（bps），只留增量大於它的帶子；0＝不過濾
     channels      'both'（預設）／'read'／'write'：storage 資料的 read／write 帶只看其中一種；
                   被藏起來的通道併進其他輸入／其他輸出（與門檻同一套機制）。無通道的邊不受影響
     layout        'flat'（預設）／'node'：k8s node 畫成 pod 欄裡包住 pod 的外框（參考面板 Layout: Node）
     roots         參考面板的 root 選擇 {ontap_cluster,node,aggr,svm,pod}（各字串陣列）；
                   沒給＝所有 no-flow 節點都保留，給了＝只保留 root 與完全沒被邊碰到的
     pathHighlight true 時滑到卡片亮整條上下游路徑、其餘變淡（預設關）
     onNodeClick   (id, node) => void：點擊卡片的回呼。只有可定位的卡會綁（hop 除了 netapp-svm、
                   葉 pod、k8s node 外框）；namespace／application／owner／錨卡／host 葉不綁——
                   對應參考面板 Locate 的 locatable 規則
     onModel       每次 build 成功時拿到 model（使用端拼 legend／警告用）
     onError       build 失敗時拿到 errors 字串陣列（mount 不畫錯誤 UI，文案是使用端的事）
     onZoom        縮放倍率變化（螢幕實際倍率，量不到時是 null） */
import { build } from './model.js';
import { render } from './render.js';
import { createZoom } from './zoom.js';
import { createTooltip } from './tooltip.js';
import { createHighlight } from './highlight.js';

/* 參考面板的 locatable 規則：svm 在 graph 端點沒有對應節點、app／ns 是 compound 不是葉節點 */
function locatable(n) {
  if (!n) return false;
  if (n.kind === 'wrapper') return true;
  if (n.kind === 'node') return n.role !== 'netapp-svm';
  if (n.kind === 'leaf') return n.role === 'pod';
  return false;
}

export function mount(el, doc, opts) {
  opts = opts || {};
  var minBps = opts.minBps || 0;
  var channels = opts.channels || 'both';
  var layout = opts.layout === 'node' ? 'node' : 'flat';
  var roots = opts.roots || null;
  var zoom = createZoom();
  var tip = createTooltip();
  var hl = opts.pathHighlight ? createHighlight() : null;
  var chart = document.createElement('div');
  chart.className = 'chart';
  el.classList.add('trace-sankey', 'chart-wrap');
  el.appendChild(chart);

  var lastKey = null;   /* 同一份資料重畫就沿用既有 SVG，保住縮放狀態 */
  var model = null;

  function onPanStart() { tip.hide(); if (hl) hl.clear(); }

  /* 點擊回呼：可定位的卡加 .clickable（cursor:pointer）並綁 click；render 輸出不變、由這裡在 DOM 上加 */
  function bindClicks(m) {
    if (!opts.onNodeClick) return;
    var byId = {};
    (m.wrappers || []).forEach(function (w) { byId['k:' + w.id] = w; });
    Array.prototype.forEach.call(chart.querySelectorAll('g[data-n]'), function (g) {
      var id = g.getAttribute('data-n');
      var n = m.nodeMap[id] || byId['k:' + id];
      if (!locatable(n)) return;
      g.classList.add('clickable');
      g.addEventListener('click', function (ev) {
        if (zoom.isPanning()) return;
        ev.stopPropagation();
        opts.onNodeClick(id, n);
      });
    });
  }

  function update(nextDoc, o) {
    if (nextDoc !== undefined) doc = nextDoc;
    if (o && o.minBps !== undefined) minBps = o.minBps || 0;
    if (o && o.channels !== undefined) channels = o.channels || 'both';
    if (o && o.layout !== undefined) layout = o.layout === 'node' ? 'node' : 'flat';
    if (o && o.roots !== undefined) roots = o.roots || null;

    var m = build(doc, { minBps: minBps, channels: channels, layout: layout, roots: roots });
    if (!m.ok) {
      /* 圖沒了：清空、卸縮放、強迫下次重畫 */
      chart.innerHTML = '';
      zoom.detach();
      tip.hide();
      if (hl) hl.clear();
      lastKey = null;
      model = null;
      if (opts.onError) opts.onError(m.errors);
      return m;
    }
    model = m;
    if (opts.onModel) opts.onModel(m);

    /* 會改 model 的選項一定要在鍵裡，不然改了不會重畫；svg 存在檢查對應錯誤後復原的路徑 */
    var key = JSON.stringify(doc) + '\n' + minBps + '\n' + channels + '\n' + layout + '\n' + JSON.stringify(roots);
    if (key !== lastKey || !chart.querySelector('svg')) {
      chart.innerHTML = render(m);
      tip.bind(chart, zoom.isPanning);
      if (hl) hl.bind(el, m, zoom.isPanning);
      bindClicks(m);
      lastKey = key;
    }
    zoom.attach(el, { onPanStart: onPanStart, onChange: opts.onZoom });
    return m;
  }

  /* 專注模式：純 CSS（body.chart-focus），刻意不用 Fullscreen API——tooltip 掛在 body、
     容器全螢幕時會消失。套件 CSS 只負責容器本身（去框）；使用端要藏自己的 chrome 自己加規則。 */
  function focus(on) {
    document.body.classList.toggle('chart-focus', !!on);
    zoom.refresh();
  }

  function destroy() {
    zoom.dispose();
    tip.destroy();
    if (hl) hl.dispose();
    document.body.classList.remove('chart-focus');
    if (chart.parentNode) chart.parentNode.removeChild(chart);
    el.classList.remove('trace-sankey', 'chart-wrap');
    lastKey = null;
    model = null;
  }

  var inst = {
    update: update,
    setMinBps: function (n) { return update(undefined, { minBps: n }); },
    setChannels: function (c) { return update(undefined, { channels: c }); },
    setLayout: function (l) { return update(undefined, { layout: l }); },
    setRoots: function (r) { return update(undefined, { roots: r }); },
    focus: focus,
    isFocused: function () { return document.body.classList.contains('chart-focus'); },
    zoom: {
      fit: zoom.fit, actual: zoom.actual, zoomBy: zoom.zoomBy,
      refresh: zoom.refresh, step: zoom.step, isPanning: zoom.isPanning
    },
    refresh: zoom.refresh,
    destroy: destroy
  };
  /* 唯讀屬性：最近一次成功 build 的 model（失敗後是 null） */
  Object.defineProperty(inst, 'model', { get: function () { return model; } });

  update(doc);
  return inst;
}
