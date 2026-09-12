/* 路徑高亮（參考面板的 hover path highlight，選項 pathHighlight 打開才綁）：
   滑到一張卡片，往上游沿 inEdges、往下游沿 outEdges（穿過推導邊與歸屬線）走到底，
   路徑上的帶與卡片加 .lit、容器加 .hl-on，其餘由 CSS 變淡。k8s node 外框取成員 pod 路徑的聯集。

   狀態只在 class 上、樣式全在 CSS——跟帶子的 :hover 高亮同一個理由（4a752b9）：
   mouseleave 沒觸發（游標衝出視窗、觸控中斷、拖曳吃事件）也不會有東西卡在高亮。
   額外在容器 pointerleave 與拖曳開始時清一次，保險。

   DOM ↔ model 的對應靠 render 輸出的 data-e（model.edges 索引）與 data-n（節點／外框 id），
   不靠 DOM 順序。 */
export function createHighlight() {
  var container = null, bands = [], cards = {}, model = null, lit = false;

  function clear() {
    if (!lit || !container) return;
    container.classList.remove('hl-on');
    Array.prototype.forEach.call(container.querySelectorAll('.lit'), function (el) { el.classList.remove('lit'); });
    lit = false;
  }

  /* 從一組起點節點沿兩個方向走到底，回傳 { edges: {index:true}, nodes: {id:true} } */
  function pathOf(startIds) {
    var edgeIdx = new Map();
    model.edges.forEach(function (e, i) { edgeIdx.set(e, i); });
    var es = {}, ns = {};
    function walk(id, key, next) {
      var stack = [id], seen = {};
      seen['k:' + id] = true;
      while (stack.length) {
        var n = model.nodeMap[stack.pop()];
        if (!n) continue;
        ns['k:' + n.id] = true;
        n[key].forEach(function (e) {
          es[edgeIdx.get(e)] = true;
          var to = next(e);
          if (!seen['k:' + to]) { seen['k:' + to] = true; stack.push(to); }
        });
      }
    }
    startIds.forEach(function (id) {
      walk(id, 'inEdges', function (e) { return e.fromId; });
      walk(id, 'outEdges', function (e) { return e.toId; });
    });
    return { edges: es, nodes: ns };
  }

  function show(id) {
    var wrapper = null;
    (model.wrappers || []).forEach(function (w) { if (w.id === id) wrapper = w; });
    var starts = wrapper ? wrapper.podIds : [id];
    if (!starts.length) return;               /* 空外框：沒有路徑可亮 */
    var p = pathOf(starts);
    clear();
    Object.keys(p.edges).forEach(function (i) { if (bands[i]) bands[i].classList.add('lit'); });
    Object.keys(p.nodes).forEach(function (k) { var el = cards[k]; if (el) el.classList.add('lit'); });
    if (wrapper && cards['k:' + id]) cards['k:' + id].classList.add('lit');
    container.classList.add('hl-on');
    lit = true;
  }

  /* 每次重畫 SVG 後重綁；isPanning 讓拖曳中不觸發 */
  function bind(el, m, isPanning) {
    clear();
    container = el; model = m; bands = []; cards = {};
    Array.prototype.forEach.call(el.querySelectorAll('.band[data-e]'), function (b) {
      bands[Number(b.getAttribute('data-e'))] = b;
    });
    Array.prototype.forEach.call(el.querySelectorAll('g[data-n]'), function (g) {
      var id = g.getAttribute('data-n');
      cards['k:' + id] = g;
      g.addEventListener('mouseenter', function () {
        if (isPanning && isPanning()) return;
        show(id);
      });
      g.addEventListener('mouseleave', clear);
    });
    if (!el.__hlLeave) {
      el.__hlLeave = true;
      el.addEventListener('pointerleave', clear);
    }
  }

  function dispose() {
    clear();
    if (container && container.__hlLeave) {
      container.removeEventListener('pointerleave', clear);
      container.__hlLeave = false;
    }
    container = null; model = null; bands = []; cards = {};
  }

  return { bind: bind, clear: clear, dispose: dispose };
}
