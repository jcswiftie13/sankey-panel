/* tooltip：帶子的 hover 高亮純靠 CSS（.band:hover），JS 只管 tooltip——
   少了要還原的顏色狀態，mouseleave 沒觸發（觸控、游標衝出視窗、拖曳吃事件）
   也不會有帶子卡在高亮色。
   tooltip 元素掛在 document.body 上（position:fixed）：掛進圖的容器會被
   overflow:hidden 裁掉。內容來源是 render 寫在每條 .band 上的 data-tip JSON。 */
import { fmtDelta } from './model.js';
import { esc } from './render.js';

export function createTooltip() {
  var tip = document.createElement('div');
  tip.className = 'trace-sankey-tooltip';
  tip.hidden = true;
  document.body.appendChild(tip);

  function hide() { tip.hidden = true; }

  /* 每次重畫 SVG 後對新的 .band 重綁；isPanning 讓拖曳中不彈 tooltip */
  function bind(container, isPanning) {
    Array.prototype.forEach.call(container.querySelectorAll('.band'), function (el) {
      /* render 在每條帶裡輸出原生 <title> 當備援（headless 產 .svg、或不接 tooltip
         時是唯一的 hover 資訊）。這裡 JS tooltip 接手了，備援留著會變成第二個
         無樣式的瀏覽器提示框——移除它，而不是叫 render 不輸出（render 輸出要
         維持 byte-identical，且殘差色塊的 <title> 沒有替代品、必須保留）。 */
      var nativeTitle = el.querySelector('title');
      if (nativeTitle) nativeTitle.parentNode.removeChild(nativeTitle);
      el.addEventListener('mouseenter', function () {
        if (isPanning && isPanning()) return;
        var d;
        try { d = JSON.parse(el.getAttribute('data-tip')); } catch (e) { return; }
        tip.innerHTML = '<b>' + esc(d.from) + ' → ' + esc(d.to) + '</b>' +
          '<div class="t-row"><span>出口 iface</span><span>' + esc(d.fi || '—') + '</span></div>' +
          '<div class="t-row"><span>入口 iface</span><span>' + esc(d.ti || '—') + '</span></div>' +
          '<div class="t-row"><span>速率增量 Δ</span><span>' + fmtDelta(d.bps) + '</span></div>' +
          (d.ns ? '<div class="t-row"><span>namespace</span><span>ns/' + esc(d.ns) + '</span></div>' : '') +
          (d.anchor ? '<div class="t-row"><span>這條是追查起點</span><span></span></div>' : '') +
          (d.backward ? '<div class="t-row"><span>回流（逆著多數流量方向）</span><span></span></div>' : '');
        tip.hidden = false;
      });
      el.addEventListener('mousemove', function (ev) {
        var w = tip.offsetWidth || 260, h = tip.offsetHeight || 90;
        tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - w - 10) + 'px';
        tip.style.top = Math.max(8, Math.min(ev.clientY + 14, window.innerHeight - h - 10)) + 'px';
      });
      el.addEventListener('mouseleave', hide);
    });
  }

  function destroy() {
    if (tip.parentNode) tip.parentNode.removeChild(tip);
  }

  return { bind: bind, hide: hide, destroy: destroy };
}
