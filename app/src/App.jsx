/* 使用端 app：查詢條件表單 + 圖 + 顯示門檻，外加圖例與縮放工具列。
   圖形本體全部在 trace-sankey 套件裡，這裡只是接線；
   「資料怎麼來」關在 useTraceDoc.js，表單長相關在 TraceQueryBar.jsx。 */
import { useEffect, useRef, useState } from 'react';
import { fmtBps, zoomStep } from 'trace-sankey';
import { TraceSankey } from 'trace-sankey/react';
import 'trace-sankey/style.css';
import './app.css';
import { useTraceDoc } from './useTraceDoc.js';
import { TraceQueryBar } from './TraceQueryBar.jsx';

/* 負數、小數、亂打的字一律當 0（不過濾），不要讓門檻自己變成一個錯誤來源 */
function cleanMin(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default function App() {
  /* 資料來源全部關在 useTraceDoc 裡（查 API；三種失敗都不動現有的 doc） */
  const { doc, error: loadError, loading, run } = useTraceDoc();
  const [formError, setFormError] = useState(null);  /* 表單自己的驗證錯誤，不送 API */
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

  /* 快捷鍵：+/- 縮放、0 符合視窗、1 原始大小、f 專注、Esc 離開；輸入框內不攔。
     SELECT 也要豁免，否則在「追查方向」選單上按 1／0 會被圖搶走。 */
  useEffect(() => {
    function onKey(ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const t = ev.target, tn = t && t.tagName;
      if (tn === 'TEXTAREA' || tn === 'INPUT' || tn === 'SELECT' || (t && t.isContentEditable)) return;
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

  /* 拖放：功能已經拿掉（JSON 改由 API 查），但這個 effect 一定要留著。
     它現在唯一的職責是**擋掉瀏覽器的預設拖放行為**：dragover 沒被取消的話，
     Chromium 不會把 drop 送進頁面，而是直接把整頁導航到那個檔案——被 Electron
     鑲嵌時就是「拖一個 .json 進去，整頁跳成 file://…」，而 host 端該設的
     will-navigate 白名單不在我們手上（見 README「被 Electron 鑲嵌時」）。
     所以 preventDefault() 一律先呼叫、不看 dataTransfer.types（有些拖放來源
     不給 types，先問再攔就會漏），並掛在 document 的 capture 階段，
     不被任何子層的 stopPropagation() 繞過。
     代價：拖文字進「顯示門檻」輸入框的原生行為會失效，可接受。 */
  useEffect(() => {
    function swallow(ev) { ev.preventDefault(); }
    /* capture:true 的 listener 一定要用同樣的旗標移除，否則解不掉 */
    document.addEventListener('dragenter', swallow, true);
    document.addEventListener('dragover', swallow, true);
    document.addEventListener('drop', swallow, true);
    return () => {
      document.removeEventListener('dragenter', swallow, true);
      document.removeEventListener('dragover', swallow, true);
      document.removeEventListener('drop', swallow, true);
    };
  }, []);

  const cleaned = cleanMin(minText);
  const hasBack = !!model && model.edges.some(e => e.backward);
  const hasLat = !!model && model.edges.some(e => e.lateral);
  const z = () => chartRef.current && chartRef.current.zoom;
  /* 表單驗證錯誤與查詢錯誤共用同一個橫幅：擇一顯示，表單的優先（那是你剛按下去的動作） */
  const banner = formError || loadError;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          <h1>追查 Sankey</h1>
        </div>
        <TraceQueryBar
          loading={loading}
          onInvalid={setFormError}
          onSubmit={params => { setFormError(null); run(params); }}
        />
        <div className="min-row">
          <label htmlFor="minBps">顯示門檻 &gt;</label>
          <input
            id="minBps" className="q-input" type="number" min="0" step="1000000000" placeholder="0"
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

      {/* 查詢失敗只出橫幅，不動正在顯示的圖 */}
      {banner && (
        <div className="error-banner" role="alert">
          <b>{banner.title}</b>
          {banner.messages.map((m, i) => <div key={i}>{m}</div>)}
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
        {/* doc 是 null 時不要掛 TraceSankey：套件會對 null 直接走 error 路徑 */}
        {doc ? (
          <>
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
          </>
        ) : (
          <div className="empty">
            <b>還沒有資料</b>
            <div>填寫查詢條件後按「查詢」</div>
          </div>
        )}
      </div>
    </div>
  );
}
