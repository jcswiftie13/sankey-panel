/* mount(el, doc, opts)：把「建模 → 畫 SVG → 綁縮放 → 綁 tooltip」接成一個實例。
   使用端只要給一個有高度的容器（高度由使用端 CSS 決定，mount 不管）；
   尺寸變了呼叫 refresh()，資料或門檻變了呼叫 update()／setMinBps()。

   opts：
     minBps   顯示門檻（bps），只留增量大於它的帶子；0＝不過濾
     onModel  每次 build 成功時拿到 model（使用端拼 legend／警告用）
     onError  build 失敗時拿到 errors 字串陣列（mount 不畫錯誤 UI，文案是使用端的事）
     onZoom   縮放倍率變化（螢幕實際倍率，量不到時是 null） */
import { build } from './model.js';
import { render } from './render.js';
import { createZoom } from './zoom.js';
import { createTooltip } from './tooltip.js';

export function mount(el, doc, opts) {
  opts = opts || {};
  var minBps = opts.minBps || 0;
  var zoom = createZoom();
  var tip = createTooltip();
  var chart = document.createElement('div');
  chart.className = 'chart';
  el.classList.add('trace-sankey', 'chart-wrap');
  el.appendChild(chart);

  var lastKey = null;   /* 同一份資料重畫就沿用既有 SVG，保住縮放狀態 */
  var model = null;

  function update(nextDoc, o) {
    if (nextDoc !== undefined) doc = nextDoc;
    if (o && o.minBps !== undefined) minBps = o.minBps || 0;

    var m = build(doc, { minBps: minBps });
    if (!m.ok) {
      /* 圖沒了：清空、卸縮放、強迫下次重畫 */
      chart.innerHTML = '';
      zoom.detach();
      tip.hide();
      lastKey = null;
      model = null;
      if (opts.onError) opts.onError(m.errors);
      return m;
    }
    model = m;
    if (opts.onModel) opts.onModel(m);

    /* 門檻一定要在鍵裡，不然改門檻不會重畫；svg 存在檢查對應錯誤後復原的路徑 */
    var key = JSON.stringify(doc) + '\n' + minBps;
    if (key !== lastKey || !chart.querySelector('svg')) {
      chart.innerHTML = render(m);
      tip.bind(chart, zoom.isPanning);
      lastKey = key;
    }
    zoom.attach(el, { onPanStart: tip.hide, onChange: opts.onZoom });
    return m;
  }

  function destroy() {
    zoom.dispose();
    tip.destroy();
    if (chart.parentNode) chart.parentNode.removeChild(chart);
    el.classList.remove('trace-sankey', 'chart-wrap');
    lastKey = null;
    model = null;
  }

  var inst = {
    update: update,
    setMinBps: function (n) { return update(undefined, { minBps: n }); },
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
