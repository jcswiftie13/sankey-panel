/* SVG Sankey 繪製：青帶＝已追查（storage 資料的 read 通道同色、write 通道燃橘）、
   殘差＝盒子外側與帶寬等比的虛線色塊、終止＝灰虛線小卡。
   帶上的數字一律是實際量測值，沒有推估值；單位跟著邊（bps 帶 + 號、bytes/s 不帶）。 */
import { fmtBps as F, fmtDelta as D, fmtRate as R, fmtAmount as A, fmtBytes, TYPE_LABEL } from './model.js';

var NODE_W = 208, LEAF_W = 178, ANCHOR_W = 152;
var HEADER_H = 36, ROW_H = 24, ROW_GAP = 9, BODY_PAD = 12, BODY_MIN = 26;
var COL_GAP = 218, VGAP = 34;
var PAD_TOP = 46, PAD_BOTTOM = 26, PAD_SIDE = 122;
var THICK_MAX = 86, THICK_MIN = 3;
/* 歸屬線的線寬：不帶量，不能照 thick() 佔一般帶的視覺重量；
   但 fill:none 的帶 hover 判定就是 stroke-width，太細會點不到 */
var OWN_T = 2.4;
var RES_LEN = 34, RES_GAP = 8;   /* 高度改用 thick()，不再有固定的 RES_H／RES_PAD */

/* namespace 色盤：依「首次出現順序」配色、超過就循環。不用 hash——色盤只有 5 色，
   hash 撞色不可控，相鄰兩組同色比跨檔案顏色不穩更傷可讀性；出現順序在同一份 JSON
   裡是確定的，與 tier 先到先贏同一套哲學。刻意避開語意色：青（追查）、琥珀（其他入）、
   玫瑰（其他出）、灰（葉）、#7dd3fc 天藍（k8s node 框）。 */
var NS_COLORS = ['#a78bfa', '#34d399', '#facc15', '#60a5fa', '#f472b6'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* SVG 沒有 text-overflow，長字串會直接戳出卡外：卡面文字自己截。
   以半形 1、CJK（含全形標點）2 估寬——不精確，但 .leaf-sub 是等寬感的 10px 小字，
   估寬夠用且不必量 DOM（render() 必須是純函式、Node 也要能跑）。完整值一律進 tooltip。 */
function clip(s, budget) {
  s = String(s == null ? '' : s);
  var w = 0, i = 0;
  for (; i < s.length; i++) {
    w += s.charCodeAt(i) > 0x2e7f ? 2 : 1;
    if (w > budget) return s.slice(0, i) + '…';
  }
  return s;
}

/* 葉卡上的 client 表格：一列一台、全部列出，欄位對齊並印表頭。
   欄寬以「半形 1、CJK 2」的估寬單位換算（.leaf-sub 是 10px，實測 5.09～5.12px 一個半形單位，
   取 5.15 留餘裕）。**欄寬要容得下 budget + 1 個單位**——clip() 截斷後還會再補一個 '…'，
   照 budget 抓欄寬會讓最長的那格戳進欄距（實測 24 單位的 hostname 截完是 127px、欄寬只有 123px）。
   ip 欄要放得下完整的 IPv4（255.255.255.255 ＝ 15 單位）才不會把位址截掉。
   某一欄所有 client 都沒值就整欄不畫，卡也跟著窄——只有一個 IP 的 port 不該撐成一張大表。 */
var CLIENT_COLS = [
  { key: 'hostname', budget: 24, w: 130 },
  { key: 'ip', budget: 16, w: 90 },
  { key: 'owner', budget: 18, w: 100 }
];
var CLIENT_GAP = 10, CLIENT_PAD = 12;
function clientCols(n) {
  var cs = n.clients;
  if (!cs || !cs.length) return [];
  return CLIENT_COLS.filter(function (col) {
    return cs.some(function (c) { return c[col.key]; });
  });
}
/* 卡寬：欄寬總和＋欄距＋左右 padding，並以 LEAF_W 為下限（只有 ip 一欄時不要變成細長條） */
function clientW(n) {
  /* owner 是自由字串（部門＋姓名＋分機都可能在裡面），LEAF_W 截得太兇。
     欄寬下限本來就是 NODE_W，加寬到這個值不會把後面的欄推開。 */
  if (n.role === 'owner') return NODE_W;
  var cols = clientCols(n);
  if (!cols.length) return LEAF_W;
  var w = CLIENT_PAD * 2 + CLIENT_GAP * (cols.length - 1);
  cols.forEach(function (col) { w += col.w; });
  return Math.max(LEAF_W, w);
}
/* 一列一台，每格各自截斷；沒有值的格子留空（不要補「—」，空白本身就讀得出來） */
function clientRows(n) {
  var cols = clientCols(n);
  if (!cols.length) return [];
  return n.clients.map(function (c) {
    return cols.map(function (col) { return c[col.key] ? clip(c[col.key], col.budget) : ''; });
  });
}

/* 帶 namespace 的葉多一行資訊（ns 標示），卡要高一階；沒 ns 的 pod 跟一般葉一樣高。
   有 clients 時多的是：name 那行（只有真的給了 name 才有）、表頭一行、每台一行。
   沒有 clients 時回傳值與舊版完全相同。 */
function leafH(n) {
  if (n.role === 'owner') return 84;      /* 量一行、台數／port 數一行 */
  var cols = clientCols(n);
  if (!cols.length) return n.namespace ? 80 : 70;
  return 70 + (n.namespace ? 14 : 0) + (n.named ? 14 : 0) + 14 + n.clients.length * 14;
}

/* hop 盒的標題區高度：有 usage 副標（兩欄都在才畫）就多一行 */
function hasUsage(n) { return !!(n.usage && n.usage.used_bytes != null && n.usage.capacity_bytes != null); }
function headerH(n) { return HEADER_H + (hasUsage(n) ? 12 : 0); }
/* 非 switch 的設備型別（k8s node／pod、netapp 三型別）畫虛線框；pvc／app／ns 實線，與參考面板一致 */
var DEVICE_TYPES = ['node', 'pod', 'netapp-node', 'netapp-aggr', 'netapp-svm'];
/* 三色都上框（參考面板：有 status 就以 status 框，normal 也是一個判定）；沒有 status 維持中性框 */
var STATUS_COLOR = { critical: '#fb7185', warning: '#f59e0b', normal: '#34d399' };

/* 殘差門檻用 model 算好的 resEps：小於 counter 浮點雜訊的殘差不畫，也不佔版面。
   注意這是「相對這台自己流量」的判斷，粗細卻是全圖 maxVal 的比例——
   小 hop 的真殘差可能過得了門檻但只有 THICK_MIN 這麼細，那是對的。 */
function resIn(n) { return n.kind === 'node' && n.otherIn > (n.resEps || 0) ? n.otherIn : 0; }
function resOut(n) { return n.kind === 'node' && n.otherOut > (n.resEps || 0) ? n.otherOut : 0; }

function layout(model) {
  var nodes = model.nodes, edges = model.edges;

  /* namespace → 顏色：掃節點（葉與 hop 級 ns 都算）依首次出現順序取色 */
  var nsColor = {};
  nodes.forEach(function (n) {
    if (n.namespace && nsColor[n.namespace] == null) {
      nsColor[n.namespace] = NS_COLORS[Object.keys(nsColor).length % NS_COLORS.length];
    }
  });

  /* 殘差跟青帶共用同一把比例尺，比例才讀得出來。殘差比所有邊都大時青帶會變細，
     那正是「沒追到的佔大多數」該有的觀感。 */
  var maxVal = 0;
  edges.forEach(function (e) { maxVal = Math.max(maxVal, e.bps); });
  nodes.forEach(function (n) { maxVal = Math.max(maxVal, resIn(n), resOut(n)); });
  if (maxVal <= 0) maxVal = 1;
  var scale = THICK_MAX / maxVal;
  var thick = function (v) { return Math.max(THICK_MIN, v * scale); };

  /* 每條邊的視覺厚度。歸屬線（owns）沒有量測值、bps 恆 0，照 thick() 會拿到 THICK_MIN
     的實心帶，讀起來像一條很小的流量——固定給一條細線，語意上才是「只有歸屬、沒有量」。
     其餘邊 __t === thick(e.bps)，沒有 owner 層的圖槽位逐 byte 不變。 */
  edges.forEach(function (e) { e.__t = e.owns ? OWN_T : thick(e.bps); });

  /* 只跨一欄的回流：兩欄之間的走廊共用、中間沒有盒子，port 掛相向的邊緣
     （source 左緣、target 右緣）就能整條畫在走廊裡，跟一般帶一樣短。
     跨兩欄以上的才需要繞圖底外圈。 */
  edges.forEach(function (e) {
    e.backNear = !!e.backward &&
      model.nodeMap[e.fromId].col - model.nodeMap[e.toId].col === 1;
  });

  /* 每個節點的 port 槽位。橫向邊（同 tier 同欄互連）兩端都掛右側：
     弧帶整條活在欄右側的間隙，受端若從左邊進就得繞過整個盒子。 */
  nodes.forEach(function (n) {
    /* 相鄰欄回流（backNear）：out 掛 source 左緣、in 掛 target 右緣（相向），
       槽位排最後（殘差之前）。跨多欄的回流維持 in 左緣、out 右緣、也排最後：
       迴路帶從盒子疊的最下方出入，往下繞出圖外時才不會跨過自己的其他帶。 */
    n.leftSlots = n.inEdges.filter(function (e) { return !e.lateral && !e.backward; }).map(function (e) {
      return { edge: e, role: 'in', iface: e.toIface, t: e.__t };
    }).concat(n.inEdges.filter(function (e) { return e.backward && !e.backNear; }).map(function (e) {
      return { edge: e, role: 'in', iface: e.toIface, t: e.__t };
    })).concat(n.outEdges.filter(function (e) { return e.backNear; }).map(function (e) {
      return { edge: e, role: 'back-out', iface: e.fromIface, t: e.__t };
    }));
    n.rightSlots = n.outEdges.filter(function (e) { return !e.lateral && !e.backward; }).map(function (e) {
      return { edge: e, role: 'out', iface: e.fromIface, t: e.__t };
    }).concat(n.outEdges.filter(function (e) { return e.lateral; }).map(function (e) {
      return { edge: e, role: 'lat-out', iface: e.fromIface, t: e.__t };
    })).concat(n.inEdges.filter(function (e) { return e.lateral; }).map(function (e) {
      return { edge: e, role: 'lat-in', iface: e.toIface, t: e.__t };
    })).concat(n.inEdges.filter(function (e) { return e.backNear; }).map(function (e) {
      return { edge: e, role: 'back-in', iface: e.toIface, t: e.__t };
    })).concat(n.outEdges.filter(function (e) { return e.backward && !e.backNear; }).map(function (e) {
      return { edge: e, role: 'out', iface: e.fromIface, t: e.__t };
    }));
    /* 殘差是真的槽位，排在已追查 port 之後（最外側），才會跟它們一起被 place() 置中。
       放最外側而不是插在中間：place() 依順序指派 cy，插中間會把下面所有帶子往下推、
       憑空製造交叉。 */
    var ri = resIn(n), ro = resOut(n);
    if (ri) n.leftSlots.push({ res: 'in', bps: ri, t: thick(ri) });
    if (ro) n.rightSlots.push({ res: 'out', bps: ro, t: thick(ro) });

    var lh = stackH(n.leftSlots), rh = stackH(n.rightSlots);
    if (n.kind === 'node') {
      n.w = NODE_W;
      n.h = headerH(n) + Math.max(lh, rh, BODY_MIN) + BODY_PAD;
    } else if (n.kind === 'leaf') {
      n.w = clientW(n); n.h = Math.max(leafH(n), lh, rh);
    } else {
      n.w = ANCHOR_W; n.h = Math.max(66, lh, rh);
    }
  });

  /* 欄位 x */
  var cols = [];
  nodes.forEach(function (n) { (cols[n.col] = cols[n.col] || []).push(n); });
  var x = PAD_SIDE, colX = [];
  for (var c = 0; c < cols.length; c++) {
    var list = cols[c] || [];
    var w = list.reduce(function (m, n) { return Math.max(m, n.w); }, NODE_W);
    colX[c] = x;
    list.forEach(function (n) { n.x = x; });
    x += w + COL_GAP;
  }
  var totalW = x - COL_GAP + PAD_SIDE;

  /* 欄位 y：先照上游中心排序，再整欄對齊上游重心 */
  for (var ci = 0; ci < cols.length; ci++) {
    var col = cols[ci] || [];
    col.forEach(function (n, i) {
      var parents = n.inEdges.filter(function (e) {
        var p = model.nodeMap[e.fromId];
        return p.col < n.col && typeof p.__cy === 'number';
      });
      n.__hasXParent = parents.length > 0;
      n.__pref = parents.length
        ? parents.reduce(function (s, e) { return s + model.nodeMap[e.fromId].__cy; }, 0) / parents.length
        : i * 1e-3;
      n.__ord = i;
    });
    /* 只被同欄餵的節點（如 dci）沒有跨欄父節點：__pref 繼承橫向上游，
       平手時再靠 subOrder 落在生產者與消費者之間。照 subOrder 走可沿鏈傳遞。 */
    col.slice().sort(function (a, b) { return (a.subOrder || 0) - (b.subOrder || 0); })
      .forEach(function (n) {
        if (n.__hasXParent) return;
        var lat = n.inEdges.filter(function (e) { return e.lateral; });
        if (lat.length) {
          n.__pref = lat.reduce(function (s, e) { return s + model.nodeMap[e.fromId].__pref; }, 0) / lat.length;
        }
      });
    /* pod 葉依 namespace 分組：同 ns 的 pod 共用「組平均 __pref」當第一排序鍵，
       整組相鄰排列；組間平手再用 ns 首次出現序拆。組內仍照各自 __pref（上游重心），
       跨 node 的同 ns pod 相鄰但各自貼近自己的上游。只有帶 ns 的 pod 葉會設
       __nsPref——沒有 pod 的圖兩個新鍵全空，比較器退化成原本的三鍵，輸出不變。
       注意 source 模式 pod 在第 0 欄沒有跨欄上游、__pref 是輸入順序：分組照文件順序聚攏。 */
    var nsAgg = {}, nsSeq = 0;
    col.forEach(function (n) {
      n.__nsPref = null; n.__nsIdx = 0;
      if (n.kind !== 'leaf' || n.role !== 'pod' || !n.namespace) return;
      var a = nsAgg[n.namespace] || (nsAgg[n.namespace] = { s: 0, c: 0, idx: ++nsSeq });
      a.s += n.__pref; a.c++;
    });
    col.forEach(function (n) {
      if (n.kind !== 'leaf' || n.role !== 'pod' || !n.namespace) return;
      var a = nsAgg[n.namespace];
      n.__nsPref = a.s / a.c;
      n.__nsIdx = a.idx;
    });
    col.sort(function (a, b) {
      var ka = a.__nsPref != null ? a.__nsPref : a.__pref;
      var kb = b.__nsPref != null ? b.__nsPref : b.__pref;
      return (ka - kb) || (a.__nsIdx - b.__nsIdx) || (a.__pref - b.__pref) ||
        ((a.subOrder || 0) - (b.subOrder || 0)) || (a.__ord - b.__ord);
    });
    var y = 0;
    col.forEach(function (n) { n.y = y; y += n.h + VGAP; });
    var blockH = Math.max(0, y - VGAP);
    var prefAvg = col.reduce(function (s, n) { return s + n.__pref; }, 0) / (col.length || 1);
    var shift = col.length && ci > 0 ? (prefAvg - blockH / 2) : 0;
    col.forEach(function (n) {
      n.y += shift;
      n.__cy = n.y + n.h / 2;
    });
  }

  /* 正規化 y（空模型：沒有 investigation 的圖被門檻濾光時，minY/maxY 給 0 免得算出 NaN viewBox） */
  var minY = nodes.length ? Infinity : 0, maxY = nodes.length ? -Infinity : 0;
  nodes.forEach(function (n) { minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y + n.h); });
  var dy = PAD_TOP - minY;
  nodes.forEach(function (n) { n.y += dy; n.__cy = n.y + n.h / 2; });
  var totalH = (maxY + dy) + PAD_BOTTOM;

  /* pod 依 ns 分組後，欄內順序可能偏離 hop 上 port 的宣告順序，帶子會互穿。
     把「對端是帶 ns 的 pod 葉」的槽位依對端的 y 重排（寫回原本的索引位置，
     其他槽位含殘差槽原地不動）——只有 pod 葉邊會被重排，非 k8s 圖槽位順序逐 byte 不變。
     ns 終點也要重排：多台 node 的 pod 匯進同一個 ns，匯流帶照 pod 的 y 排才不互穿。 */
  function farOf(sl) { return model.nodeMap[sl.role === 'in' ? sl.edge.fromId : sl.edge.toId]; }
  /* 依對端的 y 重排 want() 挑中的槽位，寫回原本的索引位置——其他槽位（含殘差槽）原地不動 */
  function reorderSlots(slots, want) {
    var idxs = [];
    slots.forEach(function (sl, i) {
      if (!sl.edge || sl.edge.lateral || sl.edge.backward) return;
      if (want(farOf(sl))) idxs.push(i);
    });
    if (idxs.length < 2) return;
    var picked = idxs.map(function (i) { return slots[i]; });
    picked.sort(function (a, b) { return farOf(a).y - farOf(b).y; });
    idxs.forEach(function (i, k) { slots[i] = picked[k]; });
  }
  nodes.forEach(function (n) {
    if (n.kind !== 'node' && n.role !== 'ns' && n.role !== 'app') return;
    [n.leftSlots, n.rightSlots].forEach(function (slots) {
      reorderSlots(slots, function (f) { return f.kind === 'leaf' && f.role === 'pod' && f.namespace; });
    });
  });
  /* owner 層同理，而且更嚴重：port 葉的出邊順序是 clients 的出現順序、owner 卡的入邊順序是
     建邊順序，兩者都跟對端的 y 無關——一張 port 掛五個 owner 時歸屬線會整束交叉。
     兩端都依對端 y 重排。沒有 owner 層的圖不進這個迴圈，槽位順序逐 byte 不變。 */
  nodes.forEach(function (n) {
    if (!n.ownerLinked && n.role !== 'owner') return;
    [n.leftSlots, n.rightSlots].forEach(function (slots) {
      reorderSlots(slots, function (f) { return n.role === 'owner' || f.role === 'owner'; });
    });
  });

  /* port 中心點 */
  nodes.forEach(function (n) {
    var top = n.kind === 'node' ? n.y + headerH(n) : n.y;
    var avail = n.kind === 'node' ? n.h - headerH(n) - BODY_PAD : n.h;
    place(n.leftSlots, top, avail);
    place(n.rightSlots, top, avail);
    n.leftSlots.forEach(function (s) {
      if (!s.edge) return;                       /* 殘差槽沒有 edge */
      if (s.role === 'back-out') { s.edge.x1 = n.x; s.edge.y1 = s.cy; s.edge.t1 = s.t; }
      else { s.edge.x2 = n.x; s.edge.y2 = s.cy; s.edge.t2 = s.t; }
    });
    n.rightSlots.forEach(function (s) {
      if (!s.edge) return;
      if (s.role === 'lat-in' || s.role === 'back-in') { s.edge.x2 = n.x + n.w; s.edge.y2 = s.cy; s.edge.t2 = s.t; }
      else { s.edge.x1 = n.x + n.w; s.edge.y1 = s.cy; s.edge.t1 = s.t; }
    });
  });

  /* 橫向弧帶的凸出量：跨距短的在內圈、長的在外圈，弧才不會互相穿過 */
  var latByCol = {};
  edges.forEach(function (e) {
    if (!e.lateral) return;
    var c = model.nodeMap[e.fromId].col;
    (latByCol[c] = latByCol[c] || []).push(e);
  });
  Object.keys(latByCol).forEach(function (c) {
    latByCol[c].sort(function (a, b) {
      return Math.abs(a.y2 - a.y1) - Math.abs(b.y2 - b.y1);
    });
    latByCol[c].forEach(function (e, i) {
      e.bulge = Math.min(56 + (e.t1 + e.t2) / 2 * 0.67 + 18 * i, COL_GAP - 26);
    });
  });

  /* 回流帶：繞經圖底下方外圍的等寬迴路。source 欄右側走廊下潛、貼圖底水平走、
     target 欄左側走廊上浮。逐條分 lane 往下疊，垂直段水平錯位，互不重疊。 */
  var backs = edges.filter(function (e) { return e.backward && !e.backNear; });
  backs.sort(function (a, b) {
    return (model.nodeMap[b.fromId].col - model.nodeMap[a.fromId].col) || (b.bps - a.bps);
  });
  var backY = totalH - PAD_BOTTOM + 40;
  backs.forEach(function (e, i) {
    e.backT = Math.max(e.t1, e.t2);
    e.backY = backY + e.backT / 2;
    e.backXD = e.x1 + COL_GAP - 30 - i * 14;
    e.backXU = Math.max(8, e.x2 - 26 - i * 14);
    backY += e.backT + 16;
  });
  if (backs.length) totalH = backY - 16 + PAD_BOTTOM;

  return { cols: cols, colX: colX, width: totalW, height: Math.max(totalH, 220), thick: thick, nsColor: nsColor };

  function stackH(slots) {
    if (!slots.length) return 0;
    return slots.reduce(function (s, x) { return s + Math.max(x.t, ROW_H); }, 0) + (slots.length - 1) * ROW_GAP;
  }
  function place(slots, top, avail) {
    var h = stackH(slots);
    var cur = top + Math.max(0, (avail - h) / 2);
    slots.forEach(function (s) {
      var sh = Math.max(s.t, ROW_H);
      s.cy = cur + sh / 2;
      cur += sh + ROW_GAP;
    });
  }
}

function ribbon(e) {
  var mx = (e.x1 + e.x2) / 2;
  var a = e.t1 / 2, b = e.t2 / 2;
  return 'M' + e.x1 + ',' + (e.y1 - a) +
    ' C' + mx + ',' + (e.y1 - a) + ' ' + mx + ',' + (e.y2 - b) + ' ' + e.x2 + ',' + (e.y2 - b) +
    ' L' + e.x2 + ',' + (e.y2 + b) +
    ' C' + mx + ',' + (e.y2 + b) + ' ' + mx + ',' + (e.y1 + a) + ' ' + e.x1 + ',' + (e.y1 + a) + ' Z';
}

/* 歸屬線：ribbon() 的中線版本。fill 是 none、靠 stroke 畫，比照回流的 band-loop——
   帶狀路徑沒辦法畫成虛線，而虛線正是「這條沒有量」的視覺記號。 */
function ownLine(e) {
  var mx = (e.x1 + e.x2) / 2;
  return 'M' + e.x1 + ',' + e.y1 + ' C' + mx + ',' + e.y1 + ' ' + mx + ',' + e.y2 + ' ' + e.x2 + ',' + e.y2;
}

/* 同欄互連：兩端都在欄右緣的馬蹄形弧帶，往右凸 B 再折回。
   外緣接兩端「遠離中線」的邊界、內緣接近側，弧頂寬度才會 ≈ 平均帶寬。 */
function lateralRibbon(e, B) {
  var a = e.t1 / 2, b = e.t2 / 2;
  var s = e.y2 >= e.y1 ? 1 : -1;
  var k = (a + b) * 0.67, Bo = B + k, Bi = Math.max(8, B - k);
  return 'M' + e.x1 + ',' + (e.y1 - s * a) +
    ' C' + (e.x1 + Bo) + ',' + (e.y1 - s * a) + ' ' + (e.x2 + Bo) + ',' + (e.y2 + s * b) +
    ' ' + e.x2 + ',' + (e.y2 + s * b) +
    ' L' + e.x2 + ',' + (e.y2 - s * b) +
    ' C' + (e.x2 + Bi) + ',' + (e.y2 - s * b) + ' ' + (e.x1 + Bi) + ',' + (e.y1 + s * a) +
    ' ' + e.x1 + ',' + (e.y1 + s * a) + ' Z';
}

/* 回流帶（col 遞減）：source 右緣出來 → 右側走廊下潛 → 貼圖底下方的 lane 水平向左 →
   target 左側走廊上浮 → 接回左緣。等寬 stroke 路徑（stroke-width＝帶厚），圓角轉彎。 */
function backwardRibbon(e) {
  var r = Math.min(Math.max(14, e.backT), (e.backY - Math.max(e.y1, e.y2)) / 2);
  var xD = e.backXD, xU = e.backXU, yB = e.backY;
  return 'M' + e.x1 + ',' + e.y1 +
    ' L' + (xD - r) + ',' + e.y1 +
    ' Q' + xD + ',' + e.y1 + ' ' + xD + ',' + (e.y1 + r) +
    ' L' + xD + ',' + (yB - r) +
    ' Q' + xD + ',' + yB + ' ' + (xD - r) + ',' + yB +
    ' L' + (xU + r) + ',' + yB +
    ' Q' + xU + ',' + yB + ' ' + xU + ',' + (yB - r) +
    ' L' + xU + ',' + (e.y2 + r) +
    ' Q' + xU + ',' + e.y2 + ' ' + (xU + r) + ',' + e.y2 +
    ' L' + e.x2 + ',' + e.y2;
}

function render(model) {
  var geo = layout(model);
  var out = [];
  /* 尺寸交給 CSS（.chart svg）：SVG 填滿容器，meet-fit 就是「符合視窗」。 */
  out.push('<svg viewBox="0 0 ' + geo.width + ' ' + geo.height + '" ' +
    'preserveAspectRatio="xMidYMid meet" ' +
    'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="追查 Sankey">');
  out.push('<defs>' +
    '<linearGradient id="gband" x1="0" x2="1"><stop offset="0" stop-color="#22d3ee" stop-opacity=".85"/>' +
    '<stop offset="1" stop-color="#0e7490" stop-opacity=".85"/></linearGradient>' +
    '<linearGradient id="gband-h" x1="0" x2="1"><stop offset="0" stop-color="#67e8f9"/>' +
    '<stop offset="1" stop-color="#22d3ee"/></linearGradient>' +
    '<linearGradient id="gband-back" x1="1" x2="0"><stop offset="0" stop-color="#fb7185" stop-opacity=".75"/>' +
    '<stop offset="1" stop-color="#9f1239" stop-opacity=".75"/></linearGradient>' +
    '<linearGradient id="gband-back-h" x1="1" x2="0"><stop offset="0" stop-color="#fda4af"/>' +
    '<stop offset="1" stop-color="#be123c"/></linearGradient>' +
    /* write 通道（storage 資料）：燃橘。read 沿用青帶——read 與無通道的 switch 帶同色。
       只在圖上真的有 write 帶時才輸出這兩個漸層：switch 追查資料的 SVG 逐 byte 不變 */
    (model.edges.some(function (e) { return e.channel === 'write'; })
      ? '<linearGradient id="gband-w" x1="0" x2="1"><stop offset="0" stop-color="#c2410c" stop-opacity=".85"/>' +
        '<stop offset="1" stop-color="#7c2d12" stop-opacity=".85"/></linearGradient>' +
        '<linearGradient id="gband-w-h" x1="0" x2="1"><stop offset="0" stop-color="#fb923c"/>' +
        '<stop offset="1" stop-color="#c2410c"/></linearGradient>'
      : '') +
    '</defs>');
  /* 縮放層：TraceZoom 只動這個 <g> 的 transform。<defs> 留在外面。 */
  out.push('<g class="zoom-layer">');
  if (!model.nodes.length) {
    out.push('<text class="col-cap" x="' + PAD_SIDE + '" y="' + PAD_TOP + '">顯示門檻／通道過濾之後沒有任何節點</text>');
  }

  /* 欄位標題 */
  (geo.cols || []).forEach(function (col, ci) {
    if (!col || !col.length) return;
    var cap = colCaption(col, model.dir);
    out.push('<text class="col-cap" x="' + col[0].x + '" y="24">' + esc(cap) + '</text>');
  });

  /* 帶：先畫，壓在盒子下面 */
  model.edges.forEach(function (e, ei) {
    /* data-e＝在 model.edges 裡的索引、卡片的 data-n＝節點 id：mount 端的路徑高亮與點擊回呼靠這兩個
       屬性把 DOM 對回 model（與 zoom-layer、data-tip 一樣是套件的 public 契約）。 */
    var de = 'data-e="' + ei + '" ';
    var meta = {
      from: model.nodeMap[e.fromId].label, to: model.nodeMap[e.toId].label,
      fi: e.fromIface, ti: e.toIface, bps: e.bps, anchor: !!e.isAnchor,
      backward: e.backward || undefined,    /* stringify 會把 undefined 丟掉：沒回流的圖輸出不變 */
      owns: e.owns || undefined,            /* 同上：沒 owner 層的圖輸出不變 */
      ns: e.namespace || undefined,         /* 同上：沒 ns 的圖輸出不變 */
    /* 兩台以上 client 時卡片標題不是 client 身分（合成 id 或使用者給的 name），
       hover 這條帶要知道那頭掛了誰就靠這個鍵。同樣只在有值時出現。 */
    clients: clientsMeta(e, model) || undefined,
      /* storage 資料才有的鍵，同樣只在有值時出現：switch 追查資料的 data-tip 逐 byte 不變 */
      unit: e.unit === 'bytesPerSec' ? e.unit : undefined,
      channel: e.channel || undefined,
      tier: e.tier || undefined,
      attr: e.attribution || undefined,
      extra: e.extra || undefined,
      derived: e.derived ? 1 : undefined     /* 推導邊（pod→app→ns）：tooltip 要標「成員 pod 加總」 */
    };
    var isW = e.channel === 'write';
    /* iface 在 k8s hop 上可空：title 只在有值時帶，避免「A → B：+8 Gbps」多出孤懸空格 */
    var tt = meta.from + (e.fromIface ? ' ' + e.fromIface : '') + ' → ' +
      meta.to + (e.toIface ? ' ' + e.toIface : '') + '：' + R(e.bps, e.unit);
    if (e.backward) {
      var backTitle = '<title>' + esc(tt + '（回流）') + '</title>';
      if (e.backNear) {
        /* 相鄰欄回流：整條活在兩欄之間的走廊，反向的一般帶 */
        out.push('<path class="band band-back" d="' + ribbon(e) + '" fill="url(#gband-back)" ' +
          'stroke="#fb7185" stroke-opacity=".35" stroke-width="1" ' +
          de + 'data-tip="' + esc(JSON.stringify(meta)) + '">' + backTitle + '</path>');
      } else {
        /* band-loop：fill 是 none，hover 只能加深 stroke，CSS 得認得出來 */
        out.push('<path class="band band-back band-loop" d="' + backwardRibbon(e) + '" fill="none" ' +
          'stroke="#fb7185" stroke-opacity=".55" stroke-width="' + e.backT + '" ' +
          'stroke-linejoin="round" stroke-linecap="butt" ' +
          de + 'data-tip="' + esc(JSON.stringify(meta)) + '">' + backTitle + '</path>');
      }
      return;
    }
    /* 歸屬線：只表達「這個 port 掛的機器屬於誰」，量停在 port。灰虛線沿用葉卡外框的語彙，
       不新增顏色；stroke-linecap 留預設，短虛線才不會糊在一起。 */
    if (e.owns) {
      out.push('<path class="band band-own" d="' + ownLine(e) + '" fill="none" ' +
        'stroke="#94a3b8" stroke-opacity=".55" stroke-width="' + OWN_T + '" stroke-dasharray="5 4" ' +
        de + 'data-tip="' + esc(JSON.stringify(meta)) + '"><title>' +
        esc(meta.from + ' → ' + meta.to + '：歸屬（量停在 port）') + '</title></path>');
      return;
    }
    /* 值為 0 的帶：有量測、量是 0，跟「沒有量測」（absent，根本不建邊）不同。畫最小厚度但要看得出
       是 0——虛線＋半透明（參考面板同樣區分），不然它跟一條很小的流量分不出來。 */
    var isZero = e.bps === 0;
    out.push('<path class="band' + (e.lateral ? ' band-lat' : '') + (isW ? ' band-w' : '') + (isZero ? ' band-zero' : '') + '" d="' +
      (e.lateral ? lateralRibbon(e, e.bulge) : ribbon(e)) + '" fill="url(#' + (isW ? 'gband-w' : 'gband') + ')" ' +
      'stroke="' + (isW ? '#c2410c' : '#22d3ee') + '" stroke-opacity=".35" stroke-width="1" ' +
      de + 'data-tip="' + esc(JSON.stringify(meta)) + '"><title>' + esc(tt) + '</title></path>');
    /* 馬蹄弧一定終止在 target 右緣、且是朝 -x 進來的，所以固定一個朝左的三角形
       就永遠指對方向，不用算路徑切線。兄弟節點而非包在 band 裡：包起來會打斷
       .band:hover 與 querySelectorAll('.band') 的 tooltip 綁定。 */
    if (e.lateral) {
      var as = Math.max(5, Math.min(9, e.t2 / 2));   /* 細帶也看得見，粗帶不誇張 */
      out.push('<path class="lat-arrow' + (isW ? ' arrow-w' : '') + '" d="M' + (e.x2 + 4 + as * 2) + ',' + (e.y2 - as) +
        ' L' + (e.x2 + 4) + ',' + e.y2 +
        ' L' + (e.x2 + 4 + as * 2) + ',' + (e.y2 + as) + ' Z"/>');
    }
  });

  /* 帶上的數字。橫向弧帶的數字放弧頂，回流帶放底部水平段中點，放中點會壓在欄上 */
  model.edges.forEach(function (e) {
    if (e.owns) return;                        /* 歸屬線沒有量，印數字就是憑空生一個值 */
    if (e.bps === 0) return;                   /* 零值帶只有最小厚度，數字疊不下；tooltip 仍印 0 */
    var mx = (e.backward && !e.backNear) ? (e.backXD + e.backXU) / 2
      : e.lateral ? e.x1 + 0.72 * e.bulge : (e.x1 + e.x2) / 2;
    var my = (e.backward && !e.backNear) ? e.backY - e.backT / 2 - 10 : (e.y1 + e.y2) / 2;
    out.push('<text x="' + mx + '" y="' + (my + 4) + '" text-anchor="middle" class="p-val" ' +
      'style="paint-order:stroke;stroke:#0b1017;stroke-width:3.5px">' + esc(R(e.bps, e.unit)) + '</text>');
  });

  /* 盒子 */
  model.nodes.forEach(function (n) {
    if (n.kind === 'node') out.push(nodeBox(n, model, geo.nsColor));
    else if (n.kind === 'leaf') {
      if (n.role === 'pod') out.push(podCard(n, model, geo.nsColor));
      else if (n.role === 'ns') out.push(nsCard(n, model, geo.nsColor));
      else if (n.role === 'app') out.push(appCard(n, model, geo.nsColor));
      else if (n.role === 'owner') out.push(ownerCard(n, model));
      else out.push(leafCard(n, model, geo.nsColor));
    }
    else out.push(anchorCard(n, model));
  });

  /* 殘差：貼盒子外側、與帶寬等比的虛線色塊，不進走廊。
     直接走槽位，畫出來的東西跟 layout() 保留的空間就不可能不一致。 */
  model.nodes.forEach(function (n) {
    if (n.kind !== 'node') return;
    n.leftSlots.concat(n.rightSlots).forEach(function (sl) {
      if (sl.res) out.push(residual(n, sl));
    });
  });

  out.push('</g>');
  out.push('</svg>');
  return out.join('');
}

function colCaption(col, dir) {
  var kinds = {};
  col.forEach(function (n) { kinds[n.kind] = true; });
  /* 錨欄要整欄只有錨卡：no-flow 卡沒有邊、會落在第 0 欄，混進來不能標成「追查起點」 */
  if (kinds.anchor && col.length === 1) return dir === 'destination' ? '追查起點 (in)' : '追查起點 (out)';
  /* 整欄同質才標註，混欄不標——標了反而誤導 */
  if (kinds.node) {
    var role = col[0].role;
    var same = role !== 'switch' && col.every(function (n) { return n.kind === 'node' && n.role === role; });
    return '第 ' + col[0].col + ' 跳' + (same ? ' · ' + (TYPE_LABEL[role] || role) : '');
  }
  /* owner 終點欄：client 的負責人是追查的盡頭 */
  if (col.every(function (n) { return n.role === 'owner'; })) return '追查終止 · owner';
  /* 整欄都接了 owner 卡的 port 葉：它們已經是中繼，比照 pod 欄印「第 N 跳」。
     混欄（真終點的葉混在裡面）維持既有的「追查終止」，標了反而誤導。 */
  if (col.every(function (n) { return n.kind === 'leaf' && n.role === 'leaf' && n.ownerLinked; })) {
    return '第 ' + col[0].col + ' 跳 · port';
  }
  /* ns 終點欄：namespace 是追查的盡頭 */
  if (col.every(function (n) { return n.role === 'ns'; })) return '追查終止 · namespace';
  /* pod／application 是中繼了（另一側接 ns），整欄比照「第 N 跳」；含 pod 的混葉欄同理 */
  if (col.every(function (n) { return n.kind === 'leaf' && n.role === 'pod'; })) {
    return '第 ' + col[0].col + ' 跳 · pod';
  }
  if (col.every(function (n) { return n.kind === 'leaf' && n.role === 'app'; })) {
    return '第 ' + col[0].col + ' 跳 · application';
  }
  if (col.some(function (n) { return n.kind === 'leaf' && (n.role === 'pod' || n.role === 'app'); })) {
    return '第 ' + col[0].col + ' 跳';
  }
  return '追查終止';
}

/* ---------- 節點 tooltip（掛在每張卡的 <g> 上，tooltip.js 讀 data-tip） ---------- */
function typeWord(n) {
  if (n.kind === 'anchor') return '追查起點';
  if (n.role === 'ns') return 'namespace';
  if (n.role === 'app') return 'application';
  if (n.role === 'owner') return 'owner';
  if (n.kind === 'leaf') return n.type || 'host';
  return n.role;
}
function usageText(u) {
  if (!u) return '';
  var used = u.used_bytes, cap = u.capacity_bytes;
  if (used != null && cap != null) {
    return fmtBytes(used) + ' / ' + fmtBytes(cap) + (cap > 0 ? '（' + Math.round(used / cap * 100) + '%）' : '');
  }
  return used != null ? '已用 ' + fmtBytes(used) : '容量 ' + fmtBytes(cap);
}
/* 節點身上有哪些通道（照 read、write 順序）：沒有通道的邊（switch 資料、推導邊）不算 */
function channelsOf(n) {
  var has = {};
  n.inEdges.concat(n.outEdges).forEach(function (e) { if (e.channel) has[e.channel] = true; });
  return ['read', 'write'].filter(function (c) { return has[c]; });
}
function sum(list) { return list.reduce(function (s, e) { return s + e.bps; }, 0); }
function sumCh(list, ch) { return sum(list.filter(function (e) { return e.channel === ch; })); }
/* 內容順序照參考面板：型別／名稱、ns、ontap_cluster、流量、usage、status、health、model、
   perf（標 raw：原始讀數，不判定好壞）、alerts、no-flow 說明。沒有的鍵不輸出。 */
function nodeTip(n, model) {
  var rows = [];
  var title = n.kind === 'anchor' ? '追查起點' : typeWord(n) + ' / ' + n.label;
  if (n.kind === 'anchor') {
    var inv = model.investigation;
    rows.push(['iface', inv.iface]);
    rows.push([n.dirLabel + ' 方向', D(inv.delta_bps)]);
    if (n.note) rows.push(['備註', n.note]);
    return { node: 1, title: title, rows: rows };
  }
  if (n.role !== 'ns' && n.role !== 'app' && n.role !== 'owner' && n.id !== n.label) rows.push(['id', n.id]);
  if (n.namespace && n.role !== 'ns') rows.push(['namespace', 'ns/' + n.namespace]);
  if (n.ontapCluster) rows.push(['ontap_cluster', n.ontapCluster]);
  /* storage 資料的 read／write 是兩條帶，tooltip 的量也分向印（參考面板 Both 模式四行）；
     把兩個方向加成一個數字是沒人量過的值。switch 資料沒有通道，維持一行。 */
  var chs = channelsOf(n);
  function flowRows(label, list) {
    if (!chs.length) { rows.push([label, A(sum(list), n.unit)]); return; }
    chs.forEach(function (ch) { rows.push([label + '（' + ch + '）', A(sumCh(list, ch), n.unit)]); });
  }
  if (n.kind === 'node') {
    if (n.noFlow) rows.push(['流量', '沒有任何可畫的 flow 邊（no-flow）']);
    else {
      flowRows('已追查 in', n.inEdges);
      flowRows('已追查 out', n.outEdges);
      if (resIn(n)) rows.push(['其他輸入', A(n.otherIn, n.unit)]);
      if (resOut(n)) rows.push(['其他輸出', A(n.otherOut, n.unit)]);
    }
  } else {
    /* owner 卡的量只來自「整張卡只有這一個 owner」的 port。名下的 port 上只要還有別人的
       機器（或查不到 owner 的機器），bps 就是 0——那不是「沒有流量」而是「量停在 port」，
       不能印成 0。 */
    if (n.role === 'owner') {
      rows.push(['已量到的合計', n.bps > 0 ? R(n.bps, n.unit) : '—（名下的 port 上還有別人的機器，量停在 port）']);
      rows.push(['client', n.clientCount + ' 台']);
      rows.push(['port', n.portCount + ' 個']);
    } else {
      /* app／ns 卡的量是成員 pod 的推導值（同一筆數字重新分組，不是量測）：標出來，
         參考面板同樣標「derived from member pods」 */
      var isGroup = n.role === 'ns' || n.role === 'app';
      var side = model.dir === 'destination' ? n.inEdges : n.outEdges;
      if (chs.length) {
        chs.forEach(function (ch) {
          rows.push([(isGroup ? '合計（成員 pod 加總，' : '流量（') + ch + '）', R(sumCh(side, ch), n.unit)]);
        });
      } else {
        rows.push([isGroup ? '合計（成員 pod 加總）' : '流量', R(n.bps, n.unit)]);
      }
      if (n.podCount != null) rows.push(['pod', n.podCount + ' 個']);
    }
  }
  if (n.usage) rows.push(['usage', usageText(n.usage)]);
  if (n.status) rows.push(['status', n.status + (n.role === 'ns' || n.role === 'app' ? '（成員 pod 中最差）' : '')]);
  var info = n.info || {};
  if (info.health) rows.push(['health', info.health]);
  if (info.model) rows.push(['model', info.model]);
  if (info.perf) {
    Object.keys(info.perf).forEach(function (k) {
      var v = info.perf[k];
      rows.push([k, (k === 'total_bytes_per_sec' ? fmtBytes(v) + '/s' : String(v)) + '（raw）']);
    });
  }
  (info.alerts || []).forEach(function (a) { rows.push(['alert', a]); });
  /* tooltip 不截斷、列出全部：卡面只放得下前兩筆，要看完整清單就是靠這裡 */
  var cs = n.clients || [];
  cs.forEach(function (c, i) {
    rows.push([cs.length === 1 ? 'client' : 'client ' + (i + 1),
      [c.ip, c.hostname, c.owner].filter(Boolean).join(' · ')]);
  });
  return { node: 1, title: title, rows: rows };
}
function tipAttr(n, model) { return ' data-n="' + esc(n.id) + '" data-tip="' + esc(JSON.stringify(nodeTip(n, model))) + '"'; }

/* 帶的 tooltip 要列的 client：取封包下游那一端的節點（追來源模式反過來），
   有 clients 就回 hostname／IP 的字串陣列。完整欄位在卡片自己的 tooltip 裡。 */
function clientsMeta(e, model) {
  /* 往 owner 卡的邊剛好相反：owner 卡上沒有 clients，要列的是 port 那一端掛了誰 */
  var toOwner = model.nodeMap[e.toId].role === 'owner' || model.nodeMap[e.fromId].role === 'owner';
  var down = model.dir === 'destination' ? e.toId : e.fromId;
  var up = model.dir === 'destination' ? e.fromId : e.toId;
  var far = model.nodeMap[toOwner ? up : down];
  if (!far || !far.clients) return null;
  return far.clients.map(function (c) { return c.hostname || c.ip; });
}

function nodeBox(n, model, nsColor) {
  var isDevice = DEVICE_TYPES.indexOf(n.role) >= 0;   /* k8s node／pod、netapp 三型別：虛線框 */
  var statusColor = n.status ? STATUS_COLOR[n.status] : null;
  var s = [];
  /* 外框色優先序：status（critical 玫瑰／warning 琥珀）> root 青框 > 設備天藍 > 預設；
     虛線只看設備型別——root 的 k8s node 兩個身分都看得見 */
  s.push('<g' + tipAttr(n, model) + '>');
  s.push('<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="9" ' +
    'fill="#101c28" stroke="' + (statusColor || (n.isRoot ? '#22d3ee' : (isDevice ? '#7dd3fc' : '#2c3e52'))) + '" ' +
    'stroke-width="' + (n.isRoot || statusColor ? 1.8 : 1.2) + '"' + (isDevice ? ' stroke-dasharray="6 4"' : '') + '/>');
  s.push('<line x1="' + n.x + '" y1="' + (n.y + headerH(n) - 6) + '" x2="' + (n.x + n.w) +
    '" y2="' + (n.y + headerH(n) - 6) + '" stroke="#22303f"/>');
  s.push('<text class="n-title" x="' + (n.x + 12) + '" y="' + (n.y + 17) + '">' + esc(n.label) + '</text>');
  var sub = esc(n.id);
  if (n.namespace) {
    sub += ' · <tspan style="fill:' + (nsColor[n.namespace] || '#94a3b8') + '">ns/' + esc(n.namespace) + '</tspan>';
  }
  if (n.role !== 'switch') sub += ' · ' + esc(n.role);
  if (n.ontapCluster) sub += ' · ' + esc(n.ontapCluster);
  s.push('<text class="n-sub" x="' + (n.x + 12) + '" y="' + (n.y + 29) + '">' + sub + '</text>');
  if (hasUsage(n)) {
    s.push('<text class="n-sub" x="' + (n.x + 12) + '" y="' + (n.y + 41) + '">使用 ' + esc(usageText(n.usage)) + '</text>');
  }

  n.leftSlots.forEach(function (sl) {
    if (sl.res || !sl.iface) return;             /* 殘差的標籤畫在盒子外面；k8s port 可沒 iface */
    s.push('<text class="p-label" x="' + (n.x + 10) + '" y="' + (sl.cy + 3.5) + '">' + esc(sl.iface) + '</text>');
  });
  n.rightSlots.forEach(function (sl) {
    if (sl.res || !sl.iface) return;
    s.push('<text class="p-label" text-anchor="end" x="' + (n.x + n.w - 10) + '" y="' + (sl.cy + 3.5) + '">' +
      esc(sl.iface) + '</text>');
  });
  s.push('</g>');
  return s.join('');
}

function leafCard(n, model, nsColor) {
  var s = [];
  var nsc = n.namespace ? (nsColor[n.namespace] || '#94a3b8') : null;
  var statusColor = n.status ? STATUS_COLOR[n.status] : null;
  s.push('<g' + tipAttr(n, model) + '>');
  s.push('<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8" ' +
    'fill="#0e151d" stroke="' + (statusColor || '#94a3b8') + '" stroke-opacity="' + (statusColor ? '1' : '.65') +
    '" stroke-width="' + (statusColor ? '1.8' : '1.1') + '" stroke-dasharray="5 4"/>');
  /* 左緣 ns 色條：帶 ns 的非 pod 葉也照畫（與色盤取用條件一致）。
     上下內縮避開圓角，避免色條戳出弧線外。 */
  if (nsc) {
    s.push('<rect x="' + (n.x + 1.5) + '" y="' + (n.y + 5) + '" width="4" height="' + (n.h - 10) +
      '" rx="2" fill="' + nsc + '" fill-opacity=".85"/>');
  }
  /* 接了 owner 卡的 port 已經不是終點了（比照 pod 卡從「追查終止」變成 pod） */
  s.push('<text class="leaf-stop" x="' + (n.x + 12) + '" y="' + (n.y + 17) + '">' +
    (n.ownerLinked ? 'port' : '追查終止') + '</text>');
  var cols = clientCols(n), ly;
  if (cols.length) {
    /* 有 client 的卡：合成 id（sw-tor-1:xe-0/0/12）不當標題——順著帶子回去就知道是哪台
       switch 的哪個 iface，抄在卡上是重複資訊。真的給了 name 才畫標題。
       最後一行也不再重複 iface，只留量。 */
    ly = n.y + 34;
    if (n.named) {
      s.push('<text class="leaf-main" x="' + (n.x + 12) + '" y="' + ly + '">' + esc(n.label) + '</text>');
      ly += 14;
    }
    if (n.namespace) {
      s.push('<text class="leaf-sub" style="fill:' + nsc + '" x="' + (n.x + 12) + '" y="' + ly + '">ns/' +
        esc(n.namespace) + '</text>');
      ly += 14;
    }
    /* 表頭用 wire 的欄位名（跟 tooltip 印 ontap_cluster／health 同一套慣例），
       樣式沿用 .leaf-stop（灰小字），分隔線沿用 nodeBox 那條內聯 stroke——不新增類別與顏色。 */
    var cx = n.x + CLIENT_PAD;
    cols.forEach(function (col) {
      s.push('<text class="leaf-stop" x="' + cx + '" y="' + ly + '">' + col.key + '</text>');
      cx += col.w + CLIENT_GAP;
    });
    s.push('<line x1="' + (n.x + CLIENT_PAD) + '" y1="' + (ly + 4) + '" x2="' + (n.x + n.w - CLIENT_PAD) +
      '" y2="' + (ly + 4) + '" stroke="#22303f"/>');
    ly += 14;
    clientRows(n).forEach(function (cells) {
      var rx = n.x + CLIENT_PAD;
      cells.forEach(function (v, i) {
        if (v) s.push('<text class="leaf-sub" x="' + rx + '" y="' + ly + '">' + esc(v) + '</text>');
        rx += cols[i].w + CLIENT_GAP;
      });
      ly += 14;
    });
    s.push('<text class="leaf-sub" x="' + (n.x + 12) + '" y="' + ly + '">' + esc(A(n.bps, n.unit)) + '</text>');
  } else {
    s.push('<text class="leaf-main" x="' + (n.x + 12) + '" y="' + (n.y + 34) + '">' + esc(n.label) + '</text>');
    ly = n.y + 48;
    if (n.namespace) {
      s.push('<text class="leaf-sub" style="fill:' + nsc + '" x="' + (n.x + 12) + '" y="' + ly + '">ns/' +
        esc(n.namespace) + '</text>');
      ly += 14;
    }
    var ifc = n.iface || n.localIface || '';
    s.push('<text class="leaf-sub" x="' + (n.x + 12) + '" y="' + ly + '">' +
      (ifc ? esc(ifc) + ' · ' : '') + esc(A(n.bps, n.unit)) + '</text>');
  }
  /* 查得到 client 就不是「不明終點」了：右上角換成 client 標記 */
  var nc = n.clients ? n.clients.length : 0;
  s.push('<text class="leaf-stop" text-anchor="end" x="' + (n.x + n.w - 12) + '" y="' + (n.y + 17) +
    '">' + (nc === 0 ? '未再往下追' : (nc === 1 ? 'client' : nc + ' 個 client')) + '</text>');
  s.push('</g>');
  return s.join('');
}

/* pod 中繼卡：外觀沿用天藍虛線＋ns 色條的 pod 家族，但 pod 已不是終點——
   另一側有邊接 app／ns 終點，「追查終止／未再往下追」字樣不再出現。
   沒有 ns 的 pod（合法）就沒有色條與 ns 行，iface 行上移。 */
function podCard(n, model, nsColor) {
  var nsc = n.namespace ? (nsColor[n.namespace] || '#94a3b8') : null;
  var statusColor = n.status ? STATUS_COLOR[n.status] : null;
  var s = [];
  s.push('<g' + tipAttr(n, model) + '>');
  s.push('<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8" ' +
    'fill="#0e151d" stroke="' + (statusColor || '#7dd3fc') + '" stroke-opacity="' + (statusColor ? '1' : '.55') +
    '" stroke-width="' + (statusColor ? '1.8' : '1.1') + '" stroke-dasharray="5 4"/>');
  /* 左緣 ns 色條：同 ns 的 pod 相鄰排列時色條連成一段，彙總一眼可讀 */
  if (nsc) {
    s.push('<rect x="' + (n.x + 1.5) + '" y="' + (n.y + 5) + '" width="4" height="' + (n.h - 10) +
      '" rx="2" fill="' + nsc + '" fill-opacity=".85"/>');
  }
  s.push('<text class="leaf-stop" x="' + (n.x + 12) + '" y="' + (n.y + 17) + '">pod</text>');
  s.push('<text class="leaf-main" x="' + (n.x + 12) + '" y="' + (n.y + 34) + '">' + esc(n.label) + '</text>');
  var ly = n.y + 48;
  if (nsc) {
    s.push('<text class="leaf-sub" style="fill:' + nsc + '" x="' + (n.x + 12) + '" y="' + ly + '">ns/' +
      esc(n.namespace) + '</text>');
    ly += 14;
  }
  var ifc = n.iface || n.localIface || '';
  s.push('<text class="leaf-sub" x="' + (n.x + 12) + '" y="' + ly + '">' +
    (ifc ? esc(ifc) + ' · ' : '') + esc(A(n.bps, n.unit)) + '</text>');
  s.push('</g>');
  return s.join('');
}

/* 群組終點卡（namespace／application）：邏輯彙總、不是設備——用 ns 色實線描邊，
   虛線留給「設備／截斷」的既有語彙。bps 是所有成員邊的加總（model 算好）；
   status 是成員 pod 的最差值，有就換成 status 色描邊。 */
function groupCard(n, model, nsColor, word) {
  var nsc = nsColor[n.namespace] || '#94a3b8';
  var statusColor = n.status ? STATUS_COLOR[n.status] : null;
  var s = [];
  s.push('<g' + tipAttr(n, model) + '>');
  s.push('<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8" ' +
    'fill="' + nsc + '" fill-opacity=".10" stroke="' + (statusColor || nsc) + '" stroke-width="' + (statusColor ? '1.8' : '1.4') + '"/>');
  s.push('<text class="leaf-stop" style="fill:' + nsc + '" x="' + (n.x + 12) + '" y="' + (n.y + 17) +
    '">' + word + '</text>');
  s.push('<text class="leaf-main" x="' + (n.x + 12) + '" y="' + (n.y + 34) + '">' + esc(n.label) + '</text>');
  s.push('<text class="leaf-sub" x="' + (n.x + 12) + '" y="' + (n.y + 48) + '">' +
    esc(R(n.bps, n.unit)) + ' · ' + n.podCount + ' 個 pod</text>');
  s.push('</g>');
  return s.join('');
}
function nsCard(n, model, nsColor) { return groupCard(n, model, nsColor, 'namespace'); }
function appCard(n, model, nsColor) { return groupCard(n, model, nsColor, 'application'); }

/* owner 終點卡：client 的負責人。跟 ns／app 一樣是邏輯彙總（實線描邊，虛線留給設備／截斷），
   但 owner 不是 namespace、沒有 ns 色，用葉卡那支灰——不新增顏色定義。
   bps 只來自「整張卡只有這一個 owner」的 port；名下的 port 上還有別人的機器時 bps 是 0，
   那不是「沒有流量」而是「量停在 port」，所以第三行改印台數，不能印一個 0 出來。 */
function ownerCard(n, model) {
  var s = [];
  s.push('<g' + tipAttr(n, model) + '>');
  s.push('<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8" ' +
    'fill="#94a3b8" fill-opacity=".10" stroke="#94a3b8" stroke-width="1.4"/>');
  s.push('<text class="leaf-stop" x="' + (n.x + 12) + '" y="' + (n.y + 17) + '">owner</text>');
  s.push('<text class="leaf-main" x="' + (n.x + 12) + '" y="' + (n.y + 34) + '">' +
    esc(clip(n.label, 34)) + '</text>');
  /* 量與台數分兩行：擠成一行會讀成「這個量是這幾個 port 的總和」，
     而名下只要有一個 port 掛著多個 owner，那個 port 的量就沒有算進來。 */
  s.push('<text class="leaf-sub" x="' + (n.x + 12) + '" y="' + (n.y + 48) + '">' +
    (n.bps > 0 ? esc(R(n.bps, n.unit)) + (n.meteredPorts < n.portCount ? '（部分 port）' : '')
               : '量停在 port') + '</text>');
  s.push('<text class="leaf-stop" x="' + (n.x + 12) + '" y="' + (n.y + 64) + '">' +
    n.clientCount + ' 台 client · ' + n.portCount + ' 個 port</text>');
  s.push('</g>');
  return s.join('');
}

function anchorCard(n, model) {
  var inv = model.investigation;
  var s = [];
  s.push('<g' + tipAttr(n, model) + '>');
  s.push('<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8" ' +
    'fill="#0d1a22" stroke="#22d3ee" stroke-width="1.4" stroke-dasharray="4 3"/>');
  s.push('<text class="leaf-stop" style="fill:#22d3ee" x="' + (n.x + 12) + '" y="' + (n.y + 18) + '">追查起點</text>');
  s.push('<text class="leaf-main" x="' + (n.x + 12) + '" y="' + (n.y + 36) + '">' + esc(inv.iface) + '</text>');
  s.push('<text class="leaf-sub" x="' + (n.x + 12) + '" y="' + (n.y + 52) + '">' +
    esc(n.dirLabel) + ' 方向 · ' + esc(D(inv.delta_bps)) + '</text>');
  s.push('</g>');
  return s.join('');
}

function residual(n, sl) {
  var isIn = sl.res === 'in';
  var color = isIn ? '#f59e0b' : '#fb7185';
  var h = sl.t;                                  /* 已含 THICK_MIN 下限 */
  var x = isIn ? n.x - RES_LEN : n.x + n.w;
  var txtX = isIn ? x - RES_GAP : x + RES_LEN + RES_GAP;
  var anchorAttr = isIn ? 'end' : 'start';
  var word = isIn ? '其他輸入' : '其他輸出';
  var amount = (isIn && n.unit !== 'bytesPerSec' ? '+' : '') + A(sl.bps, n.unit);
  /* 標籤用描邊光暈，不用不透明底板——底板會在青帶上打出一個黑洞（殘差最後才畫） */
  var halo = 'paint-order:stroke;stroke:#0b1017;stroke-width:3.5px';
  var s = [];
  s.push('<g>');
  s.push('<title>' + esc(n.label + '：' + word + ' ' + A(sl.bps, n.unit) +
    '（已追查 in ' + A(n.tracedIn, n.unit) + ' / out ' + A(n.tracedOut, n.unit) + '）') + '</title>');
  s.push('<rect x="' + x + '" y="' + (sl.cy - h / 2) + '" width="' + RES_LEN + '" height="' + h + '" ' +
    'fill="' + color + '" fill-opacity=".16" ' +
    'stroke="' + color + '" stroke-width="1.4" stroke-dasharray="4 3"/>');
  s.push('<text class="res-label" text-anchor="' + anchorAttr + '" x="' + txtX + '" y="' + (sl.cy - 1) +
    '" style="fill:' + color + ';' + halo + '">' + esc(word) + '</text>');
  s.push('<text class="res-label" text-anchor="' + anchorAttr + '" x="' + txtX + '" y="' + (sl.cy + 11) +
    '" style="fill:' + color + ';' + halo + '">' + esc(amount) + '</text>');
  s.push('</g>');
  return s.join('');
}

/* ---------- 圖外資訊：hop 數字摘要 ---------- */
function summary(model) {
  var rows = model.nodes.filter(function (n) { return n.kind === 'node'; })
    .sort(function (a, b) { return a.col - b.col; });
  var h = ['<h3>hop 數字摘要（圖外資訊）</h3><div class="tbl-wrap"><table><thead><tr>',
    '<th>hop</th><th>追查輸入</th><th>出口增加</th><th class="c-amber">其他進</th>',
    '<th class="c-rose">其他出</th></tr></thead><tbody>'];
  rows.forEach(function (n) {
    h.push('<tr><td>' + esc(n.label) + ' <span class="c-dim">' + esc(n.id) + '</span>' +
      (n.noFlow ? ' <span class="c-dim">(no-flow)</span>' : '') + '</td>' +
      '<td class="num">' + A(n.tracedIn, n.unit) + '</td>' +
      '<td class="num">' + A(n.tracedOut, n.unit) + '</td>' +
      '<td class="num c-amber">' + (resIn(n) ? (n.unit === 'bytesPerSec' ? '' : '+') + A(n.otherIn, n.unit) : '—') + '</td>' +
      '<td class="num c-rose">' + (resOut(n) ? A(n.otherOut, n.unit) : '—') + '</td></tr>');
  });
  h.push('</tbody></table></div>');
  /* namespace 流量小計：ns 終點節點就是單一事實來源（bps＝pod 匯流邊加總、
     pod 數＝邊數），表跟圖不可能對不上 */
  var nsNodes = model.nodes.filter(function (n) { return n.role === 'ns'; });
  if (nsNodes.length) {
    var sorted = nsNodes.slice().sort(function (a, b) { return b.bps - a.bps; });
    h.push('<h3>namespace 流量小計（終點）</h3><div class="tbl-wrap"><table><thead><tr>' +
      '<th>namespace</th><th>pod 數</th><th>Δ 合計</th></tr></thead><tbody>');
    sorted.forEach(function (n) {
      h.push('<tr><td>' + esc(n.label) + '</td><td class="num">' + n.podCount + '</td>' +
        '<td class="num">' + R(n.bps, n.unit) + '</td></tr>');
    });
    h.push('</tbody></table></div>');
  }
  h.push('<p class="warn">平衡式：已知 in ＋ 其他輸入 ＝ 已追查 out ＋ 其他輸出。</p>');
  model.warnings.forEach(function (w) { h.push('<p class="warn">⚠ ' + esc(w) + '</p>'); });
  return h.join('');
}

export { render, summary, esc };
