/* SVG Sankey 繪製：青帶＝已追查、殘差＝盒子外側與帶寬等比的虛線色塊、終止＝灰虛線小卡。 */
(function (global) {
  'use strict';
  var F = global.TraceModel.fmtBps;

  var NODE_W = 208, LEAF_W = 178, ANCHOR_W = 152;
  var HEADER_H = 36, ROW_H = 24, ROW_GAP = 9, BODY_PAD = 12, BODY_MIN = 26;
  var COL_GAP = 218, VGAP = 34;
  var PAD_TOP = 46, PAD_BOTTOM = 26, PAD_SIDE = 122;
  var THICK_MAX = 86, THICK_MIN = 3;
  var RES_LEN = 34, RES_GAP = 8;   /* 高度改用 thick()，不再有固定的 RES_H／RES_PAD */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function leafH(n) { return n.role === 'pod' ? 80 : 70; }

  /* 殘差門檻用 model 算好的 resEps：小於 counter 浮點雜訊的殘差不畫，也不佔版面。
     注意這是「相對這台自己流量」的判斷，粗細卻是全圖 maxVal 的比例——
     小 hop 的真殘差可能過得了門檻但只有 THICK_MIN 這麼細，那是對的。 */
  function resIn(n) { return n.kind === 'node' && n.otherIn > (n.resEps || 0) ? n.otherIn : 0; }
  function resOut(n) { return n.kind === 'node' && n.otherOut > (n.resEps || 0) ? n.otherOut : 0; }

  function layout(model) {
    var nodes = model.nodes, edges = model.edges;

    /* 殘差跟青帶共用同一把比例尺，比例才讀得出來。殘差比所有邊都大時青帶會變細，
       那正是「沒追到的佔大多數」該有的觀感。 */
    var maxVal = 0;
    edges.forEach(function (e) { maxVal = Math.max(maxVal, e.bps); });
    nodes.forEach(function (n) { maxVal = Math.max(maxVal, resIn(n), resOut(n)); });
    if (maxVal <= 0) maxVal = 1;
    var scale = THICK_MAX / maxVal;
    var thick = function (v) { return Math.max(THICK_MIN, v * scale); };

    /* 每個節點的 port 槽位。橫向邊（同 tier 同欄互連）兩端都掛右側：
       弧帶整條活在欄右側的間隙，受端若從左邊進就得繞過整個盒子。 */
    nodes.forEach(function (n) {
      n.leftSlots = n.inEdges.filter(function (e) { return !e.lateral; }).map(function (e) {
        return { edge: e, role: 'in', iface: e.toIface, t: thick(e.bps) };
      });
      n.rightSlots = n.outEdges.filter(function (e) { return !e.lateral; }).map(function (e) {
        return { edge: e, role: 'out', iface: e.fromIface, t: thick(e.bps) };
      }).concat(n.outEdges.filter(function (e) { return e.lateral; }).map(function (e) {
        return { edge: e, role: 'lat-out', iface: e.fromIface, t: thick(e.bps) };
      })).concat(n.inEdges.filter(function (e) { return e.lateral; }).map(function (e) {
        return { edge: e, role: 'lat-in', iface: e.toIface, t: thick(e.bps) };
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
      col.sort(function (a, b) {
        return (a.__pref - b.__pref) || ((a.subOrder || 0) - (b.subOrder || 0)) || (a.__ord - b.__ord);
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

    /* port 中心點 */
    nodes.forEach(function (n) {
      var top = n.kind === 'node' ? n.y + HEADER_H : n.y;
      var avail = n.kind === 'node' ? n.h - HEADER_H - BODY_PAD : n.h;
      place(n.leftSlots, top, avail);
      place(n.rightSlots, top, avail);
      n.leftSlots.forEach(function (s) {
        if (!s.edge) return;                       /* 殘差槽沒有 edge */
        s.edge.x2 = n.x; s.edge.y2 = s.cy; s.edge.t2 = s.t;
      });
      n.rightSlots.forEach(function (s) {
        if (!s.edge) return;
        if (s.role === 'lat-in') { s.edge.x2 = n.x + n.w; s.edge.y2 = s.cy; s.edge.t2 = s.t; }
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

    return { cols: cols, colX: colX, width: totalW, height: Math.max(totalH, 220), thick: thick };

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
        fi: e.fromIface, ti: e.toIface, bps: e.bps, attr: e.attr, anchor: !!e.isAnchor,
        lateral: e.lateral || undefined      /* stringify 會把 undefined 丟掉：沒 tier 的圖輸出不變 */
      };
      out.push('<path class="band' + (e.lateral ? ' band-lat' : '') + '" d="' +
        (e.lateral ? lateralRibbon(e, e.bulge) : ribbon(e)) + '" fill="url(#gband)" ' +
        'stroke="#22d3ee" stroke-opacity=".35" stroke-width="1" ' +
        'data-tip="' + esc(JSON.stringify(meta)) + '"><title>' +
        esc(meta.from + ' ' + e.fromIface + ' → ' + meta.to + ' ' + e.toIface + '：' + F(e.bps) +
          (e.lateral ? '（同層互連）' : '')) +
        '</title></path>');
    });

    /* 帶上的數字。橫向弧帶的數字放弧頂，放中點會壓在欄上 */
    model.edges.forEach(function (e) {
      var mx = e.lateral ? e.x1 + 0.72 * e.bulge : (e.x1 + e.x2) / 2;
      var my = (e.y1 + e.y2) / 2;
      out.push('<text x="' + mx + '" y="' + (my + 4) + '" text-anchor="middle" class="p-val" ' +
        'style="paint-order:stroke;stroke:#0b1017;stroke-width:3.5px">' + esc(F(e.bps)) + '</text>');
    });

    /* 盒子 */
    model.nodes.forEach(function (n) {
      if (n.kind === 'node') out.push(nodeBox(n, model));
      else if (n.kind === 'leaf') out.push(leafCard(n));
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
    if (kinds.node) return '第 ' + col[0].col + ' 跳';
    return '追查終止';
  }

  function nodeBox(n, model) {
    var isK8sNode = n.role === 'node';
    var s = [];
    s.push('<g>');
    s.push('<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="9" ' +
      'fill="#101c28" stroke="' + (isK8sNode ? '#7dd3fc' : (n.isRoot ? '#22d3ee' : '#2c3e52')) + '" ' +
      'stroke-width="' + (n.isRoot ? 1.8 : 1.2) + '"' + (isK8sNode ? ' stroke-dasharray="6 4"' : '') + '/>');
    s.push('<line x1="' + n.x + '" y1="' + (n.y + HEADER_H - 6) + '" x2="' + (n.x + n.w) +
      '" y2="' + (n.y + HEADER_H - 6) + '" stroke="#22303f"/>');
    s.push('<text class="n-title" x="' + (n.x + 12) + '" y="' + (n.y + 17) + '">' + esc(n.label) +
      (n.hopCount > 1 ? ' <tspan class="n-sub">×' + n.hopCount + ' hop 合併</tspan>' : '') + '</text>');
    s.push('<text class="n-sub" x="' + (n.x + 12) + '" y="' + (n.y + 29) + '">' + esc(n.id) +
      (isK8sNode ? ' · node' : '') + '</text>');

    n.leftSlots.forEach(function (sl) {
      if (sl.res) return;                          /* 殘差的標籤畫在盒子外面 */
      s.push('<text class="p-label" x="' + (n.x + 10) + '" y="' + (sl.cy + 3.5) + '">' + esc(sl.iface) + '</text>');
    });
    n.rightSlots.forEach(function (sl) {
      if (sl.res) return;
      s.push('<text class="p-label" text-anchor="end" x="' + (n.x + n.w - 10) + '" y="' + (sl.cy + 3.5) + '">' +
        esc(sl.iface) + '</text>');
    });
    s.push('</g>');
    return s.join('');
  }

  function leafCard(n) {
    var s = [];
    var isPod = n.role === 'pod';
    s.push('<g>');
    s.push('<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8" ' +
      'fill="#0e151d" stroke="#94a3b8" stroke-opacity=".65" stroke-width="1.1" stroke-dasharray="5 4"/>');
    s.push('<text class="leaf-stop" x="' + (n.x + 12) + '" y="' + (n.y + 17) + '">追查終止</text>');
    s.push('<text class="leaf-main" x="' + (n.x + 12) + '" y="' + (n.y + 34) + '">' + esc(n.label) + '</text>');
    var ly = n.y + 48;
    if (isPod && n.namespace) {
      s.push('<text class="leaf-sub" x="' + (n.x + 12) + '" y="' + ly + '">ns/' + esc(n.namespace) + ' · pod</text>');
      ly += 14;
    }
    s.push('<text class="leaf-sub" x="' + (n.x + 12) + '" y="' + ly + '">' + esc(n.iface || n.localIface || '') +
      ' · ' + esc(F(n.bps)) + '</text>');
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
      esc(n.dirLabel) + ' 方向 · ' + esc(F(inv.deltaBps)) + '</text>');
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
    var dir = model.dir;
    var rows = model.nodes.filter(function (n) { return n.kind === 'node'; })
      .sort(function (a, b) { return a.col - b.col; });
    var h = ['<h3>hop 數字摘要（圖外資訊）</h3><div class="tbl-wrap"><table><thead><tr>',
      '<th>hop</th><th>追查輸入</th><th>出口增加</th><th class="c-amber">其他進</th>',
      '<th class="c-rose">其他出</th><th class="c-cyan">可歸因</th></tr></thead><tbody>'];
    rows.forEach(function (n) {
      var known = dir === 'destination' ? n.tracedIn : n.tracedIn;
      h.push('<tr><td>' + esc(n.label) + ' <span class="c-dim">' + esc(n.id) + '</span>' +
        (n.hopCount > 1 ? ' <span class="c-dim">(合併 ' + n.hopCount + ' hop)</span>' : '') + '</td>' +
        '<td class="num">' + F(known) + '</td>' +
        '<td class="num">' + F(n.tracedOut) + '</td>' +
        '<td class="num c-amber">' + (resIn(n) ? '+' + F(n.otherIn) : '—') + '</td>' +
        '<td class="num c-rose">' + (resOut(n) ? F(n.otherOut) : '—') + '</td>' +
        '<td class="num c-cyan">' + F(dir === 'destination' ? n.attrOut : n.attrIn) + '</td></tr>');
    });
    h.push('</tbody></table></div>');
    h.push('<p class="warn">平衡式：已知 in ＋ 其他輸入 ＝ 已追查 out ＋ 其他輸出。</p>');
    model.warnings.forEach(function (w) { h.push('<p class="warn">⚠ ' + esc(w) + '</p>'); });
    return h.join('');
  }

  global.TraceRender = { render: render, summary: summary, esc: esc };
})(window);
