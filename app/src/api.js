/* 追查 API 的唯一出入口：組 query string、fetch、把各種失敗翻成同一種錯誤物件。

   為什麼只打同源相對路徑 /api/…（由 nginx proxy_pass 轉給後端）：
   1. 免 CORS——請求與網頁同源，瀏覽器的同源政策根本不介入。
   2. 免把後端網址烤進 bundle——Vite 是在 build 時把 import.meta.env 做字串替換，
      網址一旦固化就得每個環境 build 一顆映像，跟「同一顆 content 映像跨環境共用」衝突。
      後端在哪是 deploy/conf.d/default.conf 的事，不是前端程式的事。
   端點路徑改這一個常數就好。 */
const ENDPOINT = '/api/trace';

/* 表單預設值與 API 呼叫共用同一份，不要抄兩份 */
export const DEFAULTS = { max_hops: 7, top_n: 3, threshold: 10, track_dir: 'source' };

/* 回應內文附進錯誤時截斷，免得一整頁 HTML 錯誤頁灌進橫幅 */
function snip(s) {
  if (!s) return '';
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > 300 ? t.slice(0, 300) + '…' : t;
}

/* 錯誤一律帶 kind，由 hook 決定文案（訊息集中在一處，不散在這裡）：
   'network' 連不到、'http' 非 2xx、'json' 回應不是合法 JSON */
function apiError(kind, message, detail) {
  const e = new Error(message);
  e.kind = kind;
  e.detail = detail || '';
  return e;
}

/* params 的七個欄位都已由表單轉好型；這裡不再做驗證也不 validate 回傳的 doc
   （契約驗證是 hook 的責任，錯誤文案才集中）。 */
export async function fetchTrace(params, opts) {
  const q = new URLSearchParams();
  /* 七個一律顯式帶上（含預設值）：後端不必猜，log 也看得出這次到底查了什麼 */
  q.set('hostname', params.hostname);
  q.set('from_ts', String(params.from_ts));
  q.set('to_ts', String(params.to_ts));
  q.set('max_hops', String(params.max_hops));
  q.set('top_n', String(params.top_n));
  q.set('threshold', String(params.threshold));
  q.set('track_dir', params.track_dir);

  const signal = opts && opts.signal;
  let res, text;
  try {
    res = await fetch(ENDPOINT + '?' + q.toString(), { signal, headers: { Accept: 'application/json' } });
    /* 先整份讀成文字：非 2xx 要把內文附進錯誤，2xx 也要自己 parse 才分得出
       「回應不是 JSON」這種失敗（res.json() 兩種情況會混成同一個例外） */
    text = await res.text();
  } catch (e) {
    /* 中止不是錯誤：原樣往上丟，呼叫端看 signal.aborted 就知道要忽略 */
    if (e.name === 'AbortError') throw e;
    throw apiError('network', '連不到 API：' + e.message);
  }
  if (!res.ok) throw apiError('http', 'HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : ''), snip(text));
  try {
    return JSON.parse(text);
  } catch (e) {
    throw apiError('json', e.message, snip(text));
  }
}

/* ── datetime-local 與 epoch 毫秒互轉 ──
   絕對不能用 toISOString()：那是 UTC，會讓輸入框顯示的時間差 8 小時。
   datetime-local 的值本來就是「本地時間」的字串，所以兩邊都走本地時間 API。 */
function pad(n) { return n < 10 ? '0' + n : String(n); }

export function msToLocalInput(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/* 沒有時區後綴的 datetime-local 字串，規格就是以本地時區解讀；NaN 代表清空或亂打 */
export function localInputToMs(v) {
  return new Date(v).getTime();
}
