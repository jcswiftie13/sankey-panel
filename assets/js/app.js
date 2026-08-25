/* UI 接線：query string 是狀態來源，控制項是真的連結。追查 JSON 從本機檔案讀，不上傳。 */
(function () {
  'use strict';
  var M = window.TraceModel, R = window.TraceRender, X = window.TraceExports, S = window.TraceSamples;
  var Z = window.TraceZoom;

  var TABS = [
    { key: 'chart', name: '圖' },
    { key: 'json', name: 'JSON' },
    { key: 'mermaid-sankey', name: 'Mermaid Sankey' },
    { key: 'mermaid-flow', name: 'Mermaid Flowchart' },
    { key: 'notes', name: '畫法說明' }
  ];
  var LS_KEY = 'trace-sankey/custom';
  var LS_NAME = 'trace-sankey/custom-name';

  var state = { sample: S.defaultKey, tab: 'chart' };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function readQuery() {
    var p = new URLSearchParams(location.search);
    var s = p.get('sample'), t = p.get('tab');
    if (s && (S.byKey[s] || s === 'custom')) state.sample = s;
    if (t && TABS.some(function (x) { return x.key === t; })) state.tab = t;
  }
  function href(patch) {
    var next = Object.assign({}, state, patch);
    return '?sample=' + encodeURIComponent(next.sample) + '&tab=' + encodeURIComponent(next.tab);
  }

  /* 載入來源：有檔名＝從檔案來的，沒有＝編輯器貼的 */
  function customName() { return lsGet(LS_NAME) || ''; }
  function customLabel() { return customName() || '自訂 JSON'; }
  function customDesc() {
    var n = customName();
    return n ? '從本機檔案載入：' + n : '從 JSON 編輯器套用的追查。';
  }

  function currentDoc() {
    if (state.sample === 'custom') {
      var raw = lsGet(LS_KEY);
      if (raw) {
        try { return { doc: JSON.parse(raw), raw: raw, custom: true }; }
        catch (e) { return { doc: null, raw: raw, custom: true, parseError: e.message }; }
      }
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
      ? '<a class="chip" href="' + href({ sample: 'custom' }) + '" aria-current="true">' +
        R.esc(customLabel()) + '</a>' : '');

    document.getElementById('tabs').innerHTML = TABS.map(function (t) {
      return '<a class="tab" href="' + href({ tab: t.key }) + '" data-nav="tab" data-val="' + t.key + '"' +
        (state.tab === t.key ? ' aria-current="true"' : '') + '>' + R.esc(t.name) + '</a>';
    }).join('');

    Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (p) {
      p.classList.toggle('active', p.getAttribute('data-tab') === state.tab);
    });

    var fn = document.getElementById('fileName');
    if (state.sample === 'custom') fileNote('目前來源：' + customLabel(), 'ok');
    else if (fn && !fn.classList.contains('bad')) fileNote('尚未載入檔案，目前顯示內建範例', '');
  }

  function fileNote(msg, cls) {
    var el = document.getElementById('fileName');
    if (!el) return;
    el.textContent = msg;
    el.className = 'file-name' + (cls ? ' ' + cls : '');
  }

  /* ---------- 主繪製 ---------- */
  var lastKey = null;                 /* 資料沒變就不重畫，縮放才不會被切分頁洗掉 */

  function draw() {
    var cur = currentDoc();
    var meta = document.getElementById('metaBar');
    var chart = document.getElementById('chart');
    var sum = document.getElementById('hopSummary');
    var editor = document.getElementById('jsonEditor');
    if (document.activeElement !== editor) editor.value = cur.raw || '';

    var name = cur.custom ? customLabel() : cur.sample.name;
    var desc = cur.custom ? customDesc() : cur.sample.desc;

    if (!cur.doc) {
      meta.innerHTML = '<span class="title">' + R.esc(name) + '</span>';
      chart.innerHTML = '<div class="empty"><b>JSON 解析失敗</b>' + R.esc(cur.parseError || '') +
        '<br>切到 JSON 分頁修好再套用，或重新載入一份檔案。</div>';
      sum.innerHTML = ''; setCode('');
      chartGone();
      return;
    }

    var model = M.build(cur.doc);
    if (!model.ok) {
      meta.innerHTML = '<span class="title">' + R.esc(name) + '</span>';
      chart.innerHTML = '<div class="empty"><b>追查 JSON 不合契約</b>' +
        model.errors.map(function (e) { return R.esc(e); }).join('<br>') + '</div>';
      sum.innerHTML = ''; setCode('');
      chartGone();
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

    document.getElementById('legend').innerHTML =
      '<span><i class="lg-cyan"></i>已追查（帶寬＝實際 increment）</span>' +
      '<span><i class="lg-lat"></i>同層互連（同 tier 同欄，右側弧帶，等比）</span>' +
      '<span><i class="lg-amber"></i>其他輸入（貼左側，高度與帶寬等比）</span>' +
      '<span><i class="lg-rose"></i>其他輸出（截斷／太小，貼右側，高度等比）</span>' +
      '<span><i class="lg-gray"></i>追查終止葉節點（不是又一台 switch）</span>';

    sum.innerHTML = R.summary(model);
    setCode(model);

    /* 同一份資料重畫（例如只是切分頁回來）就沿用既有 SVG，保住縮放狀態 */
    var key = state.sample + '\n' + (cur.raw || '');
    if (key !== lastKey || !chart.querySelector('svg')) {
      chart.innerHTML = R.render(model);
      bindTips();
      lastKey = key;
    }
    sizeChart();                    /* 一定要在 attach 之前：fit 要用最終高度算 */
    zoomCtl(Z.attach(document.getElementById('chartWrap'), {
      onPanStart: hideTip,
      onChange: function (scale) {
        var el = document.getElementById('zoomPct');
        if (!el) return;
        /* 超大圖 fit 可能只有 0.17%，四捨五入成 0% 看起來像壞掉 */
        el.textContent = scale == null ? '—'
          : (scale >= 0.1 ? Math.round(scale * 100) : (scale * 100).toFixed(1)) + '%';
      }
    }));
  }

  function setCode(model) {
    var a = document.getElementById('mmSankey'), b = document.getElementById('mmFlow');
    if (!model) { a.textContent = ''; b.textContent = ''; return; }
    a.textContent = X.mermaidSankey(model);
    b.textContent = X.mermaidFlow(model);
  }

  /* ---------- tooltip ---------- */
  var hoverBand = null;

  /* 拖曳時 pointer capture 會把 mouseleave 攔走，高亮與 tooltip 得手動收 */
  function hideTip() {
    document.getElementById('tooltip').hidden = true;
    if (hoverBand) { hoverBand.setAttribute('fill', 'url(#gband)'); hoverBand = null; }
  }

  function bindTips() {
    var tip = document.getElementById('tooltip');
    hoverBand = null;
    Array.prototype.forEach.call(document.querySelectorAll('.band'), function (el) {
      el.addEventListener('mouseenter', function () {
        if (Z.isPanning()) return;
        var d;
        try { d = JSON.parse(el.getAttribute('data-tip')); } catch (e) { return; }
        tip.innerHTML = '<b>' + R.esc(d.from) + ' → ' + R.esc(d.to) + '</b>' +
          '<div class="t-row"><span>出口 iface</span><span>' + R.esc(d.fi || '—') + '</span></div>' +
          '<div class="t-row"><span>入口 iface</span><span>' + R.esc(d.ti || '—') + '</span></div>' +
          '<div class="t-row"><span>實際 increment</span><span>' + M.fmtBps(d.bps) + '</span></div>' +
          '<div class="t-row"><span>可歸因</span><span>' + M.fmtBps(d.attr) + '</span></div>' +
          (d.anchor ? '<div class="t-row"><span>這條是追查起點</span><span></span></div>' : '') +
          (d.lateral ? '<div class="t-row"><span>同層互連（同 tier）</span><span></span></div>' : '');
        tip.hidden = false;
        el.setAttribute('fill', 'url(#gband-h)');
        hoverBand = el;
      });
      el.addEventListener('mousemove', function (ev) {
        var w = tip.offsetWidth || 260, h = tip.offsetHeight || 90;
        tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - w - 10) + 'px';
        tip.style.top = Math.max(8, Math.min(ev.clientY + 14, window.innerHeight - h - 10)) + 'px';
      });
      el.addEventListener('mouseleave', function () {
        tip.hidden = true;
        el.setAttribute('fill', 'url(#gband)');
        if (hoverBand === el) hoverBand = null;
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

  /* ---------- 套用一份 JSON（開檔與編輯器共用同一條驗證路徑） ---------- */
  function applyRaw(raw, sourceName) {
    var doc;
    try { doc = JSON.parse(raw); }
    catch (e) { return { ok: false, msg: 'JSON 語法錯誤：' + e.message }; }
    var built = M.build(doc);
    if (!built.ok) return { ok: false, msg: '不合契約：' + built.errors.join(' / ') };
    lsSet(LS_KEY, raw);
    if (sourceName) lsSet(LS_NAME, sourceName); else lsDel(LS_NAME);
    state.sample = 'custom';
    history.pushState(null, '', href({}));
    chips(); draw();
    return { ok: true, warnings: built.warnings };
  }

  /* ---------- 開檔 / 拖放 ---------- */
  function loadFailed(title, msg, raw) {
    chartGone();
    fileNote(msg, 'bad');
    status(msg, 'bad');
    document.getElementById('metaBar').innerHTML = '<span class="title">' + R.esc(title) + '</span>';
    document.getElementById('chart').innerHTML =
      '<div class="empty"><b>載入失敗</b>' + R.esc(msg) + '<br>修好再載入一次，或先選一個內建範例。</div>';
    document.getElementById('hopSummary').innerHTML = '';
    document.getElementById('legend').innerHTML = '';
    setCode('');
    if (raw != null) document.getElementById('jsonEditor').value = raw;
  }

  function readFile(file) {
    if (!file) return;
    if (!/\.json$/i.test(file.name)) {
      loadFailed(file.name, '只接受 .json 檔案（收到 ' + file.name + '）');
      return;
    }
    var fr = new FileReader();
    fr.onload = function () {
      var raw = String(fr.result);
      var res = applyRaw(raw, file.name);
      if (res.ok) {
        document.getElementById('jsonEditor').classList.remove('bad');
        status('已載入 ' + file.name + '。' +
          (res.warnings.length ? '有 ' + res.warnings.length + ' 則警告，看圖下方。' : ''), 'ok');
        fileNote('目前來源：' + file.name +
          (res.warnings.length ? '（' + res.warnings.length + ' 則警告）' : ''), 'ok');
      } else {
        loadFailed(file.name, file.name + '：' + res.msg, raw);
      }
    };
    fr.onerror = function () { loadFailed(file.name, '讀不到檔案：' + file.name); };
    fr.readAsText(file);
  }

  var fileInput = document.getElementById('fileInput');
  document.getElementById('openFile').addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    readFile(fileInput.files && fileInput.files[0]);
    fileInput.value = '';           /* 同一個檔案連續選兩次也要觸發 */
  });

  var dragDepth = 0;
  function dropHint(on) {
    var el = document.getElementById('dropHint');
    if (el) el.hidden = !on;
  }
  document.addEventListener('dragenter', function (ev) {
    if (!hasFiles(ev)) return;
    ev.preventDefault(); dragDepth++; dropHint(true);
  });
  document.addEventListener('dragover', function (ev) {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', function (ev) {
    if (!hasFiles(ev)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropHint(false);
  });
  document.addEventListener('drop', function (ev) {
    if (!hasFiles(ev)) return;
    ev.preventDefault(); dragDepth = 0; dropHint(false);
    readFile(ev.dataTransfer.files[0]);
  });
  function hasFiles(ev) {
    var dt = ev.dataTransfer;
    if (!dt) return false;
    if (dt.files && dt.files.length) return true;
    return dt.types && Array.prototype.indexOf.call(dt.types, 'Files') >= 0;
  }

  /* ---------- JSON 編輯器 ---------- */
  function status(msg, cls) {
    var el = document.getElementById('jsonStatus');
    el.textContent = msg || '';
    el.className = 'status' + (cls ? ' ' + cls : '');
  }
  document.getElementById('applyJson').addEventListener('click', function () {
    var ta = document.getElementById('jsonEditor');
    var res = applyRaw(ta.value, null);
    if (!res.ok) { ta.classList.add('bad'); status(res.msg, 'bad'); return; }
    ta.classList.remove('bad');
    status('已套用。' + (res.warnings.length ? '有 ' + res.warnings.length + ' 則警告，看圖下方。' : ''), 'ok');
  });
  document.getElementById('resetJson').addEventListener('click', function () {
    state.sample = S.defaultKey;
    lsDel(LS_KEY); lsDel(LS_NAME);
    document.getElementById('jsonEditor').classList.remove('bad');
    history.pushState(null, '', href({}));
    status('已還原成內建範例。', 'ok');
    fileNote('尚未載入檔案，目前顯示內建範例', '');
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

  /* ---------- 圖區高度 ---------- */
  /* 上面有 header + 控制列 + 分頁 + meta + legend，固定 vh 會讓圖掉出視窗外。
     量出圖區的實際起點，把剩下的視窗高度全給它。 */
  function sizeChart() {
    var wrap = document.getElementById('chartWrap');
    if (!wrap) return;
    if (document.body.classList.contains('chart-focus')) { wrap.style.height = ''; return; }
    if (state.tab !== 'chart') return;          /* 隱藏時量不到，切回來會再算 */
    var top = wrap.getBoundingClientRect().top + (window.pageYOffset || 0);
    wrap.style.height = Math.max(360, window.innerHeight - top - 22) + 'px';
  }

  window.addEventListener('resize', function () { sizeChart(); Z.refresh(); });

  /* ---------- 縮放控制項 ---------- */
  /* 圖沒了（解析失敗／不合契約／載入失敗）：卸掉縮放、收工具列、強迫下次重畫 */
  function chartGone() {
    Z.detach();
    zoomCtl(false);
    lastKey = null;
  }
  function zoomCtl(on) {
    var el = document.getElementById('zoomCtl');
    if (el) el.hidden = !on;
  }
  function zb(id, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }
  zb('zoomIn', function () { Z.zoomBy(Z.step); });
  zb('zoomOut', function () { Z.zoomBy(1 / Z.step); });
  zb('zoomFit', function () { Z.fit(); });
  zb('zoomOne', function () { Z.actual(); });
  zb('zoomPct', function () { Z.actual(); });
  zb('chartFocus', function () {
    focusMode(!document.body.classList.contains('chart-focus'));
  });

  function focusMode(on) {
    document.body.classList.toggle('chart-focus', on);
    var b = document.getElementById('chartFocus');
    if (b) b.textContent = on ? '離開專注' : '專注';
    sizeChart();
    Z.refresh();                      /* 視窗大小變了：重夾平移、更新百分比 */
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var t = ev.target, tn = t && t.tagName;
    if (tn === 'TEXTAREA' || tn === 'INPUT' || (t && t.isContentEditable)) return;
    if (ev.key === 'Escape' && document.body.classList.contains('chart-focus')) {
      focusMode(false); ev.preventDefault(); return;
    }
    if (state.tab !== 'chart') return;
    if (ev.key === '+' || ev.key === '=') Z.zoomBy(Z.step);
    else if (ev.key === '-' || ev.key === '_') Z.zoomBy(1 / Z.step);
    else if (ev.key === '0') Z.fit();
    else if (ev.key === '1') Z.actual();
    else if (ev.key === 'f' || ev.key === 'F') {
      focusMode(!document.body.classList.contains('chart-focus'));
    } else return;
    ev.preventDefault();
  });

  readQuery(); chips(); draw();
})();
