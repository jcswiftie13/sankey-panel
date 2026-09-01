/* 使用端 app：只有「圖 + 顯示門檻」，外加圖例與縮放工具列。
   圖形本體全部在 trace-sankey 套件裡，這裡只是接線。 */
import { useEffect, useRef, useState } from 'react';
import { fmtBps, zoomStep } from 'trace-sankey';
import { TraceSankey } from 'trace-sankey/react';
import { byKey, defaultKey } from 'trace-sankey/samples';
import 'trace-sankey/style.css';
import './app.css';

/* TODO: 未來前後端分離後，追查 JSON 改從 API 取，例如：
     const [doc, setDoc] = useState(null);
     useEffect(() => {
       fetch('/api/trace/' + traceId).then(r => r.json()).then(setDoc);
     }, [traceId]);
   目前先用套件內建範例。 */
const DOC = byKey[defaultKey].json;

/* 負數、小數、亂打的字一律當 0（不過濾），不要讓門檻自己變成一個錯誤來源 */
function cleanMin(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default function App() {
  const [doc] = useState(DOC);
  const [minText, setMinText] = useState('');   /* 輸入框的原始字串 */
  const [min, setMin] = useState(0);            /* 真正生效的門檻（debounce 後） */
  const [model, setModel] = useState(null);
  const [errors, setErrors] = useState(null);
  const [zoomPct, setZoomPct] = useState('—');
  const [focus, setFocus] = useState(false);
  const chartRef = useRef(null);

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
    </div>
  );
}
