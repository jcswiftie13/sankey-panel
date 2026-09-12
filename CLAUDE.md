# CLAUDE.md — 給 LLM 的專案說明

這份文件寫給要在本 repo 工作的 LLM。讀完你應該知道：這專案在做什麼、不做什麼、程式怎麼分工、
關鍵演算法在哪、以及動手改東西前必須知道的陷阱。行號會漂移，引用以「檔名 + 函式名」為準。

## 1. 這是什麼

**網路交換器 interface counter 增量／儲存 I/O 流量的追查視覺化工具**（內部自稱「追查 Sankey / Trace Sankey」；
repo 名 `sankey-panel` 只是倉庫名）。原始情境：你在某台 switch 的某條 interface 上看到流量速率
增加了 Δ bps，逐跳追查這股增量從哪來／往哪去，把追查結果記成一份 cytoscape-style 的 wire JSON
（`elements.nodes / elements.edges`），本工具把它畫成一張**守恆的 Sankey 圖**。同一份契約也吃
參考面板（`akira-core/kube-state-graph-frontend` 的 Storage Flow Sankey）的 storage-flow 資料
（netapp-node → aggr → svm → pvc → pod → application → namespace，read／write 各一條帶）。

核心平衡式（每台 hop 都成立）：

```
已知 in ＋ 其他輸入 ＝ 已追查 out ＋ 其他輸出
```

背景：一跳可能有多條 uplink，下游看到的 out 增加可以大於你追進來的那條 in（A→B 10G、B→C 20G）。
多出來的量不是憑空生的，一律用「其他輸入／其他輸出」殘差色塊補齊，讓圖視覺守恆。

**設計哲學（貫穿整個 git 史）**：圖上只放**實際量測值**，不放任何推估。曾經有「可歸因」欄
（按比例攤分推算多少量能歸到追查起點），因為真實流量沒有等比攤分的性質、且推估值跟實際值
在圖上分不出來，已整個移除（commit `5499b24`）。`delta_bps` 是「速率的差」，顯示一律帶 `+` 號
（`fmtDelta`），避免被誤讀成當下吞吐量；`read/write_bytes_per_sec` 是絕對速率，顯示成 `5.24 MB/s`
不帶號（`fmtRate` 依邊的 `unit` 選尺）。

**明確不做**（README）：不自動偵測 switch/counter、不掃網、無帳號無資料庫、追來源不做
左右鏡射、殘差不畫成穿越全圖的 sink 河、未追對端不畫成完整 switch 盒。參考面板能改變呈現的選項（mode、Flat/Node layout、
全路徑高亮、Locate、專注、summary 三張表）**都是套件的選項**（§4）；app 端刻意不做的 UI 與
淺色主題列在 README「與參考面板的行為分歧」。**沒有使用者層的存取控制**：沒有帳號、登入或 session，
連得到 nginx 的人就查得到全部資料（CORS 只約束網頁裡的 JS，擋不住 curl），存取控制留給部署層做。
nginx **與後端之間**可以有一把 service token（環境變數 `TRACE_API_AUTH`，見 §11），
那是給後端拒絕「沒經過 nginx 的直連」用的，不是身分驗證——nginx 會替每個訪客補上那個 header。

## 2. 架構與技術棧

npm workspaces monorepo-lite，兩個部分（外加一個**刻意不在 workspaces 裡**的 `electron/`，見下）：

- **`packages/trace-sankey/`——核心套件**。零依賴、純 ESM、**無 build step**（package.json 的
  exports 直接指 `src/`）。`build()`/`render()` 是純函式（`render(model)` 回傳 SVG 字串、
  無任何 DOM 量測），Node 也能跑（SSR 安全）；`mount()`/`createZoom()`/`createTooltip()`
  需要瀏覽器。**沒有 d3、沒有任何第三方**；SVG 是字串陣列 `out.push('<path .../>')` 拼起來。
  程式風格沿用手寫 ES5（`var`、`function`，唯 import/export 是 ESM），改碼請維持。
  react 是 optional peerDependency，只有 `trace-sankey/react` 子路徑會載到。
- **`app/`——Vite + React 使用端**。查詢表單 + 圖 + 顯示門檻，加圖例與縮放工具列。
  **圖的接線**在 `App.jsx`；資料來源在 `useTraceDoc.js`、API 呼叫在 `api.js`、
  表單在 `TraceQueryBar.jsx`。`npm install`（repo 根目錄）後 `make dev`
  或 `npm run dev --workspace app`；dev server 把 `/api` 代理到 `http://localhost:8000`
  （`VITE_DEV_API` 可覆蓋），與正式環境的 nginx 行為一致。
  開發時 Vite 直接吃套件 src/（workspace symlink），改套件存檔即熱更新，**沒有 ?v= 快取紀律了**。
- **部署——nginx 靜態託管，網頁與 nginx 分成兩層**（細節與陷阱見 §11）。`Dockerfile` 三個
  stage（build → content → standalone）＋ `docker-compose.yml`（content 映像倒進 volume +
  官方 nginx）＋ `docker-compose.dev.yml`（bind mount app/dist）＋ `deploy/templates/default.conf.template`
  ＋ `deploy/kustomization.yaml`（k8s）。`make up` / `make up-dev` / `make down` /
  `make content-build` / `make docker-build` / `make build`；對外 port 用 `PORT=`。
  **靜態檔 + 一段 `/api/` 反向代理**：前端只打同源相對路徑（免 CORS、不把後端網址烤進
  bundle），後端位置寫在 `set $trace_api …` 那一行；`proxy_pass` 是**變數 + `resolver`**，
  不是固定 hostname——固定 hostname 會讓 nginx 在 API 沒起來時直接啟動失敗（見 §11）。
  `deploy/templates/default.conf.template` 是 **template 不是 conf**：官方映像的
  `20-envsubst-on-templates.sh` 啟動時 envsubst 成 `/etc/nginx/conf.d/default.conf`，
  蓋掉映像自帶的那支（`NGINX_ENVSUBST_FILTER=^TRACE_` 是強制的，見 §11）。
  被 include 在 `http {}` 內所以只能有一個 `server {}`；**nginx 的
  `add_header` 不繼承**，`= /index.html`、`/assets/` 與 `/api/` 三個 location 各自重寫一份
  安全標頭，連 server 層共**四處**，改標頭要四處一起改。消費端是 **Electron BrowserView**
  （`http://localhost:8080`，不是 iframe）：host 端必須用 `will-navigate` 白名單擋掉預設的
  拖放導航，否則整頁跳去 `file://…json`。**但 host 端不是我們能控制的**，所以 App.jsx
  自己也無條件 `preventDefault()`（開檔／拖放功能已移除，那個 effect 只剩這道防線，見 §4）。
  README 的「被 Electron 鑲嵌時」整章列了 host 的哪些設定會影響我們、以及 nginx／網頁
  該怎麼因應（CSP 的 `style-src` 必須有 `'unsafe-inline'`、Trusted Types 會打死 `mount.js`
  的 `innerHTML`、iframe 才會被 `X-Frame-Options` 擋、API 化之後一律走同源 `proxy_pass`……）。
- **`electron/`——Electron 測試殼**，同時是 host 端的參考實作。`main.js` 一支（CJS，
  刻意不跟 repo 的 ESM），環境變數 `VIEW_API`／`GUARD`／`SESSION`／`CSP`／`EMBED` 可以
  重現各種 host 設錯的情況，對應 README 那章的每一節。`make electron` 啟動。
  **不在 npm workspaces 裡也不進 docker build context**（`.dockerignore` 有排除）：
  Dockerfile 的 build 階段只 COPY 三份 manifest 就 `npm ci`，加進 workspaces 會直接壞掉，
  而且會讓每次 docker build 都下載上百 MB 的 Electron 執行檔。

Python CLI（`tools/trace_sankey.py`，連同 Mermaid／plotly 輸出）**已移除**；`make check` 現在是
`node tools/golden.mjs check`。`stress/gen.py` 是唯一剩下的 Python，純標準函式庫。

全專案文件、UI、JS 註解為**繁體中文**。深色主題。
Makefile：`make dev`（=`serve`）/ `build`（vite build）/ `up`／`up-dev`／`down`／
`content-build`／`docker-build`（部署，見 §11）/ `electron`（Electron 測試殼）/ `check`（build 遍所有範例）/
`golden DIR=…`（對拍 dump）/ `clean`。

## 3. 目錄結構

```
packages/trace-sankey/
  package.json            exports："."（主入口）、"./react"、"./samples"、"./style.css"
  src/model.js            wire JSON 驗證 → 分類節點 → 加總同鍵的邊（含門檻／通道）→ 排欄/破環 → 殘差
  src/render.js           版面計算 + SVG 字串組裝 + 各種卡片 + hop 摘要表（summary；app 目前沒用）
  src/zoom.js             createZoom() 工廠：縮放平移（只改 <g class="zoom-layer"> 的 transform）
  src/tooltip.js          createTooltip()：tooltip 元素掛 body、對 .band 與卡片 <g>[data-tip] 綁 hover
  src/highlight.js        createHighlight()：路徑高亮（pathHighlight 選項），只加減 class
  src/mount.js            mount(el, doc, opts)：build → render → zoom → tooltip（→ highlight／click）接成一個實例
  src/react.js            <TraceSankey> 薄殼（純 JS createElement，不用 JSX → 套件不需 build）
  src/samples.js          10 個內建範例（純資料；N()/E() 是字面值簡寫；storage 是參考面板的 fixture）
  src/index.js            主入口 re-export
  styles/trace-sankey.css 圖表與 tooltip 樣式；CSS 變數 scope 在 .trace-sankey，不進 :root
  types/index.d.ts        手寫型別（JS 原始碼不轉 TS）
app/                      Vite + React 使用端
  src/App.jsx             圖、顯示門檻、圖例、縮放、快捷鍵的接線
  src/DevSampleBar.jsx    dev 專用的本機資料來源列（內建範例下拉＋選檔）；只被 App 的
                          import.meta.env.DEV 動態 import 載入，正式 bundle 裡不存在
  src/api.js              追查 API 的唯一出入口：組 query、fetch、翻譯錯誤、時間轉換
  src/useTraceDoc.js      資料來源 hook：run() → fetch → validate；abort 舊查詢
  src/TraceQueryBar.jsx   查詢表單；buildParams() 是可測的純函式
  src/app.css             頁面版面
electron/                 Electron 測試殼：main.js（CJS）＋ fallback.html ＋ embed.html。
                          不在 workspaces、不進 docker build context；自己 npm install
samples/*.json            同一批範例的檔案版（拖放測試與 golden 用；與 src/samples.js 重複維護，見 §11）
                          storage.json 原封不動取自參考 repo public/demo/storage-graph.json @ 9e568c7（Apache-2.0）
stress/                   縮放平移壓力測試資料 + gen.py（輸出 wire 格式）。make check 也會 build 它們
tools/golden.mjs          對拍工具：dump 所有範例的 render()/summary() 輸出，重構前後 diff -r；check 子命令
docs/migration-wire-format.md  舊 investigation+hops 格式 → elements 格式的手動遷移指南
docs/superpowers/specs/   設計文件（本次改格式的定案與盤點基準）
Dockerfile                三個 stage：build（node）→ content（busybox+dist，3MB）→ standalone（nginx 全包）
docker-compose.yml        分離式：content 映像倒進 named volume + 官方 nginx（make up）
docker-compose.dev.yml    nginx bind mount 主機的 app/dist（make up-dev）；專案名刻意不同
deploy/templates/default.conf.template
                          nginx server 區塊的 envsubst template：/api/ 反向代理（含由環境變數
                          注入的 X-API-Key）、try_files SPA fallback、快取分層、gzip
deploy/kustomization.yaml   k8s 入口（kubectl apply -k deploy）；ConfigMap 直接讀上面那支
deploy/k8s/               Deployment（initContainer 倒內容到 emptyDir）與 Service
Makefile                  入口指令
README.md                 使用說明 + 輸入 JSON 契約 + 驗證錯誤對照表 + 畫法定案 + 與參考面板的分歧
```

沒有 CI、lint、test 框架。**程式註解就是主要文件**：幾乎每個非顯而易見的決策都有中文註解
解釋「為什麼不是別的做法」，改碼時請延續這個慣例。

## 4. 資料流管線

```
doc（app：useTraceDoc 打 GET /api/trace 取回，validate 過才進來）
  → <TraceSankey doc minBps channels layout roots pathHighlight onNodeClick>（react.js）
    → mount(el, doc, {minBps, channels, layout, roots, pathHighlight, onNodeClick, onModel, onError, onZoom})
      → build(doc, {minBps, channels, layout, roots})   失敗 → onError(errors)，app 畫錯誤 UI；成功 ↓
      → onModel(model)           app 拿去拼圖例、隱藏統計 pill
      → render(model)            SVG 字串 → chart.innerHTML（key 沒變且 svg 還在就跳過）
      → tooltip.bind(chart)      每條 .band 與每張卡片 <g>[data-tip] 綁 tooltip
      → highlight.bind(el)       pathHighlight 才綁：卡片 hover 亮整條路徑（highlight.js）
      → bindClicks()             onNodeClick 才綁：可定位的卡加 .clickable 與 click
      → zoom.attach(el)          綁縮放平移
```

**參考面板的選項全部是套件選項**（這是設計目標，不是 app 的 UI）：`channels`（mode）、`layout`
（Flat／Node）、`roots`、`pathHighlight`、`onNodeClick`（Locate）、`inst.focus()`（專注）、
`flowTables()`（三張表）。app 只接了 `layout` 切換鈕、`pathHighlight` 與專注；主題不做。

mount `update()` 的重要順序約束（都是 app.js 時代踩過的坑，搬進套件後仍然成立）：

- 重畫判斷 key = `JSON.stringify(doc) + '\n' + minBps + '\n' + channels + '\n' + layout + '\n' + JSON.stringify(roots)`，
  沒變**且 `chart.querySelector('svg')` 還在**才沿用既有 SVG（保縮放）。**會改 model 的選項一定要在鍵裡**，
  不然改了不會重畫；svg 存在檢查對應「錯誤後復原」的路徑。`pathHighlight`／`onNodeClick` 在掛載時決定、不進鍵。
- build 失敗：清空 chart、`zoom.detach()`、`lastKey = null`、呼叫 `onError`。mount **不畫**
  錯誤 UI——文案是使用端的責任。
- 容器要**先有高度再 mount／update**（zoom 的 fit 用容器實際大小算）；尺寸變了呼叫
  `refresh()`。app 用 flex column 讓圖吃滿剩餘高度，所以不再需要舊版量 DOM 的 `sizeChart()`。
- `destroy()` 必須冪等：React StrictMode 開發模式會故意 mount→unmount→mount 一輪。
- **專注模式**現在是 `inst.focus(on)`（toggle `body.chart-focus` ＋ `zoom.refresh()`）；套件 CSS 只管容器去框，
  app 藏 topbar／legend 的規則留在 `app.css`。`destroy()` 會把 class 移掉。
- **react.js 的 `onNodeClick` 在掛載時有給才傳進 mount**（跟 `pathHighlight` 一樣）：永遠傳一個轉呼叫殼會讓
  所有可定位的卡都變 `cursor:pointer` 但點了沒事。

app 端約束（`App.jsx`）：門檻重畫 debounce 200ms、提示文字不 debounce；`cleanMin()` 把負數／
小數／亂打的字一律當 0。**資料來源整個關在 `useTraceDoc.js`**（`run(params)` →
`fetchTrace` → `validate`；三種失敗——連不到／HTTP 非 2xx、回應不是 JSON、不合契約——
都只設 `error` 不動現有 `doc`，查壞了不該清掉你正在看的圖）。兩個 abort 約束：
**新查詢送出前先 abort 前一個**（否則慢的舊回應會蓋掉新結果），**卸載時也要 abort**
（StrictMode 會 mount→unmount→mount）；abort 後的分支要**整個 return、連 `loading` 都不碰**，
那個 state 已經屬於新查詢了。`doc` 開場是 `null`，App 這時**不掛 `<TraceSankey>`**
（套件對 null 會直接走 error 路徑），改顯示 `.empty` 空狀態。
表單驗證錯誤（`formError`）與查詢錯誤（`loadError`）共用同一個橫幅、表單的優先。
快捷鍵的豁免清單要包含 `SELECT`，否則在「追查方向」選單上按 `1`／`0` 會被圖搶走。
**拖放 effect 要留著**：開檔與拖放功能已移除，但它無條件 `preventDefault()` 且掛在
capture 階段，這是 host 沒設 `will-navigate` 白名單時唯一擋得住「整頁導航到
`file://…json`」的地方——別因為「沒有開檔功能了」就把它一起刪掉。
舊版分頁／編輯器／localStorage 續存均為移除狀態；**開檔以 dev 專用的形式回來了**
（見下），拖放沒有回來。
**query string 回來了，但目的不同**：不是續存 UI 狀態，是「把查詢條件同步進網址列讓人分享」。
互轉關在 `api.js`（`toQuery` 組 query、`searchFromParams` 產生分享網址、`fieldsFromSearch`
把網址讀回**表單欄位字串**）。四個約束：
- 網址**只在開場讀一次**（App 的 `initial`），之後網址是被查詢結果改寫的那一端；再讀回來
  會把使用者正在編輯的欄位蓋掉。`TraceQueryBar` 的 `initial` prop 同理**只當初值、不受控同步**。
- 寫回掛在 `lastQuery`（只有查成功才設）＋ `min`，用 `history.replaceState`：**查失敗不動 doc，
  網址也就不該動**；不接 `popstate`，不做「上一頁回到前一次查詢」的語意。
- 網址裡的時間是 **epoch 毫秒**（與 API 參數同名同型）。`msField()` 對「缺」與「壞」**回傳不同東西**：
  缺 → 空字串，App 補 `defaultTimes()` 的最近 1 小時；壞 → 原樣回傳，讓 `buildParams()` 算出 NaN 報錯。
  壞值若也回空字串，分享連結會安靜地看到錯的時間區間。
- 「最近 1 小時」的預設**只有 `api.js` 的 `defaultTimes()` 一份**：表單初值與「進場自動查一次」
  的參數必須同一組，抄兩份會變成欄位顯示一個時間、實際查另一個。
進場時網址有 `hostname` 才自動查一次，且走 `buildParams()` → `run()`／`setFormError` 這條
與表單送出**完全相同**的路，壞網址落進同一個橫幅。
**dev 專用的本機資料來源**（`DevSampleBar.jsx`：內建範例下拉＋選檔）整支關在 App 的
`if (import.meta.env.DEV) { import('./DevSampleBar.jsx') }` 後面——`vite build` 把條件換成
`false`、整段連同 `import()` 一起消掉，Rollup 因此**不產生那個 chunk**，正式 bundle 零範例位元組
（這是「同一顆 content 映像跨環境共用」的延伸，見 §11）。所以那支檔案裡可以放心「靜態」
import `trace-sankey/samples`。**不要**改成靜態 import ＋ 條件渲染：那要賭 Rollup 能證明那條
JSX 分支是死的，多牽一條引用就會安靜地把 30KB 範例烤進去、沒有任何警告。
動這塊之後一定要重跑驗證：`npm run build --workspace app` 後
`grep -ra "sw-edge-a\|lab-gpu-01\|DevSampleBar\|trace-sankey/samples" app/dist/assets/*.js`
必須沒有輸出，且 `find app/dist -name '*.js' | wc -l` 仍是 1。
`make up-dev` 與 Electron 殼載的都是正式 build，**那裡沒有這一列是設計、不是壞掉**。
資料進 doc 的第二條路是 `useTraceDoc` 的 `showDoc(json, label)`：先 abort 前一個查詢
（否則慢的舊回應會蓋掉剛載進來的那份）、走**同一個** `validate()`、失敗只設 error 不動 doc。
`JSON.parse` 失敗的呼叫端直接傳 `null` 進來就好，`validate(null)` 會回「最外層必須是 JSON 物件。」，
落進同一個橫幅，不必開第二條錯誤通道。`source`（`{kind:'api'}`／`{kind:'local',label}`）
**只在 `run()` 成功時**才變回 api——查詢失敗不動 doc，來源標示就得跟著圖走。
**app 沒有 `channels` 切換鈕**（刻意，那是給使用套件的人接的 API）；圖例在 model 有通道邊時
自動換成 read／write 兩色、有 status 時多一行外框色說明。

## 5. 輸入 JSON 契約（濃縮版；完整版在 README.md，舊格式轉換在 docs/migration-wire-format.md）

```jsonc
{
  "apiVersion": "v1", "clusters": ["prod"], // 選填的信封欄位：給了驗型別、build 原樣帶出，不影響畫圖
  "kind": "destination" | "source",        // 選填；否則看起點的 direction（out→source）；預設 destination
  "investigation": { "node_id": "...", … }, // **deprecated** 的頂層寫法：仍接受＋警告；與節點寫法兩處都給是驗證錯誤
  "elements": {
    "nodes": [{ "data": {
      "id": "...", "type": "...",           // 必填；id 不可重複
      "name": "...", "parent": "...",       // 選填；parent 是群組鏈（namespace / application）
      "investigation": {                    // 選填：追查起點寫在起點節點上（全圖最多一個、必須 hop 型）。
        "iface": "...", "delta_bps": 1e10,  //   放 elements 裡面，同一份文件丟 cytoscape 也看得到起點
        "direction": "in" | "out", "note": ""
      },
      "labels": { "namespace": "…", "tier": "…", "ontap_cluster": "…" },   // 純字串表
      "status": "normal|warning|critical",  // 其他值視同沒有
      "usage": { "used_bytes": 0, "capacity_bytes": 0 },   // 兩欄各自獨立、絕不填 0
      "health": "…", "hardware": {…}, "perf": {…}, "alerts": [...],   // 只進 tooltip
      "clients": [{ "ip": "…", "hostname": "…", "owner": "…" }],       // 無鄰居 port 上查到的 client；
                                                                       // 三欄全選填但至少要有 ip 或 hostname，否則靜默丟棄；只有葉卡畫到卡面
      "other_in_bps": 0, "other_out_bps": 0 // ≥ 0；不給就由平衡式補
    }}],
    "edges": [{ "data": {
      "id": "…", "type": "network-flow" | "storage-flow",   // 其他 type 整條忽略
      "source": "…", "target": "…",                          // 一律封包方向
      "labels": { "tier": "…", "source_iface": "…", "target_iface": "…", "attribution": "split" },
      "metrics": { "delta_bps": 0 } | { "read_bytes_per_sec": 0, "write_bytes_per_sec": 0, /* ops/latency/max_* 只進 tooltip */ }
    }}]
  }
}
```

型別三類（`model.js` 的 `HOP_TYPES`／`GROUP_TYPES`／`classOf`）：hop（`switch, node, pod, netapp-node,
netapp-aggr, netapp-svm, pvc`）→ 盒子；群組（`namespace, application, cluster, storage-cluster, controller`）
→ 不畫、只在 `parent` 鏈上；其他任何 type → 灰色葉卡（葉不能再有往下走的 flow 邊，驗證錯誤）。
**葉 pod** ＝ `type:"pod"` 且沒有往下走的邊 → pod 卡＋推導邊到 application／namespace；有往下走的邊＝proxy pod。
**帶 `clients` 的葉**再推導出一欄 **owner 卡**（`role:'owner'`，不是 wire type、輸入裡沒有這種節點）。
`netapp-*`／`pvc` 沒給 `labels.tier` 就自動以 type 當 tier（`AUTO_TIER`）鎖同欄；`switch/node/pod` 不自動。

`weightOf(metrics)` 回**通道陣列**：有 `rate` → 空（RED 家族）；有 `delta_bps` → 一條 `unit:'bps'` 無通道；
否則 read／write 各自存在就各一條 `unit:'bytesPerSec'`。**absent ≠ 0**（0 照畫，帶 `band-zero` 虛線半透明、
不印帶上數字）；負數丟欄＋警告。同 `(source, target, source_iface, target_iface, channel)` 相加。

**起點的解析層**：`resolveInvestigation(doc)` 把節點形式與 deprecated 的頂層形式都正規化成
`{node_id, iface, delta_bps, direction, note}`，`validate()`／`direction()`／步驟 3 都吃它，render 的錨卡
不知道契約改過。golden `check` 會把每份範例程式化搬回頂層形式再比 render 輸出（不留舊形式範例），
另加 deep-freeze：`build()` 只能讀不能寫 doc（與參考 spec「derivation MUST NOT mutate」同一要求）。
契約是 cytoscape elements 的超集：我們接受的文件丟 `cytoscape({elements: doc.elements})` 都合法。

範例節點代號都是網路設備角色縮寫：`bdr`=border router、`dci`=DC interconnect、`spn`=spine、
`tor`=top-of-rack、`core`/`agg`/`edge`=核心/匯聚/接入層、`fw`=防火牆。iface 命名照 Juniper 慣例
（`et-*`=100/40G、`xe-*`=10G、`ae0`=LAG）與 Linux（`bond0`、`eno1`）。

## 6. model.js：`build(doc, opts)` 演算法

匯出：`build` / `validate` / `direction` / `fmtBps` / `fmtDelta` / `fmtBytes` / `fmtRate` / `fmtAmount` / `gbps` /
`HOP_TYPES` / `GROUP_TYPES` / `FLOW_TYPES` / `TYPE_LABEL`。

`opts.minBps` 是**顯示門檻**：只留值**大於**它的帶子，`0`／沒給＝不過濾。`opts.channels`
（`'both'` 預設／`'read'`／`'write'`）只看 storage 資料的其中一個通道。兩者都是看圖的設定，
不進 JSON 契約、不影響 `validate()`，**走同一條過濾路**（濾掉的量記進 `dropIn`／`dropOut`，
步驟 6 併回殘差，每台仍守恆）。`opts.layout`（`'flat'` 預設／`'node'`）決定 k8s node 是丟掉還是收成
`wrappers`；`opts.roots`（參考的 `{ontap_cluster,node,aggr,svm,pod}`）**省略＝現行超集（no-flow 全保留）、
給了（含空物件）＝參考規則**（`isRequestedRoot()` 照抄參考 `deriveSankey`：只保留 root 或完全沒被任何邊碰到的；
root 的葉 pod 沒有邊也補成 no-flow 卡並排到 pod 欄）。root 只用來保留、絕不用來過濾。

build 分七步（門檻／通道散在步驟 2、4b、6 三處，用 ★ 標）：

0. `indexRaw(doc)`（id 索引 + `ancestorOf(id, type)`，**帶 visited set**——parent 鏈可能成環／懸空）；
   `nsOfPod`：application 祖先的 namespace 祖先 → pod 自己的 namespace 祖先 → `labels.namespace`。
1. **1a 掃邊**：非 FLOW_TYPES 跳過；`tier:"pod-node"` 記 `podNodeTouch` 後跳過；記 `flowTouch`、
   方向計數 `contOut/contIn`（**不看 metrics**——「有沒有往下走的邊」是拓樸事實）；`weightOf` 為空 → 計進
   一則「N 條沒有量測值」警告；否則每個通道以 `src\0tgt\0sif\0tif\0channel` 為鍵**加總**進 `agg`（保留首次
   出現順序）。**1b 掃節點**：群組跳過；葉型與葉 pod **不在這裡建**（lazy，門檻濾掉就不留孤兒卡）；
   `type:"node"` 只被 pod-node 碰到 → flat 跳過、`layout:'node'` 收進 `k8sRaw`（步驟 6b 變外框）；
   `pod-node` 邊另記 `k8sPods`（node → 它上面的 pod）。其餘 `mkHop` → `{id, label, role:type, kind:'node', tier,
   namespace, ontapCluster, otherInBps/otherOutBps, noFlow:!drawTouch, status, usage, info}`；no-flow 的 hop 過
   `keepNoFlow()`（有 `roots` 才會丟）。沒有任何 hop → `ok:false`。
2. **建邊**：依 `aggOrder`，**一律照封包方向左→右**（source 模式一樣，只是葉在左）。
   ★ **門檻／通道過濾排在建邊之前**：沒過的直接 `return`，量記進 hop 端的 `dropIn`／`dropOut`。
   `ensureLeaf` 在第一條存活邊時才建葉（多條邊接同一葉：iface 不一致就留空）。
   **葉 pod 再接推導邊**（`linkPod`，**鍵帶 channel**）：有 application 祖先 → pod→app（`appFor`，鍵帶 ns）＋ app→ns
   （全 app **同通道**共用一條 `app.nsEdges[ch]`，累加）；否則 pod→ns（`nsFor`）。第一次在 hop→pod 邊之後立刻建
   （邊序＝z-order），之後同 pod 同通道只累加。推導邊 `unit` 沿用 pod 入邊、`channel` 沿用（storage 資料 read／write
   **各一條**，switch 資料 null → 鍵退化成 pod.id、輸出不變）、`derived:true`、`tier` 是參考的欄對詞
   （`pod-application`／`application-namespace`／`pod-namespace`）。source 模式全部反接。
   `memberPods()` 依節點去重——同一個成員接兩條（read／write）推導邊，不去重 pod 數會加倍。
   **葉再接 owner 卡**（`linkOwner`／`ownerFor`／`ownerGroups`）：依 `clients[].owner` 分組、同名全圖合一。
   **查不到 owner 的那一組不開卡也不連線**（「查不到」不是一個人），但 `ownerGroups` 仍要回傳它——
   `metered` 看的是**全部**組數：卡上還有不知道是誰的機器時，那張卡的量就不是這個 owner 一個人的。
   **整張卡只有一組（且具名）才把量帶過去**（`metered`，全額、算進 `meteredPorts`）；否則每個具名 owner
   各一條 `owns:true` 的**歸屬線**：`bps` 恆 0、只表達歸屬——拆開就是 `5499b24` 移除過的攤分推估
   （見 §10.13）。一個 owner 都查不到的葉整個不接（`ownerLinked` 不設，維持終點葉卡）。
   owner 卡另記 `clientCount`／`portCount`／`meteredPorts`。
3. **錨卡** `__anchor__`：**有 `investigation` 才建**；root 若是 1b 丟掉的 node → `ok:false`；
   `root.noFlow = false`（錨邊就是它的流量）。★ 錨邊在過濾之後才建，所以追查起點永遠保留。
4. **掛邊**；★ **4b 移除孤立節點**（`minBps > 0 || channels !== 'both'` 時）：**noFlow 卡豁免**，其餘一條邊都
   不剩的整台移除。沒有 investigation 的圖可能被濾到一台不剩——**那是 ok:true 的空模型**，render 畫
   空畫布＋說明，不是錯誤。**一定要排在步驟 5 之前**。
5. **排欄**（5a–5g，與改格式前逐字相同）：tier 群當超級節點；5b 流量多數決破環；5c Kosaraju SCC 破殘環；
   5d 最長路徑；5e `backward`；5f `lateral`；5g `subOrder`（純排版用）。組合鍵分隔字元是 `SEP`（NUL）。
6. **殘差**：`eps = max(in,out)*0.005 + 1`。noFlow 短路（全 0、`resEps=1`）。★ 先把 `dropIn`／`dropOut`
   **加進顯式的** `otherInBps`／`otherOutBps`，`null` 不碰。**源頭豁免**：`!inEdges.length && !dropIn && otherInBps==null`
   → `otherIn = 0`（netapp-node 的流量來自磁碟，不補其他輸入）；**只做入側，不對稱做出側**——
   「沒有往下的邊就補其他輸出」是 k8s 範例 `node-w-13`（node 當葉）的既有行為。
   節點 `unit` 跟著身上的邊。**所有葉** `bps = sum(edges)`；app 卡算 `podCount` 與 `status = worstStatus(成員 pod)`，
   ns 卡再穿過 app 算一次。
   **6b. wrappers**（`layout:'node'`）：每個 `k8sRaw` 的成員＝它上面**最後留在圖上**的葉 pod；沒成員又不是 root
   就不畫、是 root 就 `noFlow:true` 的空外框；`status = worstStatus([node 自己, ...成員])`；成員 pod 設 `k8sNode`。
   **外框不是圖節點**：不進 `nodes`／`ids`、沒有邊、不排欄、不算殘差。
7. **正規化欄位**（空模型 `minCol = 0`）；root 的 no-flow 葉 pod 改到 pod 欄（不然最長路徑排到第 0 欄、進不了外框）。

回傳 `{ok, dir, investigation|null, channels, minBps, layout, wrappers, roots|null, apiVersion|null, clusters|null,
filtered, filteredNodes, nodes, nodeMap, edges, anchorEdge|null, root|null, warnings, maxCol}`。

## 7. render.js：版面與繪製

匯出：`render` / `summary` / `esc`。核心是 `layout(model)`：

- **全圖共用一把比例尺**：`maxVal = max(所有邊, 所有殘差)`，`thick(v) = max(THICK_MIN=3, v * THICK_MAX/maxVal)`，
  `THICK_MAX = 86`。殘差跟帶同一把尺，比例才讀得出來。read 與 write 帶也共用（跟參考一致）。
- **殘差門檻** `resIn/resOut`：只有 `> n.resEps` 才畫。同一門檻圖與 summary 表共用。
- `headerH(n) = HEADER_H + (usage 兩欄齊全 ? 12 : 0)`：有 usage 副標的盒子標題區高一行；槽位 top／avail 跟著算。
- **backNear** 判定：`backward && from.col - to.col === 1`。只跨一欄的回流走「走廊短帶」；
  跨兩欄以上才繞圖底外圍 lane（`backwardRibbon`）。
- **port 槽位順序**（`leftSlots`/`rightSlots`）：一般邊 → lateral → backNear → 跨多欄回流；**殘差是真槽位，push 在最外側**。
  pod 葉的槽位依對端 y 重排（node、ns、app 卡都重排）。
- **欄位 y**：先算 `__pref`（跨欄上游 `__cy` 平均）；只被同欄餵的節點沿 `subOrder` 繼承；pod 依 ns 分組相鄰。
- **三種路徑產生器**：`ribbon`、`lateralRibbon`、`backwardRibbon`。

`render(model)` 的繪製順序＝z-order：defs 漸層（**留在 zoom-layer 外面**；`gband-w`／`gband-w-h` 只在圖上
真有 write 帶時才輸出，switch 資料的 SVG 逐 byte 不變）→ `<g class="zoom-layer">` → 欄位標題 → **帶（先畫）**
→ 帶上數字（`fmtRate(e.bps, e.unit)`）→ 盒子／卡片 → **殘差色塊（最後畫）**。

- 帶：`class="band"`（write 通道加 `band-w`、回流加 `band-back`／`band-loop`、同欄加 `band-lat`），fill 依通道
  （`gband` 給 read 與無通道帶、`gband-w` 給 write），`data-tip` JSON（`from/to/fi/ti/bps/anchor` ＋
  只在有值時出現的 `backward/ns/unit/channel/tier/attr/extra`——**用 `undefined` 讓 stringify 丟掉**，舊資料的
  data-tip 才不變）與原生 `<title>`（headless 備援，`tooltip.bind()` 會剝掉）。lateral 帶另輸出 `.lat-arrow`
  （write 加 `arrow-w`），**必須是 band 的兄弟節點**。回流帶維持玫瑰、不分通道。
- `leafCard` 有 `clients` 時走另一條分支，畫成 `hostname` / `ip` / `owner` 三欄表格：
  `clientCols(n)` 決定畫哪幾欄（**某欄所有 client 都沒值就整欄不畫**），`clientW(n)` 算卡寬
  （欄寬總和＋`CLIENT_GAP 10`＋左右 `CLIENT_PAD 12`，下限 `LEAF_W`），
  `leafH(n) = 70 + (ns?14:0) + (named?14:0) + 14 表頭 + N*14`。
  接了 owner 卡的葉（`n.ownerLinked`）左上角從「追查終止」改成 `port`。
  **合成 id 不當標題**（順著帶子回去就知道是哪台 switch 的哪個 iface），只有 `n.named`
  （輸入真的給了 `name`）才畫標題；**最後一行不重複 iface**、只印量。表頭沿用 `.leaf-stop`、
  分隔線沿用 `nodeBox` 那條內聯 `stroke="#22303f"`——不新增 CSS 類別與顏色。
  **沒有 `clients` 的節點完全不走這條分支，輸出逐 byte 與舊版相同。**
- `CLIENT_COLS` 的 `w` 必須容得下 `budget + 1` 個估寬單位：`clip()` 截完會再補一個 `…`，
  照 `budget` 抓欄寬會讓最長的那格戳進欄距（實測 24 單位的 hostname 截完是 127px）。
  一個半形單位實測 5.09～5.12px（`.leaf-sub` 10px），取 5.15 留餘裕；`ip` 欄要放得下完整 IPv4。
- 加寬葉卡是安全的：`layout()` 的欄寬是 `list.reduce(max(n.w), NODE_W)`——每欄取該欄最寬、
  下限 `NODE_W`，同欄所有卡片共用同一個 `x`。加寬只會撐寬自己那一欄、把後面的欄整體右移。
- 帶的 `data-tip` 多一個 `clients` 鍵（`clientsMeta()`：取封包下游那端節點的
  `hostname || ip` 陣列），給「兩台以上時卡片標題不是 client 身分」補身分；
  照既有慣例只在有值時出現，所以沒有 clients 的圖 `data-tip` 逐 byte 不變。
  **`tooltip.js` 的帶是明確列鍵的**，加新鍵要同步在那裡加一列。
- **歸屬線**（`e.owns`）：`ownLine()` 是 `ribbon()` 的中線版本，畫成 `fill:none` 的灰虛線
  （`band band-own`，比照 `band-loop` 的描邊帶），**不印帶上數字**、tooltip 也不印速率——
  `bps` 是 0，那不是「零流量」而是「沒有量」。線寬 `OWN_T` 同時是 hover 判定寬度，別再調細。
  槽位厚度走 `e.__t`（`owns` 用 `OWN_T`、其餘 `thick(e.bps)`），不是直接 `thick(e.bps)`。
- **槽位重排**（`reorderSlots`）：pod／ns／app 那組之外，`ownerLinked` 的葉與 owner 卡也要依對端 y 重排——
  port 葉的出邊順序是 `clients` 的出現順序、owner 卡的入邊順序是建邊順序，都跟 y 無關，
  一張 port 掛五個 owner 時歸屬線會整束交叉（實測過）。
- 卡片：`nodeBox`（hop）／`leafCard`／`podCard`／`groupCard`（ns／app 共用，`nsCard`/`appCard` 是薄殼）／
  `ownerCard`／`anchorCard`。`ownerCard` 寬度是 `NODE_W`（owner 是自由字串，`LEAF_W` 截太兇；
  欄寬下限本來就是 `NODE_W`，不會把後面的欄推開）、高 84；**量與台數分兩行**，
  `meteredPorts < portCount` 標「（部分 port）」、`bps` 為 0 印「量停在 port」，**絕不印 0**。
  **每張卡的 `<g>` 都帶 `data-tip`**（`nodeTip()` 產生 `{node:1, title, rows:[[k,v],…]}`，render 已格式化好；
  順序照參考面板：型別／名稱、id、ns、ontap_cluster、流量、usage、status、health、model、perf(raw)、alerts、no-flow）。
  `nodeBox` 外框色優先序 **status（critical `#fb7185`／warning `#f59e0b`／normal `#4ade80`；綠刻意避開 ns 色盤的
  `#34d399`）> isRoot 青 > 設備天藍 > 預設**，
  `DEVICE_TYPES`（node/pod/netapp 三型別）虛線；副標 `id · ns/x · <type> · <ontap_cluster>`（switch 不印 type）。
- `colCaption`：錨欄要 `kinds.anchor && col.length===1`（no-flow 卡會落在第 0 欄）；整欄同一非 switch role →
  `第 N 跳 · TYPE_LABEL[role]`；整欄 app → `第 N 跳 · application`。

- **k8s node 外框**（`layout:'node'`，`wrapperBox`）：`layout()` 在 pod 欄（有葉 pod 的欄；全被濾光只剩 root 空外框時
  另開一欄）先依外框分區——外框照 `label.localeCompare` 排、框內 pod 維持既有比較器順序、沒排班的 pod 在所有外框
  之下，`col` 陣列同步重排；被包的 pod `x += WRAP_PAD`，欄寬取 `max(最寬 pod + 2*WRAP_PAD, NODE_W)`；外框的
  y／高度跟著 `shift` 與 `dy` 一起動、算進圖高。畫在帶之上、卡片之下：本體 rect `pointer-events="none"`，
  只有標題列的 `<g data-n data-tip>`（透明 rect＋標題＋副標）收 hover／click。tooltip 的量是成員 pod 邊的加總。
- **`flowTables(model)`**：參考的三張表；`summary()` 不動。namespace 小計只算葉 pod 的入邊（pod 的出邊全是推導邊）。

**套件的 public 契約**（README 也要記）：`<g class="zoom-layer">` 是 zoom 的 hook；`.band` 與卡片 `<g>` 上的
`data-tip` JSON 是 tooltip 的資料通道；**`.band` 的 `data-e`（edges 索引）與卡片／外框 `<g>` 的 `data-n`（id）**
是 highlight.js 與 `onNodeClick` 把 DOM 對回 model 的通道（靠 DOM 順序會在輸出順序一動就壞）；`band-zero`；
`channels`／`layout`／`roots` 選項。改這些等於改對外 API。

## 8. zoom / mount / react / CSS 關鍵決策（改壞會回退歷史 bug）

- **hover 高亮純靠 CSS**（`.band:hover` 換 fill；`.band-w:hover` 換 `gband-w-h`；`band-loop` 因 `fill:none`
  改加深 stroke）。**JS 只管 tooltip**。不要改回 JS 換色——mouseleave 沒觸發（觸控、游標衝出視窗、拖曳吃事件）
  帶子就永久卡在高亮色（commit `4a752b9` 修過）。
- **路徑高亮（`highlight.js`）同一原則**：JS 只加減 class（容器 `.hl-on`、路徑上的 `.lit`），變淡全在 CSS；
  卡片 mouseleave、容器 `pointerleave`、zoom 的 `onPanStart` 都會 `clear()`。路徑＝從卡片沿 `inEdges` 往上游、
  `outEdges` 往下游走到底（穿過推導邊與歸屬線），外框取成員 pod 聯集。DOM 對回 model 靠 `data-e`／`data-n`。
- zoom **只改 `<g class="zoom-layer">` 的 transform**；listener 只綁一次在容器，每次 `attach()` 只抽換內部狀態 `st`。
  同一 layer 重 attach 沿用縮放；換了圖才 `initial()`＝fit 但**絕不放大超過 1:1**。
  放大上限用「螢幕實際倍率」不是相對 fit。`ctm()` 有兩個 null 防護。
  `createZoom()` 一個實例管一個容器，`dispose()` 必須把 wrap 上五個 pointer/wheel listener 與 window resize 全解掉。
- **tooltip 元素掛在 `document.body`**（`position:fixed`）；`bind()` 綁 `.band, g[data-tip]`，帶子讀
  `bandHtml`、卡片讀 `nodeHtml`；`mount.destroy()` 要把它移掉。
- **專注模式刻意不用 Fullscreen API**（tooltip 在容器外會消失），用 `body.chart-focus` class 純 CSS 實作。
- **顏色是三份定義沒有連動**：`styles/trace-sankey.css` 的 CSS 變數（`--cyan #22d3ee`、`--amber #f59e0b`、
  `--rose #fb7185`、`--gray #94a3b8`、`--orange #c2410c`）、render.js 字串裡的硬編碼十六進位（漸層 defs、
  `STATUS_COLOR`、write 帶 `#c2410c → #7c2d12`）、`app/src/app.css` 的頁面色票（圖例 `.lg-write`／`.lg-status`）。
  改配色要三處一起改。語意：青＝已追查／read、燃橘＝write、琥珀＝其他輸入／warning 框、玫瑰＝其他輸出／回流／critical 框。
- `.trace-sankey .chart svg{display:block;width:100%;height:100%}` 是 fit 計算的隱性前提；
  `.chart svg text{pointer-events:none}`——帶上數字不能擋 hover。別動。
- react.js：callback props 存 ref；`useImperativeHandle` 回傳的是轉呼叫殼；`channels` prop 跟 `minBps` 一樣進 update 的 deps。
- 快捷鍵（app 端）：`+`/`-` 縮放、`0` fit、`1` 1:1、`f` 專注、`Esc` 離開；在輸入框內不攔。

## 9. 開發慣例與驗證

- Commit message 慣例：先寫「為什麼舊做法是錯的」再寫改法（繁體中文）。
- 重構的驗證黃金標準：**既有 samples 的輸出 byte-identical**。工具是 `tools/golden.mjs`：
  改前 `node tools/golden.mjs dump /tmp/a`、改後 dump `/tmp/b`、`diff -r`——它會把所有範例
  （內建 + samples/ + stress/）的 `render()`/`summary()` 輸出各跑 minBps 0 與 5e8 兩組，有通道的範例另跑
  `channels:'read'` 一組。`make check`（= `golden.mjs check`）當迴歸哨兵：每份範例每個變體都要 build ok。
  互動行為用瀏覽器實測（StrictMode 下 body 只留一個 tooltip、同值 update 不洗縮放）。
- 「守恆」的定義：同一台左右兩側**色塊厚度總和**相等（read 帶與 write 帶一起加總）。但每列有最小高度 `ROW_H 24`
  與間距 `ROW_GAP 9`，**兩疊的視覺總高度不會剛好一樣——這是預期行為，不是 bug**（最常被誤報的點）。

## 10. 已知怪癖與陷阱（動手前必讀；均為現況陳述，除非被要求不要修）

1. **`samples/*.json` 與 `packages/trace-sankey/src/samples.js` 是重複維護的同一批資料**：
   samples.js 是套件的 `trace-sankey/samples` 匯出（app 改吃 API 後已不用它），golden／make check
   兩邊都讀。改一邊忘了另一邊不會有任何警告。
   `samples/storage.json` 另外還要跟參考 repo 的 fixture 對得上（來源與 commit 標在 samples.js 註解）。
2. 顯式給了 `other_in_bps` 和 `other_out_bps` 但湊不出平衡式時，圖照顯式值畫、該台不守恆，只警告不擋。
   門檻／通道濾掉的量會**先加進這兩個顯式值再比對**，所以開門檻不會憑空生出這則警告。
3. `type` 是**自由字串**：認得的 hop／群組型別以外一律當葉卡，**不警告**。舊格式 `role` 的註記
   （`core`／`border`…）遷移時必須改成 `switch`，否則會變葉卡、還會因為有往下走的邊而驗證失敗。
4. 多數決平手時依 `nodes` 陣列出現順序決勝；同鍵多條邊的 `attribution`／`extra` 採先到值——結果依賴輸入順序（但確定性）。
5. **ns／app 分組與終點只作用於葉 pod**（`kind:'leaf' && role:'pod'`）：render 的欄內排序讓同 ns 相鄰、槽位跟著
   對端 y 重排；pod 流量自動匯進 app／ns 終點。proxy pod（有往下走的邊）的 ns 只是盒副標、不接終點。
   pod 沒有 ns 是合法的（不接、沒色條、卡片矮一階）。ns 色盤 5 色依首次出現順序取用、超過循環。
6. `colCaption` 用 `col[0].col` 印「第 N 跳」，destination 模式下 anchor 佔 col 0，第一台顯示「第 1 跳」；
   沒有 investigation 的圖第一欄是「第 0 跳」——都是相對欄號、不是輸入裡的跳數。
7. 規模上限：`stress/05-huge.json`（1365 台、5.4 萬個 SVG 元素）滾輪每格約 130ms；要撐這種量需要視野裁剪（未做）。
8. **顯示門檻是「大於」不是「大於等於」**；門檻對 bytes/s 的邊直接比數值、不換算單位（5e8 對 storage 資料會濾光，
   結果是 ok:true 的空畫布）。`pod → app／ns` 推導邊沿用 pod 自己的值、錨邊完全豁免，都不列入「隱藏了幾條帶」。
9. **npm 的 `.npm/_cacache` 曾有 root 擁有的舊檔**（本機環境問題）：`npm install` 若 EACCES，
   用 `npm install --cache <別的目錄>` 繞過，或 `sudo chown -R 501:20 ~/.npm` 永久修。
10. `summary()`（hop 摘要表）照常匯出並被 golden 對拍，但目前 app 沒有使用——刻意保留的 API，不是死碼。
11. **參考 fixture 裡沒有 no-flow 節點**（參考只對指定 root 產生）；要測 no-flow 卡得手做一個只列在 `nodes`、
    沒有任何 flow 邊的 hop。
12. 卡片 `<g>` 的 `data-tip` 是本次新加的：**golden 對拍時要用 `perl -pe 's/<g data-tip="[^"]*">/<g>/g'`
    正規化掉才比得出真正的版面差異**（帶子的 `data-tip` 不要正規化，它必須逐 byte 相同）。
13. client 很多的 port 卡會很高（每台 14px）也會很寬（三欄齊全 364px），目前都**沒有上限**。
    真的遇到幾十台再加一個 `CLIENT_MAX` 常數截，**不要順手改成「一個 client 一張卡」**——
    後端量得到的只有整個 port 的 Δ bps，N 張卡各帶全額會讓 `tracedOut` 變 `N×V`、
    其他輸入被灌水 `(N−1)×V`，而且四種殘差情況裡有三種完全不發警告；攤分則是 `5499b24`
    移除過的推估。量停在 port 是刻意的。**owner 層就是在這個限制下的解法**：
    整張卡同一個 owner 才帶量（重新分組），混合就只畫不帶量的歸屬線——
    別為了「圖比較好看」把歸屬線改成按台數攤分。

## 11. 部署：網頁與 nginx 是分開的兩層

`Dockerfile` 一支三個 stage，兩種交付：`--target content`（busybox + `dist`，3MB，給
compose／k8s 掛載，**主要**）、不帶 target（nginx 全包的自足映像，**次要**；`standalone`
刻意放最後，所以 `docker build .` 的行為與拆分前完全相同）。nginx 一律用**官方映像零客製**，
內容與設定都從外面掛進來。compose 用 named volume + 一次性 `content` service，k8s 用
emptyDir + initContainer——同一套心智模型，本機測到的就是叢集上的行為。

三個踩過的坑，改這塊之前一定要知道：

1. **絕不能靠 Docker 的「空 volume 自動填充」**。Docker 只在 named volume 是空的時候才拿
   映像內容填它，之後永遠不再更新——靠那個行為的話，第二次換網頁會**安靜地繼續端舊內容**。
   所以 `content` service 是明確的一次性任務：先 `rm -rf`（三個 glob 才掃得到 dotfile）
   再 `cp -a`。k8s 的 emptyDir 每個 pod 都是全新的，不需要清，但指令寫一致好維護。
2. **設定掛的是 `deploy/templates/` 整個目錄，不是單一檔案**。Docker 單檔 bind mount 綁的是
   inode，而 `sed -i`／vim／VS Code 存檔都是「寫新檔再改名蓋過去」，inode 一換容器裡那支
   檔案就消失。改回單檔掛載會重現這個 bug。
   （這也剛好和 k8s 把 ConfigMap 掛成整個 templates 的語意一致。）
   反過來 **`/etc/nginx/conf.d/` 現在是 envsubst 的輸出目的地，必須可寫**——compose 用
   `tmpfs`、k8s 用 `emptyDir{medium: Memory}`，不能再掛成唯讀（順便讓渲染出來、帶著明文
   token 的那份 conf 不落到磁碟）。
3. **compose 專案名沿用預設（目錄名 `sankey-panel`）是刻意的**：拆分前建的容器才會被同一個
   `make down` 收掉。改成別的名字會讓舊容器變孤兒、繼續佔著 8080（實測踩過）。
   `docker-compose.dev.yml` 才用不同專案名（`sankey-panel-dev`），兩套各自 up/down。

`deploy/kustomization.yaml` 放在 `deploy/` 而不是 `deploy/k8s/`：kustomize 預設不准讀
kustomization 所在目錄以外的檔案（`../` 會被擋），放上層才能直接讀
`templates/default.conf.template`，
不必加 `--load-restrictor`、也不必把設定複製第二份（本 repo 已經有 §10.1 那個重複維護的坑，
不要再製造第二個）。generator 會在 ConfigMap 名字後加內容 hash，所以改設定自動觸發
rolling restart。

考慮過但**否決**了 `type: image` volume（Docker 28+／Compose 2.35+ 能直接把映像掛成 volume，
不用複製）：k8s 的對應功能 Image Volume Source 要 1.33+ 且要 container runtime 配合，
目標叢集未知不能賭。理由留在 `docker-compose.yml` 檔頭。

API 位置：**已用 nginx `proxy_pass` 解決，不需要執行期 `config.json`**。前端只打同源相對
路徑 `/api/…`，所以沒有任何網址會被 Vite 在 build 時烤進 bundle，同一顆 content 映像跨環境
共用；後端在哪只是 `set $trace_api …` 那一行的事，改完 `docker compose restart web` 即可，
完全不用 build。
`proxy_pass` 一定要寫成「變數 + `resolver`」：固定 hostname 會在 nginx **啟動時**解析，
API 還沒起來就「host not found in upstream」啟動失敗、連靜態頁都端不出來；寫成變數會把 DNS
延到每次請求，API 晚起來最多是 502。k8s 上 `resolver` 要換成 kube-dns 的 ClusterIP。
另外：**API 不要對外 publish port**，只有 nginx 需要連得到它——這個工具沒有使用者層的存取控制。

後端的 auth token：**由 nginx 注入，瀏覽器完全看不到**，前端一行都沒改。整個 conf 走官方映像
自帶的 `20-envsubst-on-templates.sh`（`/etc/nginx/templates/*.template` → `/etc/nginx/conf.d/`），
`proxy_set_header X-API-Key "${TRACE_API_AUTH}";` 的值由環境變數填入。四件必須知道的事：

- **`NGINX_ENVSUBST_FILTER=^TRACE_` 是強制的**，compose／k8s／Dockerfile 三處都設了。
  那支腳本用 `name ~ /$filter/` 挑環境變數，filter 空字串時 `name ~ //` **對每一個都成立**，
  於是 conf 裡的 `$host`／`$uri`／`$request_uri`／`$scheme`／`$trace_api` 全被換成空字串。
  最惡劣的是 `try_files $uri $uri/ /index.html` 變成 `try_files / /index.html`——**仍然是合法
  語法**，nginx 照常啟動然後每個路徑都回 index.html，沒有任何錯誤訊息。寫新的部署設定別漏掉。
  （考慮過「把每個 nginx 變數也設成環境變數」保留它們：可行但更糟，conf 日後新增變數就靜默壞掉。）
- **`TRACE_API_AUTH` 必須「已定義」，空字串可以、未定義不行**。空字串 → `proxy_set_header` 的
  值為空 → nginx 整個不送這個 header，行為與加這功能之前一樣；未定義 → envsubst 不認得它，
  那個 `${…}` 參照原樣留在渲染結果裡，後端收到字面字串然後回 401。compose 用 `${TRACE_API_AUTH:-}`、
  Dockerfile 用 `ENV TRACE_API_AUTH=""`；k8s 刻意用**非 optional** 的 `secretKeyRef`，
  缺 Secret 直接 CreateContainerConfigError，比安靜地 401 好查。Secret 由部署者自己建、不進 repo。
- 值是 **API key 本身**，不帶 `Bearer` 之類的 scheme 前綴。這一行也會清掉 client
  自己帶的 `X-API-Key`，是刻意的。
- **這不是使用者身分驗證**，只是給後端拒絕「沒經過 nginx 的直連」。token 在 `docker inspect`／
  `kubectl describe pod`／容器裡 `nginx -T` 都看得到明文——那是「nginx 要送出這個 header」的
  本質，拿得到 docker socket 或 exec 權限的人本來就拿得到。

`make dev` 不經過 nginx，所以 `app/vite.config.js` 的 dev proxy 自己補同一個 header
（`process.env.TRACE_API_AUTH`，條件展開——寫成 `{ 'X-API-Key': undefined }` 會讓
http-proxy 送出壞 header）。**兩邊要一起改**，否則 dev 與正式環境行為分歧。

驗證：`make up` 後 `curl -sI localhost:8080`；**`docker compose exec web nginx -T` 檢查
`$uri`／`$host`／`$trace_api` 原樣還在**（這條抓的就是 filter 沒設的靜默壞法）；改 template →
`docker compose restart web`（只 `nginx -s reload` **不會**重跑 envsubst）；改 `app/index.html`
→ `make up` **連做兩次**（第二次 volume 非空，才是真正的陷阱測試）。**關掉 API 再
`make down && make up`，nginx 必須照常起來、靜態頁照常能開**——這條就是在測上面那個 `resolver`
的坑。`make up-dev` 是獨立的 compose 檔，最容易漏改，也要走一次。這塊完全不碰 `packages/` 與
`app/src/`，不需要跑 golden。
