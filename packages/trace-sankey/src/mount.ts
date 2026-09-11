/* mount(el, doc, opts)：把「建模 → 畫 SVG → 綁縮放 → 綁 tooltip」接成一個實例。
   使用端只要給一個有高度的容器（高度由使用端 CSS 決定，mount 不管）；
   尺寸變了呼叫 refresh()，資料或門檻變了呼叫 update()／setMinBps()。

   opts：
     minBps   顯示門檻（bps），只留增量大於它的帶子；0＝不過濾
     channels 'both'（預設）／'read'／'write'：storage 資料的 read／write 帶只看其中一種；
              被藏起來的通道併進其他輸入／其他輸出（與門檻同一套機制）。無通道的邊不受影響
     onModel  每次 build 成功時拿到 model（使用端拼 legend／警告用）
     onError  build 失敗時拿到 errors 字串陣列（mount 不畫錯誤 UI，文案是使用端的事）
     onZoom   縮放倍率變化（螢幕實際倍率，量不到時是 null） */
import { build } from './model/build.js';
import { render } from './static.js';   /* 過渡期：下一步 React 元件直接渲染，這支整個消失 */
import { createZoom } from './zoom.js';
import { createTooltip } from './tooltip.js';
import type { BuildOptions, Channel, TraceModel, TraceModelError, TraceModelOk } from './model/types.js';
import type { ZoomInstance } from './zoom.js';

export interface MountOptions extends BuildOptions {
  /** 每次 build 成功（拿 warnings/filtered/edges 拼圖例、統計） */
  onModel?: (model: TraceModelOk) => void;
  /** build 失敗（mount 不畫錯誤 UI，文案是使用端的事） */
  onError?: (errors: string[]) => void;
  /** 縮放倍率變化（螢幕實際倍率；量不到時 null） */
  onZoom?: (screenScale: number | null) => void;
}
export interface MountInstance {
  /** 回傳 build 結果（含 ok:false）。同 doc 同門檻同通道的重複呼叫不重畫、縮放保留。 */
  update(doc?: unknown, opts?: BuildOptions): TraceModel;
  setMinBps(minBps: number): TraceModel;
  setChannels(channels: 'both' | Channel): TraceModel;
  /** 最近一次成功 build 的 model（失敗後是 null） */
  readonly model: TraceModelOk | null;
  zoom: Pick<ZoomInstance, 'fit' | 'actual' | 'zoomBy' | 'refresh' | 'step' | 'isPanning'>;
  /** 容器尺寸變了呼叫這個 */
  refresh(): void;
  /** 冪等；解綁 listener、移除 body 上的 tooltip、清空容器 */
  destroy(): void;
}

/** 容器要先有高度再 mount（fit 用容器實際大小算）；高度由使用端 CSS 決定 */
export function mount(el: HTMLElement, doc: unknown, o?: MountOptions): MountInstance {
  var opts: MountOptions = o || {};
  var minBps: number = opts.minBps || 0;
  var channels: 'both' | Channel = opts.channels || 'both';
  var zoom = createZoom();
  var tip = createTooltip();
  var chart = document.createElement('div');
  chart.className = 'chart';
  el.classList.add('trace-sankey', 'chart-wrap');
  el.appendChild(chart);

  var lastKey: string | null = null;   /* 同一份資料重畫就沿用既有 SVG，保住縮放狀態 */
  var model: TraceModelOk | null = null;

  function update(nextDoc?: unknown, o?: BuildOptions): TraceModel {
    if (nextDoc !== undefined) doc = nextDoc;
    if (o && o.minBps !== undefined) minBps = o.minBps || 0;
    if (o && o.channels !== undefined) channels = o.channels || 'both';

    var m = build(doc, { minBps: minBps, channels: channels });
    if (!m.ok) {
      /* 圖沒了：清空、卸縮放、強迫下次重畫 */
      chart.innerHTML = '';
      zoom.detach();
      tip.hide();
      lastKey = null;
      model = null;
      if (opts.onError) opts.onError((m as TraceModelError).errors);
      return m;
    }
    model = m;
    if (opts.onModel) opts.onModel(m);

    /* 門檻與通道一定要在鍵裡，不然改了不會重畫；svg 存在檢查對應錯誤後復原的路徑 */
    var key = JSON.stringify(doc) + '\n' + minBps + '\n' + channels;
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

  var inst: MountInstance = {
    update: update,
    setMinBps: function (n: number) { return update(undefined, { minBps: n }); },
    setChannels: function (c: 'both' | Channel) { return update(undefined, { channels: c }); },
    zoom: {
      fit: zoom.fit, actual: zoom.actual, zoomBy: zoom.zoomBy,
      refresh: zoom.refresh, step: zoom.step, isPanning: zoom.isPanning
    },
    refresh: zoom.refresh,
    destroy: destroy,
    model: null
  };
  /* 唯讀屬性：最近一次成功 build 的 model（失敗後是 null） */
  Object.defineProperty(inst, 'model', { get: function () { return model; } });

  update(doc);
  return inst;
}
