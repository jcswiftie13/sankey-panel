/* tooltip：帶子的 hover 高亮純靠 CSS（.band:hover），JS 只管 tooltip——
   少了要還原的顏色狀態，mouseleave 沒觸發（觸控、游標衝出視窗、拖曳吃事件）
   也不會有帶子卡在高亮色。
   tooltip 元素掛在 document.body 上（position:fixed）：掛進圖的容器會被
   overflow:hidden 裁掉。內容來源是 render 寫在每條 .band 與每張卡的 <g> 上的 data-tip JSON：
   帶子是 {from,to,fi,ti,bps,...}、節點是 {node:1,title,rows:[[k,v],...]}（render 已格式化好）。 */
import { fmtRate, fmtBytes } from './model.js';
import { esc } from './render.js';

function row(k, v) { return '<div class="t-row"><span>' + esc(k) + '</span><span>' + esc(v) + '</span></div>'; }

function bandHtml(d) {
  var isBytes = d.unit === 'bytesPerSec';
  var h = '<b>' + esc(d.from) + ' → ' + esc(d.to) + '</b>' +
    row('出口 iface', d.fi || '—') +
    row('入口 iface', d.ti || '—') +
    /* delta_bps 是「速率的差」；bytes/s 是絕對速率，標籤跟著換。
       歸屬線的 bps 是 0，那不是「零流量」而是「沒有量」——印出來就是憑空生一個值 */
    (d.owns ? '' :
      row(isBytes ? '速率' + (d.channel ? '（' + d.channel + '）' : '') : '速率增量 Δ', fmtRate(d.bps, d.unit))) +
    (d.channel ? row('channel', d.channel) : '') +
    (d.ns ? row('namespace', 'ns/' + d.ns) : '') +
    /* 無鄰居 port 上查到的 client：一筆直接印，多筆印數量與清單（完整欄位在卡片的 tooltip） */
    (d.clients ? row('client', d.clients.length === 1 ? d.clients[0]
      : d.clients.length + ' 個：' + d.clients.join(' · ')) : '') +
    /* 歸屬線：這個 port 上還有別人（或查不到 owner）的機器，量停在 port——
       拆開就是攤分推估，我們不做 */
    (d.owns ? row('歸屬', '這個 port 上還有別人的機器，量停在 port（不攤分）') : '') +
    (d.tier ? row('tier', d.tier) : '') +
    /* 推導邊：不是後端量的一條 flow，而是同一筆量測重新分組。pod→app→ns 有欄對 tier，
       值是成員 pod 入邊的加總；owner 邊沒有 tier，值是整張 port 卡的量歸到這個 owner */
    (d.derived && !d.owns ? row('來源', d.tier ? '成員 pod 加總（推導值）' : 'port 卡的量歸到 owner（推導值）') : '') +
    (d.attr ? row('attribution', d.attr === 'split' ? 'split（平均攤分的估計值）' : d.attr) : '') +
    (d.anchor ? row('這條是追查起點', '') : '') +
    (d.backward ? row('回流（逆著多數流量方向）', '') : '');
  var x = d.extra || {};
  if (x.read_ops != null || x.write_ops != null) {
    h += row('IOPS（read / write）', (x.read_ops != null ? x.read_ops : '—') + ' / ' + (x.write_ops != null ? x.write_ops : '—'));
  }
  if (x.read_latency_us != null) h += row('read 延遲', x.read_latency_us + ' µs');
  if (x.write_latency_us != null) h += row('write 延遲', x.write_latency_us + ' µs');
  if (x.max_iops != null) h += row('QoS 上限', x.max_iops + ' IOPS');
  if (x.max_bytes_per_sec != null) h += row('QoS 上限', fmtBytes(x.max_bytes_per_sec) + '/s');
  return h;
}

function nodeHtml(d) {
  var h = '<b>' + esc(d.title) + '</b>';
  (d.rows || []).forEach(function (r) { h += row(r[0], r[1]); });
  return h;
}

export function createTooltip() {
  var tip = document.createElement('div');
  tip.className = 'trace-sankey-tooltip';
  tip.hidden = true;
  document.body.appendChild(tip);

  function hide() { tip.hidden = true; }

  /* 每次重畫 SVG 後對新的 .band 與帶 data-tip 的卡片 <g> 重綁；isPanning 讓拖曳中不彈 tooltip */
  function bind(container, isPanning) {
    Array.prototype.forEach.call(container.querySelectorAll('.band, g[data-tip]'), function (el) {
      /* render 在每條帶裡輸出原生 <title> 當備援（headless 產 .svg、或不接 tooltip
         時是唯一的 hover 資訊）。這裡 JS tooltip 接手了，備援留著會變成第二個
         無樣式的瀏覽器提示框——移除它，而不是叫 render 不輸出（render 輸出要
         維持 byte-identical，且殘差色塊的 <title> 沒有替代品、必須保留）。
         卡片的 <g> 沒有 <title>，這段對它是 no-op。 */
      var nativeTitle = el.querySelector(':scope > title');
      if (nativeTitle) nativeTitle.parentNode.removeChild(nativeTitle);
      el.addEventListener('mouseenter', function () {
        if (isPanning && isPanning()) return;
        var d;
        try { d = JSON.parse(el.getAttribute('data-tip')); } catch (e) { return; }
        tip.innerHTML = d.node ? nodeHtml(d) : bandHtml(d);
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
