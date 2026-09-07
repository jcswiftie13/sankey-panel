/* 查詢條件表單：七個受控欄位 + 一顆「查詢」。
   獨立成一支是因為 App.jsx 已經放不下；圖那邊的接線仍然全部留在 App.jsx。

   兩個作風沿用專案既有慣例：
   - 內部只存字串（表單原生行為），送出時才轉型。
   - 壞值要有明確去處：留空＝用預設值（不算錯），填了但不合法＝不送出並報錯，
     絕不默默改成別的數字。 */
import { useState } from 'react';
import { DEFAULTS, msToLocalInput, localInputToMs } from './api.js';

const HOUR = 3600 * 1000;

/* 開場時間＝最近 1 小時。放進 useState 的初始化函式只算一次，
   不然每次 render 都會把使用者選好的時間往前推。 */
function initTimes() {
  const now = Date.now();
  return { from: msToLocalInput(now - HOUR), to: msToLocalInput(now) };
}

/* 空字串 → 預設值；填了就一定要是有限數字，否則回 NaN 讓呼叫端報錯 */
function num(raw, def) {
  const s = String(raw).trim();
  if (s === '') return def;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function isPosInt(n) { return Number.isFinite(n) && Number.isInteger(n) && n >= 1; }

/* 表單字串 → API 參數。抽成純函式是為了能直接測，元件只負責把欄位值餵進來。
   回傳 { params } 或 { messages }（有訊息就代表不送出）。 */
export function buildParams(f) {
  const msgs = [];

  const hostname = f.hostname.trim();
  if (!hostname) msgs.push('請填寫起點交換器 hostname');

  const max_hops = num(f.maxHops, DEFAULTS.max_hops);
  if (!isPosInt(max_hops)) msgs.push('最多追查層數（跳）需要是正整數');
  const top_n = num(f.topN, DEFAULTS.top_n);
  if (!isPosInt(top_n)) msgs.push('每台取前幾大 interface 需要是正整數');
  const threshold = num(f.threshold, DEFAULTS.threshold);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    msgs.push('貢獻門檻（％）需要是 0–100 的數字');
  }

  const from_ts = localInputToMs(f.from);
  const to_ts = localInputToMs(f.to);
  if (!Number.isFinite(from_ts)) msgs.push('請選擇起始時間');
  if (!Number.isFinite(to_ts)) msgs.push('請選擇結束時間');
  if (Number.isFinite(from_ts) && Number.isFinite(to_ts) && from_ts >= to_ts) {
    msgs.push('起始時間必須早於結束時間');
  }

  if (msgs.length) return { messages: msgs };
  return { params: { hostname, from_ts, to_ts, max_hops, top_n, threshold, track_dir: f.trackDir } };
}

export function TraceQueryBar({ onSubmit, onInvalid, loading }) {
  const t0 = useState(initTimes)[0];
  const [hostname, setHostname] = useState('');
  const [from, setFrom] = useState(t0.from);
  const [to, setTo] = useState(t0.to);
  const [maxHops, setMaxHops] = useState('');
  const [topN, setTopN] = useState('');
  const [threshold, setThreshold] = useState('');
  const [trackDir, setTrackDir] = useState(DEFAULTS.track_dir);

  /* 送出走 <form onSubmit>，這樣在任何欄位裡按 Enter 都能查詢 */
  function submit(ev) {
    ev.preventDefault();
    const r = buildParams({ hostname, from, to, maxHops, topN, threshold, trackDir });
    if (r.messages) { onInvalid({ title: '查詢條件有誤', messages: r.messages }); return; }
    onSubmit(r.params);
  }

  /* 提示寫在欄位下方而不是 placeholder：placeholder 一打字就消失，
     使用者正需要看它的時候看不到 */
  return (
    <form className="query-bar" onSubmit={submit}>
      <div className="field f-host">
        <label htmlFor="q-host">起點交換器 hostname</label>
        <input id="q-host" className="q-input" type="text" value={hostname}
          onChange={ev => setHostname(ev.target.value)} />
        <span className="hint">必填</span>
      </div>
      <div className="field">
        <label htmlFor="q-from">起始時間</label>
        <input id="q-from" className="q-input" type="datetime-local" value={from}
          onChange={ev => setFrom(ev.target.value)} />
        <span className="hint">預設最近 1 小時</span>
      </div>
      <div className="field">
        <label htmlFor="q-to">結束時間</label>
        <input id="q-to" className="q-input" type="datetime-local" value={to}
          onChange={ev => setTo(ev.target.value)} />
        <span className="hint">本地時間</span>
      </div>
      <div className="field f-num">
        <label htmlFor="q-hops">最多追查層數（跳）</label>
        <input id="q-hops" className="q-input" type="number" min="1" step="1" value={maxHops}
          onChange={ev => setMaxHops(ev.target.value)} />
        <span className="hint">整數，預設 {DEFAULTS.max_hops}</span>
      </div>
      <div className="field f-num">
        <label htmlFor="q-topn">每台取前幾大 interface</label>
        <input id="q-topn" className="q-input" type="number" min="1" step="1" value={topN}
          onChange={ev => setTopN(ev.target.value)} />
        <span className="hint">整數，預設 {DEFAULTS.top_n}</span>
      </div>
      <div className="field f-num">
        <label htmlFor="q-th">貢獻門檻（％）</label>
        <input id="q-th" className="q-input" type="number" min="0" max="100" step="0.1" value={threshold}
          onChange={ev => setThreshold(ev.target.value)} />
        <span className="hint">預設 {DEFAULTS.threshold}；只看貢獻超過此百分比的 interface</span>
      </div>
      <div className="field">
        <label htmlFor="q-dir">追查方向</label>
        <select id="q-dir" className="q-input" value={trackDir}
          onChange={ev => setTrackDir(ev.target.value)}>
          <option value="source">來源（source）</option>
          <option value="destination">終點（destination）</option>
        </select>
        <span className="hint">預設 來源</span>
      </div>
      <div className="field f-go">
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? '查詢中…' : '查詢'}
        </button>
      </div>
    </form>
  );
}
