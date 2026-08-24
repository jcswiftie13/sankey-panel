/* UI 接線：query string 是唯一狀態來源，控制項是真的連結。 */
(function () {
  'use strict';
  var M = window.TraceModel, R = window.TraceRender, X = window.TraceExports, S = window.TraceSamples;

  var MODES = [
    { key: 'balanced', name: '平衡 Sankey', note: '預設、最建議。實際量 ＋ 其他進／出，圖會守恆。' },
    { key: 'contribution', name: '只看貢獻', note: '只留能歸因到追查起點的量；截斷的其他進／出會消失。' },
    { key: 'raw', name: '原始實際量', note: '不補缺口，只畫有跟下去的 interface，用來對照 counter。' }
  ];
  var TABS = [
    { key: 'chart', name: '圖' },
    { key: 'json', name: 'JSON' },
    { key: 'mermaid-sankey', name: 'Mermaid Sankey' },
    { key: 'mermaid-flow', name: 'Mermaid Flowchart' },
    { key: 'notes', name: '畫法說明' }
  ];
  var LS_KEY = 'trace-sankey/custom';

  var state = { sample: S.defaultKey, mode: 'balanced', tab: 'chart' };

  function readQuery() {
    var p = new URLSearchParams(location.search);
    var s = p.get('sample'), m = p.get('mode'), t = p.get('tab');
    if (s && (S.byKey[s] || s === 'custom')) state.sample = s;
    if (m && MODES.some(function (x) { return x.key === m; })) state.mode = m;
    if (t && TABS.some(function (x) { return x.key === t; })) state.tab = t;
  }
  function href(patch) {
    var next = Object.assign({}, state, patch);
    return '?sample=' + encodeURIComponent(next.sample) +
      '&mode=' + encodeURIComponent(next.mode) + '&tab=' + encodeURIComponent(next.tab);
  }

  function currentDoc() {
    if (state.sample === 'custom') {
      var raw = null;
      try { raw = localStorage.getItem(LS_KEY); } catch (e) { raw = null; }
      if (raw) { try { return { doc: JSON.parse(raw), raw: raw, custom: true }; }
                 catch (e2) { return { doc: null, raw: raw, custom: true, parseError: e2.message }; } }
      state.sample = S.defaultKey;
    }
    var s = S.byKey[state.sample] || S.byKey[S.defaultKey];
    return { doc: s.json, raw: JSON.stringify(s.json, null, 2), sample: s };
  }

  /* ---------- 控制項 ---------- */
  function chips() {
    var sc = document.getElementById('sampleChips');
    sc.innerHTML = S.list.map(function (s) {
      return '<a class="chip" href="' + href({ sample: s.key }) + '" data-nav="sample" data-val="' + s.key +
        '" title="' + R.esc(s.desc) + '"' + (state.sample === s.key ? ' aria-current="true"' : '') + '>' +
        R.esc(s.name) + '</a>';
    }).join('') + (state.sample === 'custom'
      ? '<a class="chip" href="' + href({ sample: 'custom' }) + '" aria-current="true">自訂 JSON</a>' : '');

    var mc = document.getElementById('modeChips');
    mc.innerHTML = MODES.map(function (m) {
      return '<a class="chip" href="' + href({ mode: m.key }) + '" data-nav="mode" data-val="' + m.key + '"' +
        (state.mode === m.key ? ' aria-current="true"' : '') + '>' + R.esc(m.name) + '</a>';
    }).join('');
    var cur = MODES.filter(function (m) { return m.key === state.mode; })[0];
    document.getElementById('modeNote').textContent = cur ? cur.note : '';

    document.getElementById('tabs').innerHTML = TABS.map(function (t) {
      return '<a class="tab" href="' + href({ tab: t.key }) + '" data-nav="tab" data-val="' + t.key + '"' +
        (state.tab === t.key ? ' aria-current="true"' : '') + '>' + R.esc(t.name) + '</a>';
    }).join('');

    Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (p) {
      p.classList.toggle('active', p.getAttribute('data-tab') === state.tab);
    });
  }

  /* ---------- 主繪製 ---------- */
  function draw() {
    var cur = currentDoc();
    var meta = document.getElementById('metaBar');
    var chart = document.getElementById('chart');
    var sum = document.getElementById('hopSummary');
    var editor = document.getElementById('jsonEditor');
    if (document.activeElement !== editor) editor.value = cur.raw || '';

    var name = cur.custom ? '自訂 JSON' : cur.sample.name;
    var desc = cur.custom ? '從編輯器套用的追查。' : cur.sample.desc;

    if (!cur.doc) {
      meta.innerHTML = '<span class="title">' + R.esc(name) + '</span>';
      chart.innerHTML = '<div class="empty"><b>JSON 解析失敗</b>' + R.esc(cur.parseError || '') +
        '<br>切到 JSON 分頁修好再套用。</div>';
      sum.innerHTML = ''; setCode('');
      return;
    }

    var model = M.build(cur.doc);
    if (!model.ok) {
      meta.innerHTML = '<span class="title">' + R.esc(name) + '</span>';
      chart.innerHTML = '<div class="empty"><b>追查 JSON 不合契約</b>' +
        model.errors.map(function (e) { return R.esc(e); }).join('<br>') + '</div>';
      sum.innerHTML = ''; setCode('');
      return;
    }

    var inv = model.investigation;
    var dirName = model.dir === 'destination' ? '追終點（起點釘最左）' : '追來源（起點釘最右）';
    meta.innerHTML =
      '<span class="title">' + R.esc(name) + '</span>' +
      '<span class="desc">' + R.esc(desc) + '</span>' +
      '<span class="pill">' + R.esc(dirName) + '</span>' +
      '<span class="pill">' + R.esc(inv.switchId + ' ' + inv.iface + ' ' +
        (model.dir === 'destination' ? 'in' : 'out') + ' +' + M.fmtBps(inv.deltaBps)) + '</span>' +
      (model.pruning && (model.pruning.topN || model.pruning.minShare)
        ? '<span class="pill">截斷：前 ' + (model.pruning.topN || '—') + ' 名 / ≥ ' +
          Math.round((model.pruning.minShare || 0) * 100) + '%</span>' : '');

    var band = state.mode === 'contribution'
      ? '已追查（帶寬＝可歸因到起點的量）'
      : '已追查（帶寬＝實際 increment）';
    var legend = '<span><i class="lg-cyan"></i>' + band + '</span>';
    if (state.mode === 'balanced') {
      legend += '<span><i class="lg-amber"></i>其他輸入（貼左側短虛線，高度不等比）</span>' +
        '<span><i class="lg-rose"></i>其他輸出（貼右側短虛線，截斷／太小）</span>';
    } else {
      legend += '<span class="c-dim">此模式不畫其他進／出' +
        (state.mode === 'raw' ? '，圖不守恆，用來對照 counter' : '，截斷的量直接消失') + '</span>';
    }
    legend += '<span><i class="lg-gray"></i>追查終止葉節點（不是又一台 switch）</span>';
    document.getElementById('legend').innerHTML = legend;

    chart.innerHTML = R.render(model, state.mode);
    sum.innerHTML = R.summary(model, state.mode);
    setCode(model);
    bindTips();
  }

  function setCode(model) {
    var a = document.getElementById('mmSankey'), b = document.getElementById('mmFlow');
    if (!model) { a.textContent = ''; b.textContent = ''; return; }
    a.textContent = X.mermaidSankey(model, state.mode);
    b.textContent = X.mermaidFlow(model, state.mode);
  }

  /* ---------- tooltip ---------- */
  function bindTips() {
    var tip = document.getElementById('tooltip');
    Array.prototype.forEach.call(document.querySelectorAll('.band'), function (el) {
      el.addEventListener('mouseenter', function () {
        var d;
        try { d = JSON.parse(el.getAttribute('data-tip')); } catch (e) { return; }
        tip.innerHTML = '<b>' + R.esc(d.from) + ' → ' + R.esc(d.to) + '</b>' +
          '<div class="t-row"><span>出口 iface</span><span>' + R.esc(d.fi || '—') + '</span></div>' +
          '<div class="t-row"><span>入口 iface</span><span>' + R.esc(d.ti || '—') + '</span></div>' +
          '<div class="t-row"><span>實際 increment</span><span>' + M.fmtBps(d.bps) + '</span></div>' +
          '<div class="t-row"><span>可歸因</span><span>' + M.fmtBps(d.attr) + '</span></div>' +
          (d.anchor ? '<div class="t-row"><span>這條是追查起點</span><span></span></div>' : '');
        tip.hidden = false;
        el.setAttribute('fill', 'url(#gband-h)');
      });
      el.addEventListener('mousemove', function (ev) {
        var w = tip.offsetWidth || 260, h = tip.offsetHeight || 90;
        tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - w - 10) + 'px';
        tip.style.top = Math.max(8, Math.min(ev.clientY + 14, window.innerHeight - h - 10)) + 'px';
      });
      el.addEventListener('mouseleave', function () {
        tip.hidden = true;
        el.setAttribute('fill', 'url(#gband)');
      });
    });
  }

  /* ---------- 導覽（有 JS 就不換頁） ---------- */
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest ? ev.target.closest('a[data-nav]') : null;
    if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
    ev.preventDefault();
    state[a.getAttribute('data-nav')] = a.getAttribute('data-val');
    history.pushState(null, '', href({}));
    chips(); draw();
  });
  window.addEventListener('popstate', function () { readQuery(); chips(); draw(); });

  /* ---------- JSON 編輯器 ---------- */
  function status(msg, cls) {
    var el = document.getElementById('jsonStatus');
    el.textContent = msg || '';
    el.className = 'status' + (cls ? ' ' + cls : '');
  }
  document.getElementById('applyJson').addEventListener('click', function () {
    var ta = document.getElementById('jsonEditor');
    var doc;
    try { doc = JSON.parse(ta.value); }
    catch (e) { ta.classList.add('bad'); status('JSON 語法錯誤：' + e.message, 'bad'); return; }
    var errs = M.validate(doc);
    if (errs.length) { ta.classList.add('bad'); status('不合契約：' + errs.join(' / '), 'bad'); return; }
    var built = M.build(doc);
    if (!built.ok) { ta.classList.add('bad'); status('不合契約：' + built.errors.join(' / '), 'bad'); return; }
    ta.classList.remove('bad');
    try { localStorage.setItem(LS_KEY, ta.value); } catch (e) {}
    state.sample = 'custom';
    history.pushState(null, '', href({}));
    status('已套用。' + (built.warnings.length ? '有 ' + built.warnings.length + ' 則警告，看圖下方。' : ''), 'ok');
    chips(); draw();
  });
  document.getElementById('resetJson').addEventListener('click', function () {
    state.sample = S.defaultKey;
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    document.getElementById('jsonEditor').classList.remove('bad');
    history.pushState(null, '', href({}));
    status('已還原成範例。', 'ok');
    chips(); draw();
  });
  document.getElementById('copyJson').addEventListener('click', function () {
    copy(document.getElementById('jsonEditor').value, '已複製 JSON。');
  });
  Array.prototype.forEach.call(document.querySelectorAll('.copy-out'), function (b) {
    b.addEventListener('click', function () {
      copy(document.getElementById(b.getAttribute('data-target')).textContent, '已複製。');
    });
  });
  function copy(text, ok) {
    var done = function () { flash(ok); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { flash('複製失敗，請手動選取。'); }
      document.body.removeChild(ta);
    }
  }
  function flash(msg) {
    var tip = document.getElementById('tooltip');
    tip.innerHTML = '<b>' + R.esc(msg) + '</b>';
    tip.style.left = '50%'; tip.style.top = '16px'; tip.hidden = false;
    setTimeout(function () { tip.hidden = true; }, 1400);
  }

  readQuery(); chips(); draw();
})();
