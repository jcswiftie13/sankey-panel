/* 匯出：Mermaid sankey-beta 與 flowchart。 */
(function (global) {
  'use strict';
  /* 跟圖上同一個門檻（render.js 的 resIn/resOut）：小於 counter 浮點雜訊的殘差不輸出，
     免得 Mermaid 長出一堆圖上看不到的 +2 bps 節點。 */
  function resIn(n) { return n.otherIn > (n.resEps || 0) ? n.otherIn : 0; }
  function resOut(n) { return n.otherOut > (n.resEps || 0) ? n.otherOut : 0; }
  var G = global.TraceModel.gbps, F = global.TraceModel.fmtBps;

  function q(s) {
    s = String(s == null ? '' : s);
    return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function nodeName(n, model) {
    if (n.kind === 'anchor') return '追查起點 ' + model.investigation.iface;
    /* ns 終點自己就是 namespace：括號後綴會變成「telemetry (telemetry)」，
       改用 ns/ 前綴，也避免跟同名 pod 撞名 */
    if (n.role === 'ns') return 'ns/' + n.label;
    /* 葉與 hop 級 namespace（pod 當中繼）都套同一個後綴 */
    return n.label + (n.namespace ? ' (' + n.namespace + ')' : '');
  }
  function id(s) { return 'n_' + String(s).replace(/[^A-Za-z0-9]/g, '_'); }

  function mermaidSankey(model) {
    var L = ['---', 'config:', '  sankey:', '    showValues: true', '---', 'sankey-beta', ''];
    L.push('%% 帶寬單位 Gbps；節點用 switch 名，殘差用「其他輸入／其他輸出」補齊，圖才守恆');
    model.edges.forEach(function (e) {
      var a = model.nodeMap[e.fromId], b = model.nodeMap[e.toId];
      var v = G(e.bps);
      if (v <= 0) return;
      if (e.backward) {   /* sankey-beta 畫不了環 */
        L.push('%% 回流帶略過：' + nodeName(a, model) + ' → ' + nodeName(b, model) + '，' + v);
        return;
      }
      L.push(q(nodeName(a, model)) + ',' + q(nodeName(b, model)) + ',' + v);
    });
    model.nodes.forEach(function (n) {
      if (n.kind !== 'node') return;
      if (resIn(n)) L.push(q('其他輸入 · ' + n.label) + ',' + q(n.label) + ',' + G(n.otherIn));
      if (resOut(n)) L.push(q(n.label) + ',' + q('其他輸出 · ' + n.label) + ',' + G(n.otherOut));
    });
    return L.join('\n');
  }

  function mermaidFlow(model) {
    var L = ['flowchart LR'];
    model.nodes.forEach(function (n) {
      if (n.kind === 'node') {
        var t = n.label + '<br/><small>' + n.id + '</small>' + (n.hopCount > 1 ? '<br/>合併 ' + n.hopCount + ' hop' : '') +
          (n.role === 'pod' && n.namespace ? '<br/>ns/' + n.namespace : '');
        /* root 身分優先掛 :::root（與網頁框色優先序一致），非 root 才依 role 掛 k8s 樣式 */
        var cls = n.isRoot ? ':::root' : (n.role === 'node' ? ':::k8snode' : (n.role === 'pod' ? ':::k8spod' : ''));
        L.push('  ' + id(n.id) + '["' + t + '"]' + cls);
      } else if (n.kind === 'leaf') {
        if (n.role === 'pod') {
          /* pod 是中繼了：不再掛「追查終止／未再往下追」，樣式跟 proxy pod 同家族 */
          L.push('  ' + id(n.id) + '["' + n.label + '<br/>ns/' + n.namespace + '<br/>pod<br/>' +
            F(n.bps) + '"]:::k8spod');
        } else if (n.role === 'ns') {
          L.push('  ' + id(n.id) + '(["ns/' + n.label + '<br/>' + F(n.bps) + '<br/>追查終止"]):::nsleaf');
        } else {
          var lt = '追查終止<br/>' + n.label + (n.namespace ? '<br/>ns/' + n.namespace : '') +
            '<br/>' + F(n.bps) + '<br/>未再往下追';
          L.push('  ' + id(n.id) + '("' + lt + '"):::leaf');
        }
      } else {
        L.push('  ' + id(n.id) + '(["追查起點<br/>' + model.investigation.iface + '<br/>' +
          F(model.investigation.deltaBps) + '"]):::anchor');
      }
    });
    model.edges.forEach(function (e) {
      var a = model.nodeMap[e.fromId], b = model.nodeMap[e.toId];
      var v = F(e.bps);
      /* k8s 內部的邊兩端都沒 iface：標籤只放流量，不畫「? → ?」 */
      var lbl = ((e.fromIface || e.toIface) ? (e.fromIface || '?') + ' → ' + (e.toIface || '?') + '<br/>' : '') +
        v + (e.backward ? '<br/>(回流)' : '');
      var arrow = (b.kind === 'leaf') ? '-. "' + lbl + '" .->' : '-- "' + lbl + '" -->';
      L.push('  ' + id(a.id) + ' ' + arrow + ' ' + id(b.id));
    });
    model.nodes.forEach(function (n) {
      if (n.kind !== 'node') return;
      if (resIn(n)) {
        L.push('  oi_' + id(n.id) + '(["其他輸入<br/>+' + F(n.otherIn) + '"]):::otherin');
        L.push('  oi_' + id(n.id) + ' -.-> ' + id(n.id));
      }
      if (resOut(n)) {
        L.push('  oo_' + id(n.id) + '(["其他輸出<br/>' + F(n.otherOut) + '<br/>截斷"]):::otherout');
        L.push('  ' + id(n.id) + ' -.-> oo_' + id(n.id));
      }
    });
    L.push('  classDef root stroke:#22d3ee,stroke-width:2px;');
    L.push('  classDef k8snode stroke:#7dd3fc,stroke-dasharray:6 4;');
    /* 有 pod（中繼 hop 或 pod 葉）才輸出（其他 classDef 是一開始就有的，維持既有輸出逐 byte 不變） */
    if (model.nodes.some(function (n) {
      return n.role === 'pod' && !(n.kind === 'node' && n.isRoot);
    })) {
      L.push('  classDef k8spod stroke:#7dd3fc,stroke-dasharray:2 3;');
    }
    /* ns 終點同理：只有 k8s 圖才長這行 */
    if (model.nodes.some(function (n) { return n.role === 'ns'; })) {
      L.push('  classDef nsleaf stroke:#a78bfa,color:#a78bfa;');
    }
    L.push('  classDef leaf stroke:#94a3b8,stroke-dasharray:5 4,color:#94a3b8;');
    L.push('  classDef anchor stroke:#22d3ee,stroke-dasharray:4 3;');
    L.push('  classDef otherin stroke:#f59e0b,stroke-dasharray:4 3,color:#f59e0b;');
    L.push('  classDef otherout stroke:#fb7185,stroke-dasharray:4 3,color:#fb7185;');
    return L.join('\n');
  }

  global.TraceExports = { mermaidSankey: mermaidSankey, mermaidFlow: mermaidFlow };
})(window);
