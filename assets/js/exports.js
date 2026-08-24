/* 匯出：Mermaid sankey-beta 與 flowchart。 */
(function (global) {
  'use strict';
  var G = global.TraceModel.gbps, F = global.TraceModel.fmtBps;

  function q(s) {
    s = String(s == null ? '' : s);
    return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function nodeName(n, model) {
    if (n.kind === 'anchor') return '追查起點 ' + model.investigation.iface;
    if (n.kind === 'leaf') return n.label + (n.namespace ? ' (' + n.namespace + ')' : '');
    return n.label;
  }
  function id(s) { return 'n_' + String(s).replace(/[^A-Za-z0-9]/g, '_'); }

  function mermaidSankey(model) {
    var L = ['---', 'config:', '  sankey:', '    showValues: true', '---', 'sankey-beta', ''];
    L.push('%% 帶寬單位 Gbps；節點用 switch 名，殘差用「其他輸入／其他輸出」補齊，圖才守恆');
    model.edges.forEach(function (e) {
      var a = model.nodeMap[e.fromId], b = model.nodeMap[e.toId];
      var v = G(e.bps);
      if (v <= 0) return;
      L.push(q(nodeName(a, model)) + ',' + q(nodeName(b, model)) + ',' + v);
    });
    model.nodes.forEach(function (n) {
      if (n.kind !== 'node') return;
      if (n.otherIn > 0) L.push(q('其他輸入 · ' + n.label) + ',' + q(n.label) + ',' + G(n.otherIn));
      if (n.otherOut > 0) L.push(q(n.label) + ',' + q('其他輸出 · ' + n.label) + ',' + G(n.otherOut));
    });
    return L.join('\n');
  }

  function mermaidFlow(model) {
    var L = ['flowchart LR'];
    model.nodes.forEach(function (n) {
      if (n.kind === 'node') {
        var t = n.label + '<br/><small>' + n.id + '</small>' + (n.hopCount > 1 ? '<br/>合併 ' + n.hopCount + ' hop' : '');
        L.push('  ' + id(n.id) + (n.role === 'node' ? '["' + t + '"]:::k8snode' : '["' + t + '"]' +
          (n.isRoot ? ':::root' : '')));
      } else if (n.kind === 'leaf') {
        var lt = '追查終止<br/>' + n.label + (n.namespace ? '<br/>ns/' + n.namespace : '') +
          '<br/>' + F(n.bps) + '<br/>未再往下追';
        L.push('  ' + id(n.id) + '("' + lt + '"):::leaf');
      } else {
        L.push('  ' + id(n.id) + '(["追查起點<br/>' + model.investigation.iface + '<br/>' +
          F(model.investigation.deltaBps) + '"]):::anchor');
      }
    });
    model.edges.forEach(function (e) {
      var a = model.nodeMap[e.fromId], b = model.nodeMap[e.toId];
      var v = F(e.bps);
      var lbl = (e.fromIface || '?') + ' → ' + (e.toIface || '?') + '<br/>' + v;
      var arrow = (b.kind === 'leaf') ? '-. "' + lbl + '" .->' : '-- "' + lbl + '" -->';
      L.push('  ' + id(a.id) + ' ' + arrow + ' ' + id(b.id));
    });
    model.nodes.forEach(function (n) {
      if (n.kind !== 'node') return;
      if (n.otherIn > 0) {
        L.push('  oi_' + id(n.id) + '(["其他輸入<br/>+' + F(n.otherIn) + '"]):::otherin');
        L.push('  oi_' + id(n.id) + ' -.-> ' + id(n.id));
      }
      if (n.otherOut > 0) {
        L.push('  oo_' + id(n.id) + '(["其他輸出<br/>' + F(n.otherOut) + '<br/>截斷"]):::otherout');
        L.push('  ' + id(n.id) + ' -.-> oo_' + id(n.id));
      }
    });
    L.push('  classDef root stroke:#22d3ee,stroke-width:2px;');
    L.push('  classDef k8snode stroke:#7dd3fc,stroke-dasharray:6 4;');
    L.push('  classDef leaf stroke:#94a3b8,stroke-dasharray:5 4,color:#94a3b8;');
    L.push('  classDef anchor stroke:#22d3ee,stroke-dasharray:4 3;');
    L.push('  classDef otherin stroke:#f59e0b,stroke-dasharray:4 3,color:#f59e0b;');
    L.push('  classDef otherout stroke:#fb7185,stroke-dasharray:4 3,color:#fb7185;');
    return L.join('\n');
  }

  global.TraceExports = { mermaidSankey: mermaidSankey, mermaidFlow: mermaidFlow };
})(window);
