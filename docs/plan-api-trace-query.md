# 追查 Sankey：資料來源從「讀本機檔案」改成「查 API server」

## Context

目前 app 的追查 JSON 有兩個來源：內建範例，以及使用者自己開檔／拖放進來的 `.json`
（全部關在 `app/src/useTraceDoc.js`）。這是 POC 階段的權宜作法：使用者得先自己在別處跑完追查、
把結果存成檔案，再手動拖進網頁，網頁本身只是一個看圖器。

這次要把它變成真正的查詢工具：使用者在頁面上填「哪台 switch、哪段時間、追多深」，
按查詢後由後端 API 跑追查並回傳同一份契約的 JSON，網頁直接畫出來。
`useTraceDoc.js` 檔頭的註解與 CLAUDE.md §2／§12 早就把這個切換點標好了，這份計畫就是去執行它。

決策（已與使用者確認）：

- API 用 **GET + query string**（好 debug、網址可貼給同事重現同一次查詢）。
- 前端只打 **同源相對路徑 `/api/...`**，由 **nginx `proxy_pass`** 轉給 API server。
  免 CORS、免把後端網址烤進 bundle，同一顆 content 映像可跨環境共用。
- **開檔與拖放整個移除**（含 localStorage 續存、drop-hint 版面）。
- 查詢由**「查詢」按鈕**觸發，表單放在現有 topbar。

## API 契約（前端這側的假設）

```
GET /api/trace?hostname=tor-01&from_ts=1757000000000&to_ts=1757003600000
    &max_hops=7&top_n=3&threshold=10&track_dir=source
```

| query 參數 | 型別 | 預設 | UI 標籤 |
|---|---|---|---|
| `hostname` | string，必填 | — | 起點交換器 hostname |
| `from_ts` | int，epoch **毫秒** | 現在時間 −1 小時 | 起始時間 |
| `to_ts` | int，epoch **毫秒** | 現在時間 | 結束時間 |
| `max_hops` | int ≥ 1 | 7 | 最多追查層數（跳） |
| `top_n` | int ≥ 1 | 3 | 每台取前幾大 interface |
| `threshold` | float 0–100 | 10 | 貢獻門檻（％） |
| `track_dir` | `source` \| `destination` | `source` | 追查方向 |

回應：**直接就是追查 JSON 契約本體**（README §輸入 JSON 契約 / CLAUDE.md §5），
不再包一層 envelope。前端拿到後照樣跑 `validate(doc)` 才畫。

端點路徑先定為 `/api/trace`；若後端實際路徑不同，只需改 `app/src/api.js` 一個常數。

## 實作

### 1. `app/src/api.js`（新檔）

單一職責：組 query string、`fetch`、把各種失敗翻成統一的錯誤物件。

- `export const DEFAULTS = { max_hops: 7, top_n: 3, threshold: 10, track_dir: 'source' }`
  —— 表單的預設值與 API 呼叫共用同一份，不要抄兩份。
- `export async function fetchTrace(params, { signal })`
  - 用 `new URLSearchParams` 組參數，七個一律顯式帶上（不省略預設值，後端不必猜）。
  - 非 2xx → 丟出帶 status 與回應內文（截斷 300 字）的錯誤；回應不是 JSON 也一樣。
  - 回傳 parse 好的 doc，**不在這裡 validate**（驗證是 hook 的責任，錯誤文案才集中）。
- 時間轉換 helper 也放這裡，兩個都要，**不能用 `toISOString()`**（那是 UTC，會讓
  `datetime-local` 顯示錯 8 小時）：
  - `msToLocalInput(ms)`：用 `getFullYear()/getMonth()+1/...` 手動補零組成 `YYYY-MM-DDTHH:mm`。
  - `localInputToMs(v)`：`new Date(v).getTime()`（`datetime-local` 的字串本來就以本地時區解讀），
    `NaN` 代表使用者清空或亂打。

### 2. `app/src/useTraceDoc.js`（整支改寫，檔名不變）

檔名保留，因為 CLAUDE.md §4 與 App 的心智模型都是「資料來源全關在這一支」；
換的是內容不是位置。舊的 `openFile`／`reset`／`lsGet/lsSet/lsDel`／`LS_KEY` 全部刪掉。

新介面：

```js
const { doc, error, loading, lastQuery, run } = useTraceDoc();
```

- `run(params)`：呼叫 `fetchTrace` → `validate(doc)` → 成功才 `setDoc`。
- **三種失敗都只設 `error`、不動現有的 `doc`**（沿用舊檔那條原則：查壞了不該把你正在看的圖清掉）：
  1. 網路／HTTP 失敗 → `{ title: '查詢失敗', messages: [...] }`
  2. 回應不是 JSON → `{ title: '回應不是合法 JSON', messages: [e.message] }`
  3. `validate()` 有錯 → `{ title: '回應不合追查 JSON 契約', messages: errs }`
- `loading` 期間圖照舊顯示上一次結果，只有按鈕變「查詢中…」。
- 用 `AbortController` + ref：新查詢送出時 abort 前一個，避免慢的舊回應蓋掉新結果；
  `useEffect` 的 cleanup 也要 abort（React StrictMode 會 mount→unmount→mount 一輪）。
- 開場 `doc` 是 `null`（不再預載內建範例），App 顯示「請輸入條件後查詢」的空狀態。
  `trace-sankey/samples` 的 import 一併移除。

### 3. `app/src/TraceQueryBar.jsx`（新檔）

七個欄位的受控表單。獨立成一支是因為 App.jsx 已經 215 行，塞進去會超過 350 行；
其餘接線仍留在 App.jsx（CLAUDE.md §2「全部接線都在 App.jsx 一支」要跟著改成「圖的接線」）。

- 內部只存**字串**（表單原生行為），送出時才轉型，沿用 `cleanMin()` 那種「壞值有明確去處」的作風。
- 欄位與提示（提示直接寫在 label 旁的 `.hint`，不用 placeholder——placeholder 一打字就消失，
  使用者正需要它的時候看不到）：
  - `起點交換器 hostname` — 必填
  - `起始時間` / `結束時間` — `<input type="datetime-local">`，預設「最近 1 小時」
  - `最多追查層數（跳）` — `type="number" min="1" step="1"`，hint「整數，預設 7」
  - `每台取前幾大 interface` — `type="number" min="1" step="1"`，hint「整數，預設 3」
  - `貢獻門檻（％）` — `type="number" min="0" max="100" step="0.1"`，hint「數字，預設 10；
    只看貢獻超過追查流量此百分比的 interface」
  - `追查方向` — `<select>`：`來源（source）` / `終點（destination）`，hint「預設 來源」
- 送出前檢查，**不合格就不送**、把訊息交給 App 的錯誤橫幅：
  - hostname 空白 → 「請填寫起點交換器 hostname」
  - 任一數字欄非數字／超出範圍 → 「XXX 需要是（正整數 / 0–100 的數字）」
  - 時間欄空白或 `NaN` → 「請選擇起始／結束時間」
  - `from_ts >= to_ts` → 「起始時間必須早於結束時間」
  - 數字欄留空 **視為使用預設值**（不算錯誤），送出前補上 `DEFAULTS`。
- 送出走 `<form onSubmit>`，這樣在欄位裡按 Enter 也能查詢；按鈕 `type="submit"`，
  `loading` 時 `disabled`。

### 4. `app/src/App.jsx`

- 刪：`fileRef`、`openFileRef`、開檔 `<input type="file">` 與「開啟 JSON…」「還原範例」按鈕、
  整段拖放 `useEffect`（`dragenter/over/leave/drop`）、`dragging` state、`drop-hint` 區塊。
- 加：`<TraceQueryBar defaultsFromNow onSubmit={run} loading={loading} onInvalid={setFormError} />`
  取代原本的 `.file-row`。表單自身的驗證錯誤與 hook 的 `error` 共用同一個橫幅（擇一顯示即可）。
- `doc` 為 `null` 時不要 render `<TraceSankey>`（套件會對 null 直接進 error 路徑），
  改顯示 `.empty` 空狀態：「填寫查詢條件後按「查詢」」。
- 「顯示門檻」那一列與圖例、縮放工具列、專注模式、快捷鍵**完全不動**。
  快捷鍵那段本來就會跳過 `INPUT`／`TEXTAREA`，新表單的 `<select>` 要一併加進豁免清單
  （否則在方向選單上按 `1`／`0` 會被圖搶走）。

### 5. `app/src/app.css`

- 刪 `.file-row` / `.file-name` / `.drop-hint` / `.drop-box`。
- 加 `.query-bar`：`display:flex; flex-wrap:wrap; gap:8px 14px; align-items:flex-end`，
  每個欄位是 `.field{display:flex;flex-direction:column;gap:3px}`，內含 `label` + `input` + `.hint`。
- 輸入框樣式沿用 `#minBps` 那組（`#0e1620` 底、`--line2` 框、focus 換 `--cyan`）——
  抽成 `.q-input` class 讓 `#minBps` 也共用，避免第四份色票。
- 查詢按鈕沿用 `.btn`，加一個 `.btn-primary`（`--cyan-d` 底）讓主要動作看得出來。

### 6. `app/vite.config.js`

加 dev proxy，讓開發時的相對路徑跟正式環境一致：

```js
server: {
  proxy: {
    '/api': { target: process.env.VITE_DEV_API || 'http://localhost:8000', changeOrigin: true },
  },
},
```

### 7. `deploy/conf.d/default.conf`

在 `location /` 之前加 API 反向代理。**兩個一定要在註解裡寫明的坑**：

```nginx
    # nginx 啟動時就會解析 proxy_pass 裡的固定 hostname，API 還沒起來會直接
    # 「host not found in upstream」啟動失敗。改用「變數 + resolver」把 DNS
    # 延到每次請求才查，API 晚起來只會是 502，nginx 本身照常服務靜態頁。
    resolver 127.0.0.11 valid=30s;   # Docker 內建 DNS；k8s 改成 kube-dns 的 ClusterIP
    location /api/ {
        set $trace_api http://api:8000;   # 換環境改這一行（k8s 由 ConfigMap 蓋掉）
        proxy_pass $trace_api$request_uri;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;          # 逐跳追查可能跑很久，別用預設 60s
        # add_header 不繼承：server 層那兩行在這裡整組失效，必須重寫（見檔頭註解）
        add_header X-Frame-Options       "DENY"    always;
        add_header X-Content-Type-Options "nosniff" always;
    }
```

安全標頭現在變成**四處**要一起改（原本三處），檔頭註解與 CLAUDE.md §2 的數字要跟著更新。
`deploy/kustomization.yaml` 不動（ConfigMap generator 讀的就是這支，內容 hash 變了會自動 rolling restart）。

### 8. 文件

- **README.md**：把「開啟 JSON／拖放」的使用說明換成查詢表單說明 + 上面那張參數表；
  「不做什麼」那節移除與檔案載入相關的敘述；加一節「API 契約（前端這側的期待）」。
  Electron BrowserView 的 `will-navigate` 白名單那段是為了擋拖放導航的，拖放拿掉後可以刪。
- **CLAUDE.md**：§2（app 描述、安全標頭三處→四處、加上 proxy_pass 一節）、
  §3（目錄結構加 `api.js`／`TraceQueryBar.jsx`）、§4（`useTraceDoc.js` 的新職責與 abort 順序約束）、
  §12（把「尚未做的執行期設定」那段改成「已用 nginx proxy 解決」）。
  §11 的怪癖清單不受影響。

## 不改的部分

`packages/trace-sankey/`、`tools/`、`samples/`、`stress/` 一律不動。
圖形、門檻、殘差、排欄邏輯零改動，所以**不需要跑 golden 對拍**，`make check` 也不受影響。

## 驗證

1. **假 API 起來**：在 scratchpad 寫一支 20 行的 python `http.server`，
   解析 query string、印出收到的七個參數，回傳 `samples/` 裡任一份 JSON（`Content-Type: application/json`）。
   跑在 `:8000`。
2. **開發模式**：`make dev` → 表單填 hostname、選時間、按查詢 → 圖出現；
   假 API 的 log 要看到七個參數，且 `from_ts`／`to_ts` 是毫秒、對應到你在日曆上選的**本地**時間
   （這是 `toISOString()` 陷阱的實測點）。
3. **錯誤路徑**逐一試：假 API 回 500 / 回非 JSON 字串 / 回一份缺 `investigation` 的 JSON
   → 三種錯誤橫幅文案不同，且**圖都還留在上一次的結果**。
4. **表單驗證**：hostname 留空、`max_hops` 填 `0`、`threshold` 填 `200`、起始時間晚於結束時間
   → 都不送出 API（假 API log 不增加）、橫幅有對應訊息。數字欄留空 → 正常送出且帶預設值。
5. **既有功能沒壞**：顯示門檻仍會重畫並顯示隱藏統計 pill、`+/-/0/1/f/Esc` 快捷鍵正常、
   在方向 `<select>` 上按 `1` 不會觸發縮放、專注模式進出後圖仍正確 fit。
6. **StrictMode**：`document.querySelectorAll('.ts-tip')` 只有一個；連按兩次查詢不會出現
   舊回應蓋掉新回應（假 API 加 `sleep` 差異化即可測）。
7. **部署**：`make build && make up` → `curl -sI localhost:8080` 仍 200；
   `curl -s 'localhost:8080/api/trace?hostname=x&from_ts=1&to_ts=2'` 走到 API（或 502，
   證明 nginx 有啟動成功、DNS 是延後解析的）；
   **關掉 API 再 `make down && make up`**，nginx 必須照常起來、靜態頁照常能開——
   這條就是在測上面那個 `resolver` 的坑。
   改 conf 後 `docker compose exec web nginx -s reload` 應立刻生效、完全不 build。
