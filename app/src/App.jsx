/* 使用端 app：只有「圖 + 顯示門檻」，外加圖例與縮放工具列。
   圖形本體全部在 trace-sankey 套件裡，這裡只是接線。 */
import { useEffect, useRef, useState } from 'react';
import { fmtBps, zoomStep } from 'trace-sankey';
import { TraceSankey } from 'trace-sankey/react';
import 'trace-sankey/style.css';
import './app.css';
import { useTraceDoc } from './useTraceDoc.js';

/* 負數、小數、亂打的字一律當 0（不過濾），不要讓門檻自己變成一個錯誤來源 */
function cleanMin(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default function App() {
  /* 資料來源全部關在 useTraceDoc 裡（POC：開檔＋拖放；未來換 API 只改那個檔） */
  const { doc, name, custom, error: loadError, openFile, reset } = useTraceDoc();
  const [minText, setMinText] = useState('');   /* 輸入框的原始字串 */
  const [min, setMin] = useState(0);            /* 真正生效的門檻（debounce 後） */
  const [model, setModel] = useState(null);
  const [errors, setErrors] = useState(null);
  const [zoomPct, setZoomPct] = useState('—');
  const [focus, setFocus] = useState(false);
  const [dragging, setDragging] = useState(false);
  const chartRef = useRef(null);
  const fileRef = useRef(null);
  /* 拖放 effect 只掛一次，透過 ref 永遠呼叫到最新的 openFile */
  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;

  /* 重畫 debounce 200ms；提示文字直接從 minText 算，不 debounce（打字就要跟著跳）。
     舊版「打了一個字又刪掉會套上舊值」的坑在這個寫法下不存在：
     每次輸入都會清掉前一個 timer，最後生效的一定是最新內容。 */
  useEffect(() => {
    const t = setTimeout(() => setMin(cleanMin(minText)), 200);
    return () => clearTimeout(t);
  }, [minText]);

  /* 專注模式：純 CSS（body class）。版面變了要 refresh 重夾平移、更新百分比 */
  useEffect(() => {
    document.body.classList.toggle('chart-focus', focus);
    const raf = requestAnimationFrame(() => chartRef.current?.refresh());
    return () => cancelAnimationFrame(raf);
  }, [focus]);

  /* 快捷鍵：+/- 縮放、0 符合視窗、1 原始大小、f 專注、Esc 離開；輸入框內不攔 */
  useEffect(() => {
    function onKey(ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const t = ev.target, tn = t && t.tagName;
      if (tn === 'TEXTAREA' || tn === 'INPUT' || (t && t.isContentEditable)) return;
      if (ev.key === 'Escape' && focus) { setFocus(false); ev.preventDefault(); return; }
      const z = chartRef.current && chartRef.current.zoom;
      if (!z) return;
      if (ev.key === '+' || ev.key === '=') z.zoomBy(zoomStep);
      else if (ev.key === '-' || ev.key === '_') z.zoomBy(1 / zoomStep);
      else if (ev.key === '0') z.fit();
      else if (ev.key === '1') z.actual();
      else if (ev.key === 'f' || ev.key === 'F') setFocus(f => !f);
      else return;
      ev.preventDefault();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focus]);

  /* 拖放：掛 document 層的 capture 階段。三個防呆都是踩過的坑——
     hasFiles() 讓拖選取文字不觸發；depth 計數讓游標掃過子元素時提示不閃爍；
     而 preventDefault() 一律先呼叫、不看 hasFiles()——這是被 Electron 鑲嵌時
     「整頁跳去 file://…json」的唯一防線。原因：dragover 沒被取消的話，Chromium
     根本不會把 drop 事件送進頁面，而是直接導航到那個檔案；host 端該設的
     will-navigate 白名單不在我們手上（見 README「被 Electron 鑲嵌時」）。
     舊寫法先問 hasFiles() 再攔，判定不成 Files 的拖放（有些來源不給
     dataTransfer.types）就整個沒攔到，那就是縫。用 capture 是為了不被任何
     子層的 stopPropagation() 繞過。代價：拖文字進「顯示門檻」輸入框的原生
     行為會失效，可接受。 */
  useEffect(() => {
    let depth = 0;
    function hasFiles(ev) {
      const dt = ev.dataTransfer;
      if (!dt) return false;
      if (dt.files && dt.files.length) return true;
      return dt.types && Array.prototype.indexOf.call(dt.types, 'Files') >= 0;
    }
    function onEnter(ev) {
      ev.preventDefault();
      if (!hasFiles(ev)) return;
      depth++; setDragging(true);
    }
    function onOver(ev) {
      ev.preventDefault();
      if (!hasFiles(ev)) return;
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    }
    function onLeave(ev) {
      if (!hasFiles(ev)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    }
    function onDrop(ev) {
      ev.preventDefault();
      if (!hasFiles(ev)) return;
      depth = 0; setDragging(false);
      openFileRef.current(ev.dataTransfer.files[0]);
    }
    /* capture:true 的 listener 一定要用同樣的旗標移除，否則解不掉 */
    document.addEventListener('dragenter', onEnter, true);
    document.addEventListener('dragover', onOver, true);
    document.addEventListener('dragleave', onLeave, true);
    document.addEventListener('drop', onDrop, true);
    return () => {
      document.removeEventListener('dragenter', onEnter, true);
      document.removeEventListener('dragover', onOver, true);
      document.removeEventListener('dragleave', onLeave, true);
      document.removeEventListener('drop', onDrop, true);
    };
  }, []);

  const cleaned = cleanMin(minText);
  const hasBack = !!model && model.edges.some(e => e.backward);
  const hasLat = !!model && model.edges.some(e => e.lateral);
  const z = () => chartRef.current && chartRef.current.zoom;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          <h1>追查 Sankey</h1>
        </div>
        <div className="file-row">
          <button className="btn" onClick={() => fileRef.current && fileRef.current.click()}>
            開啟 JSON…
          </button>
          {/* value 清空：同一個檔案連續選兩次也要觸發 onChange（舊頁踩過的坑） */}
          <input
            ref={fileRef} type="file" accept=".json" hidden
            onChange={ev => { openFile(ev.target.files && ev.target.files[0]); ev.target.value = ''; }}
          />
          <span className={'file-name' + (custom ? ' ok' : '')}>{name}</span>
          {custom && <button className="btn" onClick={reset}>還原範例</button>}
        </div>
        <div className="min-row">
          <label htmlFor="minBps">顯示門檻 &gt;</label>
          <input
            id="minBps" type="number" min="0" step="1000000000" placeholder="0"
            value={minText}
            onChange={ev => setMinText(ev.target.value)}
            onBlur={() => {
              /* 離開欄位順便把亂打的內容正規化成真正生效的值 */
              const v = cleanMin(minText);
              setMinText(v > 0 ? String(v) : '');
              setMin(v);
            }}
          />
          <span className="unit">bps</span>
          <span className="unit-hint">{cleaned > 0 ? '＝ ' + fmtBps(cleaned) : '不過濾'}</span>
          <button className="btn" onClick={() => { setMinText(''); setMin(0); }}>清除</button>
          {min > 0 && model && (
            <span className="pill">
              隱藏 {model.filtered.edges} 條帶
              {model.filteredNodes.length > 0 && '、' + model.filteredNodes.length + ' 台'}
              （共 {fmtBps(model.filtered.bps)}）
            </span>
          )}
        </div>
      </header>

      {/* 載入失敗只出橫幅，不動正在顯示的圖 */}
      {loadError && (
        <div className="error-banner" role="alert">
          <b>{loadError.title}</b>
          {loadError.messages.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      )}

      {model && (
        <div className="legend">
          <span><i className="lg-cyan" />已追查（帶寬＝速率增量 Δ，bps）</span>
          {hasLat && <span className="lg-sub"><i className="lg-lat" />└ 同欄互連畫成右側弧帶，箭頭指流向</span>}
          {hasBack && <span><i className="lg-back" />回流（逆著多數流量方向，繞回上游）</span>}
          <span><i className="lg-amber" />其他輸入（貼左側，高度與帶寬等比）</span>
          <span><i className="lg-rose" />其他輸出（截斷／太小，貼右側，高度等比）</span>
          <span><i className="lg-gray" />追查終止葉節點（不是又一台 switch）</span>
        </div>
      )}

      <div className="chart-area">
        <TraceSankey
          ref={chartRef}
          className="chart-host"
          doc={doc}
          minBps={min}
          onModel={m => { setModel(m); setErrors(null); }}
          onError={e => { setErrors(e); setModel(null); }}
          onZoom={s => setZoomPct(s == null ? '—'
            : (s >= 0.1 ? Math.round(s * 100) : (s * 100).toFixed(1)) + '%')}
        />
        {errors ? (
          <div className="empty">
            <b>追查 JSON 不合契約</b>
            {errors.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        ) : (
          <div className="zoom-ctl">
            <button className="btn zbtn" title="縮小（-）" onClick={() => z()?.zoomBy(1 / zoomStep)}>−</button>
            <button className="btn zpct" title="原始大小（1）" onClick={() => z()?.actual()}>{zoomPct}</button>
            <button className="btn zbtn" title="放大（+）" onClick={() => z()?.zoomBy(zoomStep)}>＋</button>
            <button className="btn" title="符合視窗（0）" onClick={() => z()?.fit()}>符合視窗</button>
            <button className="btn" title="原始大小（1）" onClick={() => z()?.actual()}>1:1</button>
            <button className="btn" title="專注模式（f）" onClick={() => setFocus(f => !f)}>
              {focus ? '離開專注' : '專注'}
            </button>
          </div>
        )}
      </div>

      {dragging && (
        <div className="drop-hint">
          <div className="drop-box">放開就載入這份追查 JSON</div>
        </div>
      )}
    </div>
  );
}
