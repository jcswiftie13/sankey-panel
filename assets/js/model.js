/* 追查 JSON -> 圖模型：合併同一台 switch、算殘差、算可歸因量。 */
(function (global) {
  'use strict';

  function fmtBps(bps) {
    var n = Number(bps) || 0, a = Math.abs(n);
    if (a >= 1e12) return round(n / 1e12) + ' Tbps';
    if (a >= 1e9) return round(n / 1e9) + ' Gbps';
    if (a >= 1e6) return round(n / 1e6) + ' Mbps';
    if (a >= 1e3) return round(n / 1e3) + ' kbps';
    return round(n) + ' bps';
  }
  function round(v) {
    var r = Math.round(v * 100) / 100;
    return String(r);
  }
  function gbps(bps) { return Math.round((Number(bps) || 0) / 1e8) / 10; }

  function num(v) { return typeof v === 'number' && isFinite(v); }

  /* ---------- 驗證 ---------- */
  function validate(doc) {
    var errs = [];
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      return ['最外層必須是 JSON 物件。'];
    }
    var inv = doc.investigation;
    if (!inv || typeof inv !== 'object') {
      errs.push('缺少 investigation。');
    } else {
      if (!inv.switchId) errs.push('investigation.switchId 必填。');
      if (!inv.iface) errs.push('investigation.iface 必填。');
      if (!num(inv.deltaBps) || inv.deltaBps <= 0) errs.push('investigation.deltaBps 必須是正數（bps）。');
      if (inv.direction && inv.direction !== 'in' && inv.direction !== 'out') {
        errs.push('investigation.direction 只能是 "in" 或 "out"。');
      }
    }
    if (doc.kind && doc.kind !== 'destination' && doc.kind !== 'source') {
      errs.push('kind 只能是 "destination" 或 "source"。');
    }
    if (!Array.isArray(doc.hops) || doc.hops.length === 0) {
      errs.push('hops 必須是非空陣列。');
    } else {
      doc.hops.forEach(function (h, i) {
        if (!h || typeof h !== 'object') { errs.push('hops[' + i + '] 不是物件。'); return; }
        if (!h.switchId) errs.push('hops[' + i + '].switchId 必填。');
        if (h.tier != null && (typeof h.tier !== 'string' || !h.tier)) {
          errs.push('hops[' + i + '].tier 必須是非空字串。');
        }
        ['outputs', 'inputs'].forEach(function (k) {
          if (h[k] == null) return;
          if (!Array.isArray(h[k])) { errs.push('hops[' + i + '].' + k + ' 必須是陣列。'); return; }
          h[k].forEach(function (p, j) {
            if (!p || typeof p !== 'object') { errs.push('hops[' + i + '].' + k + '[' + j + '] 不是物件。'); return; }
            if (!p.iface) errs.push('hops[' + i + '].' + k + '[' + j + '].iface 必填。');
            if (!num(p.deltaBps) || p.deltaBps < 0) errs.push('hops[' + i + '].' + k + '[' + j + '].deltaBps 必須是非負數。');
          });
        });
      });
    }
    return errs;
  }

  function direction(doc) {
    if (doc.kind === 'source') return 'source';
    if (doc.kind === 'destination') return 'destination';
    if (doc.investigation && doc.investigation.direction === 'out') return 'source';
    return 'destination';
  }

  /* ---------- 建圖 ---------- */
  function build(doc) {
    var errs = validate(doc);
    if (errs.length) return { ok: false, errors: errs };

    var dir = direction(doc);
    var inv = doc.investigation;
    var pruning = doc.pruning || {};
    var warnings = [];

    /* 1. 依 switchId 合併 hop（雙 uplink 匯入核心 = 一個盒子） */
    var nodes = {}, order = [];
    doc.hops.forEach(function (h) {
      var n = nodes[h.switchId];
      if (!n) {
        n = nodes[h.switchId] = {
          id: h.switchId, label: h.label || h.switchId, role: h.role || 'switch',
          kind: 'node', hopCount: 0, tier: null,
          portsOut: {}, portsIn: {}, otherInBps: null, otherOutBps: null,
          inEdges: [], outEdges: [], col: 0
        };
        order.push(h.switchId);
      }
      n.hopCount++;
      if (h.label) n.label = h.label;
      if (h.role) n.role = h.role;
      if (h.tier) {
        if (n.tier == null) n.tier = h.tier;
        else if (n.tier !== h.tier) {
          warnings.push(n.label + '：同一台在不同 hop 給了不同 tier（' + n.tier + '、' + h.tier +
            '），採用先出現的 ' + n.tier + '。');
        }
      }
      if (num(h.otherInBps)) n.otherInBps = (n.otherInBps || 0) + h.otherInBps;
      if (num(h.otherOutBps)) n.otherOutBps = (n.otherOutBps || 0) + h.otherOutBps;

      var side = dir === 'destination' ? 'outputs' : 'inputs';
      var bag = dir === 'destination' ? n.portsOut : n.portsIn;
      (h[side] || []).forEach(function (p) {
        var key = p.iface + '|' + (p.peerSwitchId || p.peerId || '');
        var cur = bag[key];
        if (!cur) {
          cur = bag[key] = {
            iface: p.iface, deltaBps: 0, peerKind: p.peerKind || null,
            peerId: p.peerId || null, peerSwitchId: p.peerSwitchId || null,
            peerIface: p.peerIface || null, namespace: p.namespace || null
          };
        }
        cur.deltaBps += p.deltaBps;
      });
    });

    if (!nodes[inv.switchId]) {
      return { ok: false, errors: ['investigation.switchId「' + inv.switchId + '」在 hops 裡找不到。'] };
    }

    /* 2. 邊：一律照封包方向（左 -> 右） */
    var edges = [], leafSeq = 0;
    order.forEach(function (id) {
      var n = nodes[id];
      var bag = dir === 'destination' ? n.portsOut : n.portsIn;
      Object.keys(bag).forEach(function (k) {
        var p = bag[k];
        var peerKey = p.peerSwitchId || p.peerId;
        var peerNode = peerKey && nodes[peerKey] ? nodes[peerKey] : null;
        var e;
        if (dir === 'destination') {
          if (peerNode) {
            e = mkEdge(n, peerNode, p.iface, p.peerIface || '', p);
          } else {
            var leaf = mkLeaf(p, 'leaf-' + (++leafSeq), dir);
            nodes[leaf.id] = leaf; order.push(leaf.id);
            e = mkEdge(n, leaf, p.iface, p.peerIface || '', p);
          }
        } else {
          if (peerNode) {
            e = mkEdge(peerNode, n, p.peerIface || '', p.iface, p);
          } else {
            var leaf2 = mkLeaf(p, 'leaf-' + (++leafSeq), dir);
            nodes[leaf2.id] = leaf2; order.push(leaf2.id);
            e = mkEdge(leaf2, n, p.peerIface || '', p.iface, p);
          }
        }
        edges.push(e);
      });
    });

    /* 3. 追查起點錨卡：追終點在最左，追來源在最右 */
    var root = nodes[inv.switchId];
    root.isRoot = true;
    var anchor = {
      id: '__anchor__', label: '追查起點', kind: 'anchor', role: 'anchor',
      iface: inv.iface, note: inv.note || '', dirLabel: dir === 'destination' ? 'in' : 'out',
      inEdges: [], outEdges: [], col: 0
    };
    nodes[anchor.id] = anchor; order.push(anchor.id);
    var anchorEdge;
    if (dir === 'destination') {
      anchorEdge = mkEdge(anchor, root, inv.iface, inv.iface,
        { deltaBps: inv.deltaBps, peerKind: 'anchor' });
    } else {
      anchorEdge = mkEdge(root, anchor, inv.iface, inv.iface,
        { deltaBps: inv.deltaBps, peerKind: 'anchor' });
    }
    anchorEdge.isAnchor = true;
    edges.push(anchorEdge);

    /* 4. 掛邊到節點 */
    edges.forEach(function (e, i) {
      e.id = 'e' + i;
      nodes[e.fromId].outEdges.push(e);
      nodes[e.toId].inEdges.push(e);
    });

    /* 5. 欄位（最長路徑），封包方向左到右。
       同 tier 的節點視為一個超級節點：整群共用一個欄位，彼此之間的邊不參與排欄，
       同層互連（如 bdr↔dci）才不會把同一層拆成兩欄。沒標 tier 的自成一群，
       全部沒標時每群都是單節點，行為與純最長路徑相同。 */
    var ids = order.slice();
    var groupOf = {}, groupIds = [];
    ids.forEach(function (id) {
      var g = nodes[id].tier != null ? 't:' + nodes[id].tier : 'n:' + id;
      groupOf[id] = g;
      if (groupIds.indexOf(g) < 0) groupIds.push(g);
    });
    /* 5a. 聚合群組間每個方向的總流量 */
    var gflow = {};
    edges.forEach(function (e) {
      var ga = groupOf[e.fromId], gb = groupOf[e.toId];
      if (ga === gb) return;
      var k = ga + '\u0000' + gb;
      gflow[k] = (gflow[k] || 0) + e.bps;
    });
    function groupLabel(g) {
      return g.charAt(0) === 't' ? 'tier「' + g.slice(2) + '」' : nodes[g.slice(2)].label;
    }

    /* 5b. 兩群之間雙向都有流量＝繞成環。流量多數決：總量小的方向整組退出排欄，
       畫成回流帶——tier 永遠鎖同一欄，不再整個放棄。平手時保留先出現的群當上游。 */
    var gdropped = {};
    Object.keys(gflow).forEach(function (k) {
      var p = k.split('\u0000'), rk = p[1] + '\u0000' + p[0];
      if (gflow[rk] == null || gdropped[k] || gdropped[rk]) return;
      var loser = k;
      if (gflow[k] > gflow[rk] ||
          (gflow[k] === gflow[rk] && groupIds.indexOf(p[0]) < groupIds.indexOf(p[1]))) {
        loser = rk;
      }
      gdropped[loser] = true;
      var lp = loser.split('\u0000');
      warnings.push(groupLabel(lp[0]) + ' → ' + groupLabel(lp[1]) + ' 逆著多數流量方向（' +
        fmtBps(gflow[loser]) + '，對向 ' + fmtBps(gflow[lp[1] + '\u0000' + lp[0]]) +
        '），畫成回流帶，不參與排欄。');
    });

    /* 5c. 多數決只看成對的兩群，繞經三群以上的環可能還在：
       反覆移除環上（SCC 內）總流量最小的群組邊，每輪至少移一條，必然終止。 */
    function sccOf(live) {
      var adj = {}, radj = {};
      groupIds.forEach(function (g) { adj[g] = []; radj[g] = []; });
      live.forEach(function (k) {
        var p = k.split('\u0000');
        adj[p[0]].push(p[1]); radj[p[1]].push(p[0]);
      });
      var seen = {}, post = [];
      groupIds.forEach(function dfs(g) {
        if (seen[g]) return;
        seen[g] = true;
        adj[g].forEach(dfs);
        post.push(g);
      });
      var id = {}, size = [];
      for (var i = post.length - 1; i >= 0; i--) {
        if (id[post[i]] != null) continue;
        var cur = size.length;
        size.push(0);
        var stack = [post[i]];
        while (stack.length) {
          var v = stack.pop();
          if (id[v] != null) continue;
          id[v] = cur; size[cur]++;
          radj[v].forEach(function (w) { if (id[w] == null) stack.push(w); });
        }
      }
      return { id: id, size: size };
    }
    for (;;) {
      var live = Object.keys(gflow).filter(function (k) { return !gdropped[k]; });
      /* 兩端同屬一個大小 >1 的強連通分量（SCC）的邊才真的在環上——
         光看 Kahn 排不進誰會把環的「下游」也圈進來，誤刪無辜的邊 */
      var scc = sccOf(live);
      var victim = null;
      live.forEach(function (k) {
        var p = k.split('\u0000');
        if (scc.id[p[0]] === scc.id[p[1]] && scc.size[scc.id[p[0]]] > 1 &&
            (victim == null || gflow[k] < gflow[victim])) victim = k;
      });
      if (victim == null) break;
      gdropped[victim] = true;
      var vp = victim.split('\u0000');
      warnings.push('群組間仍繞成環，移除其中流量最小的 ' + groupLabel(vp[0]) + ' → ' +
        groupLabel(vp[1]) + '（' + fmtBps(gflow[victim]) + '）破環，該方向畫成回流帶。');
    }

    /* 5d. 標記退出排欄的邊，在破環後的群組 DAG 上跑最長路徑（保證收斂） */
    edges.forEach(function (e) {
      var ga = groupOf[e.fromId], gb = groupOf[e.toId];
      e.dropped = ga !== gb && !!gdropped[ga + '\u0000' + gb];
    });
    var gcol = {};
    groupIds.forEach(function (g) { gcol[g] = 0; });
    for (var gpass = 0; gpass < groupIds.length + 2; gpass++) {
      var gmoved = false;
      edges.forEach(function (e) {
        if (e.dropped) return;
        var ga = groupOf[e.fromId], gb = groupOf[e.toId];
        if (ga === gb) return;
        if (gcol[gb] < gcol[ga] + 1) { gcol[gb] = gcol[ga] + 1; gmoved = true; }
      });
      if (!gmoved) break;
    }
    if (gpass >= groupIds.length + 2) warnings.push('拓樸疑似有環，欄位順序可能不準。');
    ids.forEach(function (id) { nodes[id].col = gcol[groupOf[id]]; });

    /* 5e. 排完欄仍逆向（col 遞減）的邊畫成回流帶 */
    edges.forEach(function (e) {
      e.backward = nodes[e.fromId].col > nodes[e.toId].col;
    });

    /* 5b. 同欄的邊＝tier 內的橫向互連，render 畫成右側弧帶 */
    edges.forEach(function (e) {
      e.lateral = nodes[e.fromId].col === nodes[e.toId].col;
    });

    /* 5c. tier 群內的拓樸子順序：歸因遍歷同欄平手時，得先算生產者再算消費者 */
    ids.forEach(function (id) { nodes[id].subOrder = 0; });
    var tierMembers = {};
    ids.forEach(function (id) {
      var t = nodes[id].tier;
      if (t != null) (tierMembers[t] = tierMembers[t] || []).push(id);
    });
    Object.keys(tierMembers).forEach(function (t) {
      var members = tierMembers[t];
      if (members.length < 2) return;
      var inGroup = {}, indeg = {}, adj = {};
      members.forEach(function (id) { inGroup[id] = true; indeg[id] = 0; adj[id] = []; });
      edges.forEach(function (e) {
        if (inGroup[e.fromId] && inGroup[e.toId]) { adj[e.fromId].push(e.toId); indeg[e.toId]++; }
      });
      var queue = members.filter(function (id) { return indeg[id] === 0; });
      var seq = 0, popped = {};
      while (queue.length) {
        var cur = queue.shift();
        popped[cur] = true;
        nodes[cur].subOrder = seq++;
        adj[cur].forEach(function (m) { if (--indeg[m] === 0) queue.push(m); });
      }
      if (seq < members.length) {
        warnings.push('tier「' + t + '」內部有環，環上的量無法完整歸因。');
        members.forEach(function (id) { if (!popped[id]) nodes[id].subOrder = seq++; });
      }
    });

    /* 6. 每台的守恆與殘差 */
    ids.forEach(function (id) {
      var n = nodes[id];
      if (n.kind !== 'node') return;
      n.tracedIn = sum(n.inEdges);
      n.tracedOut = sum(n.outEdges);
      var left = n.tracedIn, right = n.tracedOut;
      var eps = Math.max(left, right) * 0.005 + 1;   /* 讀 counter 的浮點雜訊門檻 */
      var oi = n.otherInBps, oo = n.otherOutBps;
      if (num(oi) && num(oo)) {
        var gap = (left + oi) - (right + oo);
        if (Math.abs(gap) > eps) {
          warnings.push(n.label + '：顯式的 otherInBps/otherOutBps 對不上（差 ' + fmtBps(gap) + '），圖照顯式值畫。');
        }
      } else if (num(oo)) {
        oi = Math.max(0, right + oo - left);
      } else if (num(oi)) {
        oo = Math.max(0, left + oi - right);
      } else {
        var d = right - left;
        oi = Math.max(0, d); oo = Math.max(0, -d);
      }
      n.otherIn = oi || 0;
      n.otherOut = oo || 0;
      n.totalIn = n.tracedIn + n.otherIn;
      n.totalOut = n.tracedOut + n.otherOut;
      n.resEps = eps;        /* 圖上小於這個值的殘差不畫，見 render.js 的 resIn/resOut */
    });

    /* 7. 可歸因量：從追查起點往下（或往回）依比例分配。
       遍歷順序用「破環後 DAG 的拓樸序」而不是單純的 (col, subOrder)：
       回流帶（dropped）的邊不進拓樸序，它分到的量不再往下攤，避免循環放大。 */
    var indegN = {}, adjN = {};
    ids.forEach(function (id) { indegN[id] = 0; adjN[id] = []; });
    edges.forEach(function (e) {
      if (e.dropped) return;
      adjN[e.fromId].push(e.toId); indegN[e.toId]++;
    });
    function byColSub(a, b) {
      return (nodes[a].col - nodes[b].col) || (nodes[a].subOrder - nodes[b].subOrder);
    }
    var topo = [], inTopo = {};
    var ready = ids.filter(function (id) { return indegN[id] === 0; }).sort(byColSub);
    while (ready.length) {
      var tcur = ready.shift();
      topo.push(tcur); inTopo[tcur] = true;
      adjN[tcur].forEach(function (m) { if (--indegN[m] === 0) ready.push(m); });
      ready.sort(byColSub);   /* 平手時維持與舊版一致的 (col, subOrder) 順序 */
    }
    if (topo.length < ids.length) {   /* tier 內部有環時排不完，5c 已有 warning */
      topo = topo.concat(ids.filter(function (id) { return !inTopo[id]; }).sort(byColSub));
    }
    var topoIdx = {};
    topo.forEach(function (id, i) { topoIdx[id] = i; });

    edges.forEach(function (e) { e.attr = 0; });
    if (dir === 'destination') {
      anchorEdge.attr = inv.deltaBps;
      topo.forEach(function (id) {
        var n = nodes[id];
        if (n.kind !== 'node') return;
        var inAttr = n.inEdges.reduce(function (s, e) { return s + e.attr; }, 0);
        var denom = n.tracedOut + n.otherOut;
        n.attrIn = inAttr;
        n.attrOut = denom > 0 ? inAttr * (n.tracedOut / denom) : 0;
        n.outEdges.forEach(function (e) {
          e.attr = denom > 0 ? inAttr * (e.bps / denom) : 0;
        });
      });
    } else {
      anchorEdge.attr = inv.deltaBps;
      topo.slice().reverse().forEach(function (id) {
        var n = nodes[id];
        if (n.kind !== 'node') return;
        var outAttr = n.outEdges.reduce(function (s, e) { return s + e.attr; }, 0);
        var denom = n.tracedIn + n.otherIn;
        n.attrOut = outAttr;
        n.attrIn = denom > 0 ? outAttr * (n.tracedIn / denom) : 0;
        n.inEdges.forEach(function (e) {
          e.attr = denom > 0 ? outAttr * (e.bps / denom) : 0;
        });
      });
    }
    /* 接收端在拓樸序上比來源端早的邊（回流帶），分到的量已無法再往下攤 */
    var lostAttr = 0;
    edges.forEach(function (e) {
      if ((e.dropped || e.backward) && topoIdx[e.fromId] > topoIdx[e.toId]) lostAttr += e.attr;
    });
    if (lostAttr > 1) {
      warnings.push('回流帶累計 ' + fmtBps(lostAttr) +
        ' 的可歸因量流回上游，為避免循環放大不再往下攤分，僅顯示在回流帶上。');
    }

    ids.forEach(function (id) {
      var n = nodes[id];
      if (n.kind === 'leaf') {
        var e = dir === 'destination' ? n.inEdges[0] : n.outEdges[0];
        n.bps = e ? e.bps : 0;
        n.attr = e ? e.attr : 0;
      }
    });

    /* 8. 正規化欄位 */
    var minCol = Infinity;
    ids.forEach(function (id) { minCol = Math.min(minCol, nodes[id].col); });
    ids.forEach(function (id) { nodes[id].col -= minCol; });

    var list = ids.map(function (id) { return nodes[id]; });
    return {
      ok: true, dir: dir, investigation: inv, pruning: pruning,
      nodes: list, nodeMap: nodes, edges: edges, anchorEdge: anchorEdge,
      root: root, warnings: warnings,
      maxCol: list.reduce(function (m, n) { return Math.max(m, n.col); }, 0)
    };

    function mkEdge(a, b, fromIface, toIface, p) {
      return {
        fromId: a.id, toId: b.id, fromIface: fromIface || '', toIface: toIface || '',
        bps: p.deltaBps, attr: 0, peerKind: p.peerKind || null, namespace: p.namespace || null
      };
    }
    function mkLeaf(p, id, d) {
      return {
        id: id, kind: 'leaf', role: p.peerKind === 'pod' ? 'pod' : 'leaf',
        label: p.peerId || p.peerSwitchId || (d === 'destination' ? p.iface : p.iface),
        iface: p.peerIface || p.iface, localIface: p.iface,
        peerKind: p.peerKind || null, namespace: p.namespace || null,
        inEdges: [], outEdges: [], col: 0
      };
    }
  }

  function sum(edges) { return edges.reduce(function (s, e) { return s + e.bps; }, 0); }

  global.TraceModel = { build: build, validate: validate, direction: direction, fmtBps: fmtBps, gbps: gbps };
})(window);
