/* SVG Sankey 繪製：青帶＝已追查、殘差＝盒子外側與帶寬等比的虛線色塊、終止＝灰虛線小卡。
   帶上的數字一律是實際量測到的速率增量，沒有推估值。 */
(function (global) {
  'use strict';
  var F = global.TraceModel.fmtBps;
  var D = global.TraceModel.fmtDelta;

  var NODE_W = 208, LEAF_W = 178, ANCHOR_W = 152;
  var HEADER_H = 36, ROW_H = 24, ROW_GAP = 9, BODY_PAD = 12, BODY_MIN = 26;
  var COL_GAP = 218, VGAP = 34;
  var PAD_TOP = 46, PAD_BOTTOM = 26, PAD_SIDE = 122;
  var THICK_MAX = 86, THICK_MIN = 3;
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

  /* pod 或帶 namespace 的葉多一行資訊（pod / ns 標示），卡要高一階 */
  function leafH(n) { return (n.role === 'pod' || n.namespace) ? 80 : 70; }

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
        return { edge: e, role: 'in', iface: e.toIface, t: thick(e.bps) };
      }).concat(n.inEdges.filter(function (e) { return e.backward && !e.backNear; }).map(function (e) {
        return { edge: e, role: 'in', iface: e.toIface, t: thick(e.bps) };
      })).concat(n.outEdges.filter(function (e) { return e.backNear; }).map(function (e) {
        return { edge: e, role: 'back-out', iface: e.fromIface, t: thick(e.bps) };
      }));
      n.rightSlots = n.outEdges.filter(function (e) { return !e.lateral && !e.backward; }).map(function (e) {
        return { edge: e, role: 'out', iface: e.fromIface, t: thick(e.bps) };
      }).concat(n.outEdges.filter(function (e) { return e.lateral; }).map(function (e) {
        return { edge: e, role: 'lat-out', iface: e.fromIface, t: thick(e.bps) };
      })).concat(n.inEdges.filter(function (e) { return e.lateral; }).map(function (e) {
        return { edge: e, role: 'lat-in', iface: e.toIface, t: thick(e.bps) };
      })).concat(n.inEdges.filter(function (e) { return e.backNear; }).map(function (e) {
        return { edge: e, role: 'back-in', iface: e.toIface, t: thick(e.bps) };
      })).concat(n.outEdges.filter(function (e) { return e.backward && !e.backNear; }).map(function (e) {
        return { edge: e, role: 'out', iface: e.fromIface, t: thick(e.bps) };
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
        n.h = HEADER_H + Math.max(lh, rh, BODY_MIN) + BODY_PAD;
      } else if (n.kind === 'leaf') {
        n.w = LEAF_W; n.h = Math.max(leafH(n), lh, rh);
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

    /* 正規化 y */
    var minY = Infinity, maxY = -Infinity;
    nodes.forEach(function (n) { minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y + n.h); });
    var dy = PAD_TOP - minY;
    nodes.forEach(function (n) { n.y += dy; n.__cy = n.y + n.h / 2; });
    var totalH = (maxY + dy) + PAD_BOTTOM;

    /* pod 依 ns 分組後，欄內順序可能偏離 hop 上 port 的宣告順序，帶子會互穿。
       把「對端是帶 ns 的 pod 葉」的槽位依對端的 y 重排（寫回原本的索引位置，
       其他槽位含殘差槽原地不動）——只有 pod 葉邊會被重排，非 k8s 圖槽位順序逐 byte 不變。 */
    nodes.forEach(function (n) {
      if (n.kind !== 'node') return;
      [n.leftSlots, n.rightSlots].forEach(function (slots) {
        function far(sl) {
          return model.nodeMap[sl.role === 'in' ? sl.edge.fromId : sl.edge.toId];
        }
        var idxs = [];
        slots.forEach(function (sl, i) {
          if (!sl.edge || sl.edge.lateral || sl.edge.backward) return;
          var f = far(sl);
          if (f.kind === 'leaf' && f.role === 'pod' && f.namespace) idxs.push(i);
        });
        if (idxs.length < 2) return;
        var picked = idxs.map(function (i) { return slots[i]; });
        picked.sort(function (a, b) { return far(a).y - far(b).y; });
        idxs.forEach(function (i, k) { slots[i] = picked[k]; });
      });
    });

    /* port 中心點 */
    nodes.forEach(function (n) {
      var top = n.kind === 'node' ? n.y + HEADER_H : n.y;
      var avail = n.kind === 'node' ? n.h - HEADER_H - BODY_PAD : n.h;
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
      '</defs>');
    /* 縮放層：TraceZoom 只動這個 <g> 的 transform。<defs> 留在外面。 */
    out.push('<g class="zoom-layer">');

    /* 欄位標題 */
    (geo.cols || []).forEach(function (col, ci) {
      if (!col || !col.length) return;
      var cap = colCaption(col, model.dir);
      out.push('<text class="col-cap" x="' + col[0].x + '" y="24">' + esc(cap) + '</text>');
    });

    /* 帶：先畫，壓在盒子下面 */
    model.edges.forEach(function (e) {
      var meta = {
        from: model.nodeMap[e.fromId].label, to: model.nodeMap[e.toId].label,
        fi: e.fromIface, ti: e.toIface, bps: e.bps, anchor: !!e.isAnchor,
        backward: e.backward || undefined,    /* stringify 會把 undefined 丟掉：沒回流的圖輸出不變 */
        ns: e.namespace || undefined          /* 同上：沒 ns 的圖輸出不變 */
      };
      /* iface 在 k8s hop 上可空：title 只在有值時帶，避免「A → B：+8 Gbps」多出孤懸空格 */
      var tt = meta.from + (e.fromIface ? ' ' + e.fromIface : '') + ' → ' +
        meta.to + (e.toIface ? ' ' + e.toIface : '') + '：' + D(e.bps);
      if (e.backward) {
        var backTitle = '<title>' + esc(tt + '（回流）') + '</title>';
        if (e.backNear) {
          /* 相鄰欄回流：整條活在兩欄之間的走廊，反向的一般帶 */
          out.push('<path class="band band-back" d="' + ribbon(e) + '" fill="url(#gband-back)" ' +
            'stroke="#fb7185" stroke-opacity=".35" stroke-width="1" ' +
            'data-tip="' + esc(JSON.stringify(meta)) + '">' + backTitle + '</path>');
        } else {
          /* band-loop：fill 是 none，hover 只能加深 stroke，CSS 得認得出來 */
          out.push('<path class="band band-back band-loop" d="' + backwardRibbon(e) + '" fill="none" ' +
            'stroke="#fb7185" stroke-opacity=".55" stroke-width="' + e.backT + '" ' +
            'stroke-linejoin="round" stroke-linecap="butt" ' +
            'data-tip="' + esc(JSON.stringify(meta)) + '">' + backTitle + '</path>');
        }
        return;
      }
      out.push('<path class="band' + (e.lateral ? ' band-lat' : '') + '" d="' +
        (e.lateral ? lateralRibbon(e, e.bulge) : ribbon(e)) + '" fill="url(#gband)" ' +
        'stroke="#22d3ee" stroke-opacity=".35" stroke-width="1" ' +
        'data-tip="' + esc(JSON.stringify(meta)) + '"><title>' + esc(tt) + '</title></path>');
      /* 馬蹄弧一定終止在 target 右緣、且是朝 -x 進來的，所以固定一個朝左的三角形
         就永遠指對方向，不用算路徑切線。兄弟節點而非包在 band 裡：包起來會打斷
         .band:hover 與 querySelectorAll('.band') 的 tooltip 綁定。 */
      if (e.lateral) {
        var as = Math.max(5, Math.min(9, e.t2 / 2));   /* 細帶也看得見，粗帶不誇張 */
        out.push('<path class="lat-arrow" d="M' + (e.x2 + 4 + as * 2) + ',' + (e.y2 - as) +
          ' L' + (e.x2 + 4) + ',' + e.y2 +
          ' L' + (e.x2 + 4 + as * 2) + ',' + (e.y2 + as) + ' Z"/>');
      }
    });

    /* 帶上的數字。橫向弧帶的數字放弧頂，回流帶放底部水平段中點，放中點會壓在欄上 */
    model.edges.forEach(function (e) {
      var mx = (e.backward && !e.backNear) ? (e.backXD + e.backXU) / 2
        : e.lateral ? e.x1 + 0.72 * e.bulge : (e.x1 + e.x2) / 2;
      var my = (e.backward && !e.backNear) ? e.backY - e.backT / 2 - 10 : (e.y1 + e.y2) / 2;
      out.push('<text x="' + mx + '" y="' + (my + 4) + '" text-anchor="middle" class="p-val" ' +
        'style="paint-order:stroke;stroke:#0b1017;stroke-width:3.5px">' + esc(D(e.bps)) + '</text>');
    });

    /* 盒子 */
    model.nodes.forEach(function (n) {
      if (n.kind === 'node') out.push(nodeBox(n, model, geo.nsColor));
      else if (n.kind === 'leaf') out.push(leafCard(n, geo.nsColor));
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
    if (kinds.anchor) return dir === 'destination' ? '追查起點 (in)' : '追查起點 (out)';
    /* 整欄都是 k8s node／pod 才標註，混欄不標——標了反而誤導 */
    if (kinds.node) {
      var allK8s = col.every(function (n) { return n.kind === 'node' && n.role === 'node'; });
      return '第 ' + col[0].col + ' 跳' + (allK8s ? ' · k8s node' : '');
    }
    var allPod = col.every(function (n) { return n.kind === 'leaf' && n.role === 'pod'; });
    return '追查終止' + (allPod ? ' · pod' : '');
  }

  function nodeBox(n, model, nsColor) {
    var isK8s = n.role === 'node' || n.role === 'pod';   /* pod 也能當中繼 hop（proxy pod） */
    var s = [];
    /* root 身分優先於 k8s 樣式（青框），虛線只看 k8s——root 的 k8s node 兩個身分都看得見 */
    s.push('<g>');
    s.push('<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="9" ' +
      'fill="#101c28" stroke="' + (n.isRoot ? '#22d3ee' : (isK8s ? '#7dd3fc' : '#2c3e52')) + '" ' +
      'stroke-width="' + (n.isRoot ? 1.8 : 1.2) + '"' + (isK8s ? ' stroke-dasharray="6 4"' : '') + '/>');
    s.push('<line x1="' + n.x + '" y1="' + (n.y + HEADER_H - 6) + '" x2="' + (n.x + n.w) +
      '" y2="' + (n.y + HEADER_H - 6) + '" stroke="#22303f"/>');
    s.push('<text class="n-title" x="' + (n.x + 12) + '" y="' + (n.y + 17) + '">' + esc(n.label) +
      (n.hopCount > 1 ? ' <tspan class="n-sub">×' + n.hopCount + ' hop 合併</tspan>' : '') + '</text>');
    var sub = esc(n.id);
    if (n.role === 'node') sub += ' · node';
    else if (n.role === 'pod') {
      if (n.namespace) {
        sub += ' · <tspan style="fill:' + (nsColor[n.namespace] || '#94a3b8') + '">ns/' +
          esc(n.namespace) + '</tspan>';
      }
      sub += ' · pod';
    }
    s.push('<text class="n-sub" x="' + (n.x + 12) + '" y="' + (n.y + 29) + '">' + sub + '</text>');

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

  function leafCard(n, nsColor) {
    var s = [];
    var isPod = n.role === 'pod';
    var nsc = n.namespace ? (nsColor[n.namespace] || '#94a3b8') : null;
    s.push('<g>');
    /* pod 用 node 盒同家族的天藍描邊（調淡），跟一般灰葉一眼就分得出來 */
    s.push('<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8" ' +
      'fill="#0e151d" stroke="' + (isPod ? '#7dd3fc' : '#94a3b8') + '" stroke-opacity="' +
      (isPod ? '.55' : '.65') + '" stroke-width="1.1" stroke-dasharray="5 4"/>');
    /* 左緣 ns 色條：同 ns 的 pod 相鄰排列時色條連成一段，彙總一眼可讀。
       上下內縮避開圓角，避免色條戳出弧線外。 */
    if (nsc) {
      s.push('<rect x="' + (n.x + 1.5) + '" y="' + (n.y + 5) + '" width="4" height="' + (n.h - 10) +
        '" rx="2" fill="' + nsc + '" fill-opacity=".85"/>');
    }
    s.push('<text class="leaf-stop" x="' + (n.x + 12) + '" y="' + (n.y + 17) + '">追查終止</text>');
    s.push('<text class="leaf-main" x="' + (n.x + 12) + '" y="' + (n.y + 34) + '">' + esc(n.label) + '</text>');
    var ly = n.y + 48;
    /* namespace 有給就顯示（與 exports/CLI 同一條件），pod 標記獨立於 ns */
    if (n.namespace) {
      s.push('<text class="leaf-sub" style="fill:' + nsc + '" x="' + (n.x + 12) + '" y="' + ly + '">ns/' +
        esc(n.namespace) + (isPod ? ' · pod' : '') + '</text>');
      ly += 14;
    } else if (isPod) {
      s.push('<text class="leaf-sub" x="' + (n.x + 12) + '" y="' + ly + '">pod</text>');
      ly += 14;
    }
    var ifc = n.iface || n.localIface || '';
    s.push('<text class="leaf-sub" x="' + (n.x + 12) + '" y="' + ly + '">' +
      (ifc ? esc(ifc) + ' · ' : '') + esc(F(n.bps)) + '</text>');
    s.push('<text class="leaf-stop" text-anchor="end" x="' + (n.x + n.w - 12) + '" y="' + (n.y + 17) +
      '">未再往下追</text>');
    s.push('</g>');
    return s.join('');
  }

  function anchorCard(n, model) {
    var inv = model.investigation;
    var s = [];
    s.push('<g>');
    s.push('<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8" ' +
      'fill="#0d1a22" stroke="#22d3ee" stroke-width="1.4" stroke-dasharray="4 3"/>');
    s.push('<text class="leaf-stop" style="fill:#22d3ee" x="' + (n.x + 12) + '" y="' + (n.y + 18) + '">追查起點</text>');
    s.push('<text class="leaf-main" x="' + (n.x + 12) + '" y="' + (n.y + 36) + '">' + esc(inv.iface) + '</text>');
    s.push('<text class="leaf-sub" x="' + (n.x + 12) + '" y="' + (n.y + 52) + '">' +
      esc(n.dirLabel) + ' 方向 · ' + esc(D(inv.deltaBps)) + '</text>');
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
    var amount = (isIn ? '+' : '') + F(sl.bps);
    /* 標籤用描邊光暈，不用不透明底板——底板會在青帶上打出一個黑洞（殘差最後才畫） */
    var halo = 'paint-order:stroke;stroke:#0b1017;stroke-width:3.5px';
    var s = [];
    s.push('<g>');
    s.push('<title>' + esc(n.label + '：' + word + ' ' + F(sl.bps) +
      '（已追查 in ' + F(n.tracedIn) + ' / out ' + F(n.tracedOut) + '）') + '</title>');
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
        (n.hopCount > 1 ? ' <span class="c-dim">(合併 ' + n.hopCount + ' hop)</span>' : '') + '</td>' +
        '<td class="num">' + F(n.tracedIn) + '</td>' +
        '<td class="num">' + F(n.tracedOut) + '</td>' +
        '<td class="num c-amber">' + (resIn(n) ? '+' + F(n.otherIn) : '—') + '</td>' +
        '<td class="num c-rose">' + (resOut(n) ? F(n.otherOut) : '—') + '</td></tr>');
    });
    h.push('</tbody></table></div>');
    /* pod 葉的 namespace 流量小計：圖上的分組色條給觀感，數字彙總在這裡 */
    var pods = model.nodes.filter(function (n) { return n.kind === 'leaf' && n.role === 'pod'; });
    if (pods.some(function (n) { return !!n.namespace; })) {
      var agg = {}, nsOrder = [];
      pods.forEach(function (n) {
        var k = n.namespace || '（無 namespace）';
        if (!agg[k]) { agg[k] = { c: 0, bps: 0 }; nsOrder.push(k); }
        agg[k].c++; agg[k].bps += n.bps;
      });
      nsOrder.sort(function (a, b) { return agg[b].bps - agg[a].bps; });
      h.push('<h3>namespace 流量小計（pod 葉）</h3><div class="tbl-wrap"><table><thead><tr>' +
        '<th>namespace</th><th>pod 數</th><th>Δ 合計</th></tr></thead><tbody>');
      nsOrder.forEach(function (k) {
        h.push('<tr><td>' + esc(k) + '</td><td class="num">' + agg[k].c + '</td>' +
          '<td class="num">' + D(agg[k].bps) + '</td></tr>');
      });
      h.push('</tbody></table></div>');
    }
    h.push('<p class="warn">平衡式：已知 in ＋ 其他輸入 ＝ 已追查 out ＋ 其他輸出。</p>');
    model.warnings.forEach(function (w) { h.push('<p class="warn">⚠ ' + esc(w) + '</p>'); });
    return h.join('');
  }

  global.TraceRender = { render: render, summary: summary, esc: esc };
})(window);
