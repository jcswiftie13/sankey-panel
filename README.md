# Interface Increment 追查 Sankey

讀入一份規範格式的追查 JSON，畫成守恆的 Sankey。

追一台 switch 的 interface increment 時，一跳可能有多條 uplink，所以下游看到的 out 增加
可以大於你剛追進來的那一條 in（A→B 10G，B→C 20G）。這個工具把那個現象畫出來，
但不會暗示流量是這台 switch 憑空生出來的——多出來的量一律用「其他輸入／其他輸出」補齊，
讓圖在視覺上守恆。

只有一種讀圖方式：**平衡 Sankey**。圖上與 tooltip 的數字一律是**你實際量到的速率增量 Δ**，
沒有任何推估值：bps 本身就是「每秒多少 bit」的速率，increment 是這個速率的差，所以數字帶 `+` 號。
不另外做一張只畫貢獻的圖。

不做的事：不自動偵測 switch／counter、不掃網、沒有帳號與資料庫、
不把追來源畫成整張圖左右鏡射。

## 快速開始

兩個部分：`packages/trace-sankey`（畫圖的 npm 套件，零依賴純 ESM）與 `app/`
（Vite + React 使用端，只有圖和顯示門檻）。CLI 另外只需要 `python3`。

```bash
git clone <repo> && cd sankey-panel

npm install                   # 第一次；裝 app 的 react/vite（套件本身零依賴）
make dev                      # 起 dev server（= npm run dev --workspace app）
make draw FILE=my-trace.json  # 不開瀏覽器，CLI 文字報告
make up                       # 產品用：起 nginx + 內容 volume（見「用 nginx 部署」）
make help                     # 所有 target
```

app 開場顯示套件內建範例；按「開啟 JSON…」或把 `.json` 拖進頁面就換成你的追查
（純瀏覽器本機讀，不上傳；存 localStorage，重新整理還在，「還原範例」清掉）。
壞檔（語法錯誤／不合契約）只出錯誤橫幅，不會毀掉正在看的圖。
資料來源整個關在 `app/src/useTraceDoc.js`——未來前後端分離改從 API 取 JSON 時，
只改這個檔（替換法寫在檔頭註解）。

### 用 nginx 部署

要對外給人看（或給 Electron 載）時不要用 dev server。**網頁內容與 nginx 是分開的兩層**，
可以各自替換：

```
                       ┌─ trace-sankey-content  (busybox + dist，3MB)
build 階段（node:22）──┤        │ 開機倒進共享 volume
  npm ci + vite build  │        ▼
                       │  [volume] ──► nginx:1.27-alpine（官方映像，零客製）
                       │                    ▲
                       └─ trace-sankey      │ 掛 deploy/conf.d/
                          （自足映像，次要）
```

```bash
make up            # 分離式：建 content 映像 + 起官方 nginx，開 http://localhost:8080
make down          # 停掉並移除（兩種跑法都關）
make up-dev        # nginx 直接讀主機的 app/dist（要先 make build），改檔即生效
make build         # 只跑 vite build 產出 app/dist（不碰 Docker）
make docker-build  # 自足映像：一個 image 全包，適合交付給不想管 compose 的人
```

三件事各自怎麼換：

| 要改什麼 | 怎麼做 | 要重建嗎 |
|---|---|---|
| nginx 設定 | 改 `deploy/conf.d/default.conf` → `docker compose exec web nginx -s reload` | 完全不用 |
| 網頁內容 | `make up`（只重建 3MB 的 content 映像，nginx 容器不重啟） | 只重建 content |
| nginx 版本 | 改 `docker-compose.yml` 的 `nginx:1.27-alpine` tag | 不用 |
| 對外 port | `make up PORT=9000` | 不用 |

- nginx 設定在 `deploy/conf.d/default.conf`：`try_files $uri $uri/ /index.html` 的 SPA
  fallback、`index.html` 不快取、`/assets/`（Vite 的 content hash 檔名）永久快取、gzip。
  **掛的是整個 `conf.d/` 目錄不是單一檔案**——Docker 的單檔 bind mount 綁 inode，
  而 vim／VS Code／`sed -i` 存檔都是換掉 inode，容器裡那支檔案會直接消失。
- 對外 port 只有 `PORT` 一個來源（`Makefile` 傳給 compose），不必兩邊手動同步。
- 服務在根路徑 `/`。要掛子路徑得在 `app/vite.config.js` 加 `base`，並同步改 nginx 的
  `location` 與 `try_files` 目標。
- **純靜態、沒有後端**：拖放與「開啟 JSON…」都是瀏覽器本機讀檔（`file.text()`），
  檔案不會經過 nginx，行為與 dev server 完全一樣。
- 之後 `useTraceDoc.js` 改吃 API 時要注意：Vite 會在 **build 時**把 URL 烤進 bundle，
  同一個 content 映像要跨環境共用的話得另外做一個執行期讀的 `config.json`（尚未做）。

#### 上 Kubernetes

同一套心智模型：initContainer 把 content 映像倒進 emptyDir，nginx 唯讀掛來端，
設定走 ConfigMap。

```bash
kubectl apply -k deploy      # kustomization.yaml 在 deploy/，不是 deploy/k8s/
kubectl kustomize deploy     # 只看 render 結果
```

ConfigMap 由 `configMapGenerator` **直接讀 `deploy/conf.d/default.conf`**，設定不會有第二份
拷貝；generator 會在名字後面加內容 hash，所以改設定就自動觸發 rolling restart。
換網頁改 `deploy/kustomization.yaml` 的 `images:` tag。Ingress／TLS 留給部署端自己加。

#### Electron BrowserView 端

若用 Electron 的 BrowserView（或 WebContentsView）指向這個服務
（`loadURL('http://localhost:8080')`），**最低限度要擋掉預設的拖放導航**，
否則拖 `.json` 進去會整頁跳到 `file://…`：

```js
contents.on('will-navigate', (e, url) => {
  if (new URL(url).origin !== 'http://localhost:8080') e.preventDefault();
});
contents.setWindowOpenHandler(() => ({ action: 'deny' }));
```

`electron/` 底下有一支可跑的測試殼（`make electron`），既是參考實作，
也能用環境變數重現各種「host 設錯」的情況。
**host 端的設定不是你能控制的**，你這一側該怎麼防守看
[被 Electron 鑲嵌時](#被-electron-鑲嵌時host-端不受你控制)。

### 當套件用

```js
// React：
import { TraceSankey } from 'trace-sankey/react';
import 'trace-sankey/style.css';
<TraceSankey doc={traceJson} minBps={0} className="my-chart" />
// 容器高度由你的 CSS 決定（元件不設高度）

// 不用 React（vanilla）：
import { mount } from 'trace-sankey';
const inst = mount(document.getElementById('chart'), traceJson, { minBps: 0 });
inst.setMinBps(5e8); inst.zoom.fit(); inst.destroy();

// 只要 SVG 字串（Node 也能跑，沒有 DOM 依賴）：
import { build, render } from 'trace-sankey';
const model = build(traceJson, { minBps: 0 });
if (model.ok) fs.writeFileSync('out.svg', render(model));
```

對外契約（自己接互動時可依賴）：render 產出的 `<g class="zoom-layer">` 是縮放的掛點；
每條 `.band` 上的 `data-tip` 屬性是一份 JSON（from/to/iface/bps/…），tooltip 的資料
都從這來。SVG 的文字顏色與字級在 `trace-sankey/style.css`，不載入會沒有正確外觀。

### 顯示門檻

控制列的「顯示門檻」填一個整數（單位 bps，旁邊即時翻成 Gbps／Mbps／kbps），
圖上就只留速率增量**大於**這個值的帶子。追一條 10G 的主幹時，這是把幾 Mbps
的雜訊帶清掉的開關。

- 濾掉的量**不會消失**，會併進該台的其他輸入／其他輸出，所以
  「已知 in ＋ 其他輸入 ＝ 已追查 out ＋ 其他輸出」照樣成立。
- 一台 switch 濾完身上一條帶都不剩，就**整台不顯示**。
- 追查起點那條**永遠保留**——濾掉它整張圖就沒有錨了。
- 殘差色塊本身不受門檻管，照舊只看該台的讀數誤差門檻。
- 門檻輸入旁會顯示隱藏了幾條帶、幾台、總共多少量（model 的 `filtered`／
  `filteredNodes`，warnings 裡也有同一句）。
- 這是**顯示**用的門檻，跟 JSON 裡的 `pruning.topN` / `pruning.minShare`
  是兩件事：那兩個是宣告「上游已經截斷過」的 metadata，程式不拿它們過濾。
- CLI（`tools/trace_sankey.py`）沒有對應的旗標，只有網頁版有
  （`build(doc, { minBps })` 的第二個參數）。

## 被 Electron 鑲嵌時（host 端不受你控制）

這個網頁的消費端是**別人的 Electron**：畫面被塞進一個 `BrowserView` 裡，指向前面那台 nginx。
關鍵前提是 **host 那一側的設定不是你能改的**——你能控制的只有三樣東西：`app/` 的網頁、
`deploy/conf.d/default.conf` 的 nginx，以及未來的後端 API。

這一章逐項列出：**host 的哪個設定會影響你 → 你在自己這一側能怎麼因應**。
每一節都可以用 `electron/` 底下的測試殼現場重現（開關表見 [electron/README.md](electron/README.md)）。

### 先講兩個橫向結論

**一、`BrowserView` 與 `WebContentsView` 對你這邊完全等價。**
兩者都是**獨立的 top-level WebContents**——發一樣的 HTTP 請求、同一個 origin、
一樣有完整的 localStorage，而且**都不是 frame**（所以 `X-Frame-Options: DENY` 擋不到它們）。
差別只在 host 端的寫法與版本要求：`WebContentsView` 需要 Electron 30 以上，
`BrowserView` 自 30 起被標記 deprecated（且內部已經是前者的相容包裝）。
**host 選哪一個，你的網頁與 nginx 都不用改一行**，可以用
`VIEW_API=webcontentsview` 自己驗一次。

**二、真正會影響你的是 host 的「行為設定」**，不是 view 的類別——
而那些正好都是你管不到的。以下就是防守清單。

### 1. 拖一個 `.json` 進去，整頁跳成 `file://…`

**host 端的原因**：沒有設 `will-navigate` 白名單。正確的 host 應該要有：

```js
contents.on('will-navigate', (e, url) => {
  if (new URL(url).origin !== 'http://localhost:8080') e.preventDefault();
});
contents.setWindowOpenHandler(() => ({ action: 'deny' }));
```

**你這邊的因應（網頁，已實作）**：`app/src/App.jsx` 的拖放 effect **無條件先呼叫
`preventDefault()`**，再用 `hasFiles()` 決定要不要真的處理，而且掛在 document 的
**capture 階段**。原因：`dragover` 沒被取消的話，Chromium 根本不會把 `drop` 事件送進頁面，
而是直接導航到那個檔案。舊寫法是「先問 `hasFiles()` 再攔」，遇到不給
`dataTransfer.types` 的拖放來源就整個沒攔到——那就是縫。

代價是拖文字進「顯示門檻」輸入框的原生行為會失效，可接受。
**nginx 端無能為力**：這是 renderer 的行為，不經過 HTTP。

> 重現：`GUARD=off npm start`。

### 2. host 改用 `<iframe>` / `<webview>` 嵌 → 一片空白

**原因**：`deploy/conf.d/default.conf` 的 `X-Frame-Options: DENY`。
BrowserView／WebContentsView 不受影響（它們不是 frame），真的被 `<iframe>` 嵌才會被擋。

**nginx 端的因應**：改用 CSP 的 `frame-ancestors` 白名單對方的 origin：

```nginx
# 只有在確定 host 用 iframe 嵌時才開
add_header Content-Security-Policy "frame-ancestors 'self' <host 的 origin>" always;
```

⚠️ **`add_header` 不繼承**：`server` 層、`= /index.html`、`/assets/` **三個地方都要改**，
漏一個就會出現「首頁能嵌、重整後資源被擋」這種難查的半殘狀態。
另外 Electron 的 host 頁常常是 `file://` 或自訂 scheme，`frame-ancestors` 對這兩種的
支援看 Chromium 版本；若怎麼設都擋著，最後手段是整組移除 `X-Frame-Options`
（並在設定檔註明這是刻意放寬的）。

**預設維持 `DENY`**——不要為了還沒發生的需求先把防護拆掉。

> 重現：`EMBED=iframe npm start`。

### 3. 使用者一直拿到舊版的 bundle

**host 端的原因**：BrowserView 沒有網址列、沒有 `Ctrl+F5`，使用者**無法自己強制重整**，
host 也不一定給了重載的按鈕或快捷鍵。

**nginx 端就是唯一防線，而且現況已經正確——不要動它**：
`= /index.html` 送 `Cache-Control: no-cache, must-revalidate`，
`/assets/` 的檔名帶 content hash 所以可以 `immutable`。
改了網頁只要 `make up` 換掉內容，使用者下次開 app 就會拿到新的。

可補的保險：在網頁裡自己放一顆「重新載入」按鈕（`location.reload()`），
不依賴 host 有沒有給快捷鍵。

### 4. 存過的自訂 JSON 不見了

`localStorage`（鍵 `trace-sankey/custom`）綁在 **origin** 上，三種 host 設定都會弄丟它：

- host 用了非持久 session（`partition` 名稱不以 `persist:` 開頭），關掉 app 就全清空；
- host 換了 URL 的 port **或 hostname 寫法**——`http://localhost:8080` 與
  `http://127.0.0.1:8080` 是**兩個不同的 origin**，儲存空間完全不共用；
- host 用 `file://` 載（opaque origin，連能不能存都不保證）。

**網頁端**：`app/src/useTraceDoc.js` 已經把所有 `localStorage` 存取包在 try/catch，
被擋只會退回內建範例、不會壞掉；但「存得進去、下次讀不到」擋不了。

**nginx 端可做（預設不開）**：強制單一 canonical origin，避免 host 隨手換寫法就換掉整個儲存空間：

```nginx
# 代價：該機器若解不到 localhost 就會壞，只在確定環境開
if ($host = "127.0.0.1") { return 301 http://localhost:$server_port$request_uri; }
```

**根本解**：等資料改成從 API 取（見 §7），續存就不再綁 origin。

> 重現：`SESSION=temp npm start`、或 `SANKEY_URL=http://127.0.0.1:8080 npm start`。

### 5. host 注入 CSP → 圖畫不出來

有些 host 會用 `session.webRequest.onHeadersReceived` 硬加一份 CSP。
這份網頁的**實際需求**是：

- **`style-src` 必須含 `'unsafe-inline'`**：`render.js` 產出的 SVG 文字用
  `style="fill:…"` 屬性上色（ns 顏色、金額標籤的描邊），`tooltip.js` 也直接寫
  `.style.left/.top` 定位。少了它 → 文字顏色跑掉、tooltip 黏在畫面左上角。
- **不能開 Trusted Types**：`mount.js` 是 `chart.innerHTML = render(m)`。
  一旦 CSP 有 `require-trusted-types-for 'script'`，這行直接 throw、**整張圖不見**。

**nginx 端該做的：自己先送一份 CSP。** Chromium 對多份 CSP 是「每一份都要通過」（取交集），
所以你送的不會蓋掉 host 那份，但能對「host 沒送」的情況直接生效，也等於把需求寫成契約：

```nginx
# 三處 add_header 都要加。connect-src 'self' 的前提是 API 走同源 proxy（見 §7）
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'" always;
```

若 host 真的開了 Trusted Types，唯一的解是**改套件不要用 `innerHTML`**
（改成 `DOMParser` 逐節點 append，或註冊一個 trusted policy）——那是套件層的改動，目前沒做。

> 重現：`CSP=strict npm start`、`CSP=trusted-types npm start`。

### 6. 視窗尺寸由 host 決定（已經處理好，不用重做）

host 會用 `setBounds()` 指定 view 的像素大小，也可能一開始給 0×0。
`zoom.js` 已經綁了 `window.resize → refresh`，`setBounds` 會讓頁面收到 `resize`；
`ctm()` 對 `display:none` 與寬高 0 也有防護。列在這裡是為了讓人知道**這項已經處理過**。

### 7. 未來改成打 API 取資料之後

先講結論：**view 的類別依然無關；但 API 化會新增一批 host 相關的坑，而它們有同一個解——
讓 nginx `proxy_pass /api/` 到後端，網頁只打相對路徑 `/api/...`。**
一招解掉四件事：

| 坑 | 網頁直接打後端 origin | 走 nginx 同源 proxy |
|---|---|---|
| CORS | 後端要送 `Access-Control-Allow-Origin`，而且 **host 一改 port 就得改白名單** | 同源，**完全沒有 CORS**、沒有 preflight |
| CSP `connect-src` | 要把後端 origin 寫進去；host 若注入 `connect-src 'self'` 就直接死 | `'self'` 就夠 |
| build 時烤死 URL | Vite 在 **build 時**把 `VITE_API_URL` 烤進 bundle，同一個 content 映像不能跨環境 → 得另做執行期 `config.json` | 相對路徑，**沒有東西要設定** |
| cookie / 認證 | 跨站 cookie 要 `SameSite=None; Secure`，純 http 的 localhost 很難搞 | 同源 cookie，正常運作 |

其他要記住的：

- **不要靠 host 的 `webSecurity: false`**。那會讓 CORS 靜默失效——在對方的 Electron 跑得好好的，
  換一台、換個瀏覽器就爛，而且問題在你這邊爆。
- **session 是非持久的話，登入 cookie 每次開 app 都會掉**（同 §4）。要做認證就別假設
  cookie 活得過重開。
- **`file://` 載入時相對路徑的 `/api/` 完全失效**，`Origin` 還會是 `null`——
  這是必須要求 host 用 http origin 的第二個理由（第一個是 localStorage）。
- **API 失敗要有網頁自己的錯誤 UI**，不要依賴 host 有沒有處理 `did-fail-load`；
  沿用現有的 `error-banner`（載入失敗只出橫幅、不動正在顯示的圖）。
- 想給 host 或 k8s probe 探活的話（預設沒開）：

  ```nginx
  location = /healthz { access_log off; return 200 "ok\n"; }
  ```

### 8. 已確認**沒有**影響的項目（省得下次重查）

- **`setWindowOpenHandler(() => ({ action: 'deny' }))`**：網頁裡沒有任何 `window.open`
  或 `target="_blank"`，被 deny 也不痛。**要維持的紀律：不要加**。
- **`nodeIntegration: true` 的老派 host**：會把 `require`／`module` 注入頁面全域，
  UMD 形式的第三方庫會誤判環境而壞掉。這個網頁是 `<script type="module">` 的 ESM、
  而且 `trace-sankey` 零第三方依賴，不受影響。**要維持的紀律：不要引入 UMD 版的函式庫。**
- **Vite 的 `base`**：預設 `'/'`，產出 `/assets/…` 絕對路徑。若哪天 host 堅持用 `file://`
  直接載檔案，要改成 `base: './'`；但相對路徑會和 nginx 的 `try_files … /index.html`
  ＋未來的前端路由互斥（子路徑下會解錯），所以**只當備案、預設不改**。

## 看圖：縮放與平移

switch 與 interface 一多，圖就會遠大於畫面。圖區是一塊固定尺寸的畫布，
內容在裡面縮放平移，不再靠捲軸：

| 操作 | 動作 |
| --- | --- |
| 滾輪／觸控板雙指 | 以游標為中心縮放（不會捲到頁面） |
| 按住拖曳 | 平移 |
| `＋` `−` | 放大／縮小一格 |
| `0` | 符合視窗（整張圖塞進畫布） |
| `1` | 1:1 原始大小 |
| `F` | 專注模式：收起頁首與控制列，圖填滿整個視窗；`Esc` 離開 |

右下角的工具列有同樣的按鈕，中間顯示目前倍率（`100%`＝原始大小，點一下回到 1:1）。

開場是「符合視窗，但不放大超過原始大小」——小圖維持原尺寸，大圖才縮到看得見全貌。
換一份資料或改門檻會重新回到這個開場視角；同一份資料與門檻下的重畫則會保留你的縮放。

## 輸入 JSON 規格

單位一律是 **bps**（10 Gbps 寫成 `10000000000`）。網頁與 CLI 吃同一份契約。

### 頂層

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `investigation` | object | ✔ | 你看到增加的那個 counter |
| `hops` | array | ✔ | 非空。每一跳一筆；同一台 switch 可以出現多次 |
| `kind` | `"destination"` \| `"source"` | | 追查方向。沒給就看 `investigation.direction`，再沒給就當 `destination` |
| `pruning` | object | | 只是註記你當初怎麼截斷的，會顯示在圖上方；工具本身不會幫你截斷 |

### `investigation`

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `switchId` | string | ✔ | 必須在 `hops` 裡找得到同一個 `switchId` |
| `iface` | string | ✔ | 你看到增加的那條 interface |
| `deltaBps` | number > 0 | ✔ | 速率增量 Δ，bps |
| `direction` | `"in"` \| `"out"` | | `in` = 追終點，`out` = 追來源。`kind` 優先 |
| `note` | string | | 一句話備註，顯示在 CLI 報告 |

### `pruning`

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `topN` | number | 你每層只跟了前幾名 |
| `minShare` | number 0–1 | 你每層的佔比門檻，`0.1` = 10% |

### `hops[]`

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `switchId` | string | ✔ | 合併鍵。同一個 id 出現多次會**合併成一個盒子**，不畫成兩台 |
| `label` | string | | 顯示名稱，沒給就用 `switchId` |
| `role` | string（非空） | | 自由字串。繪製只認 `node`（天藍虛線盒，k8s node）與 `pod`（pod 當中繼 hop 時用），**其他值一律畫成一般 switch 盒**（範例拿 `core`／`border` 等當註記）。預設 `switch` |
| `namespace` | string（非空） | `role:"pod"` ✔ | `role: "pod"` 的中繼 hop **必填**（pod 一定屬於某個 ns），顯示在盒副標與匯出 |
| `tier` | string（非空） | | 同層標籤。同 `tier` 的 hop **鎖在同一欄**，彼此之間的邊畫成右側弧帶；字串內容自訂，程式只比對相同與否。見下方「同層互連（tier）」 |
| `outputs` | array of port | 追終點 | 跟下去的出口 |
| `inputs` | array of port | 追來源 | 往回追的入口 |
| `otherInBps` | number ≥ 0 | | 顯式的其他輸入。不給就由平衡式補 |
| `otherOutBps` | number ≥ 0 | | 顯式的其他輸出。不給就由平衡式補 |

### port（`outputs[]` / `inputs[]` 的元素）

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `iface` | string | switch hop ✔ | 本機這一側的 interface。`role: "node"` / `"pod"` 的 hop **可省略**（k8s 內部沒有 switch interface；有 veth／bond 名想記的照填），**省略時必須給 `peerSwitchId` 或 `peerId`**。沒填的 port 槽位不印 iface 字樣 |
| `deltaBps` | number ≥ 0 | ✔ | 這條的速率增量 Δ，bps |
| `peerSwitchId` | string | | 對端 switch／node 的 id |
| `peerId` | string | | 對端不是 switch 時用（host / router / pod） |
| `peerIface` | string | | 對端那一側的 interface。對端 iface 只由這裡決定，沒填就留空、不猜 |
| `peerKind` | string（非空） | | 自由字串註記；**唯一有語意的值是 `pod`**（畫成 pod 中繼卡、流量匯進 ns 終點），其他值畫一般灰葉 |
| `namespace` | string（非空） | `peerKind:"pod"` ✔ | `peerKind: "pod"` 且對端不在 `hops`（即將畫成 pod 卡）時**必填**——pod 流量自動匯進這個 ns 的終點節點。其他葉有給就顯示 `ns/<namespace>`。同 ns 的 pod **在同一欄相鄰排列、左緣掛同色 ns 色條**（色盤依首次出現順序取色、超過 5 個循環）。標在「對端已接進 hops」的 port 上不會標在盒上（會警告），請改標在該 hop |

對端接不接下去，看的是 `peerSwitchId`（沒有就看 `peerId`）**在 `hops` 裡有沒有同 id 的那一跳**：
有就接成下一台，沒有就畫成灰色「追查終止」小卡。

### 追終點（destination）

```json
{
  "kind": "destination",
  "investigation": {
    "switchId": "sw-edge-a", "iface": "xe-0/0/1",
    "direction": "in", "deltaBps": 10000000000
  },
  "pruning": { "topN": 3, "minShare": 0.1 },
  "hops": [
    {
      "switchId": "sw-edge-a", "label": "Edge A", "role": "switch",
      "outputs": [
        { "iface": "et-0/0/48", "deltaBps": 20000000000,
          "peerKind": "switch", "peerSwitchId": "sw-core-1", "peerIface": "et-1/0/1" }
      ]
    },
    {
      "switchId": "sw-core-1", "label": "Core 1", "role": "switch",
      "outputs": [
        { "iface": "et-1/0/9", "deltaBps": 20000000000,
          "peerKind": "host", "peerId": "srv-db-07", "peerIface": "eno1" }
      ]
    }
  ]
}
```

Edge A 只追進來 10G 卻出去 20G，缺的 10G 會自動變成 Edge A 的「其他輸入」。

### 追來源（source）

```json
{
  "kind": "source",
  "investigation": {
    "switchId": "sw-core-1", "iface": "et-1/0/9",
    "direction": "out", "deltaBps": 20000000000
  },
  "hops": [
    {
      "switchId": "sw-core-1", "label": "Core 1",
      "inputs": [
        { "iface": "et-1/0/1", "deltaBps": 12000000000,
          "peerKind": "switch", "peerSwitchId": "sw-edge-a", "peerIface": "et-0/0/48" }
      ]
    },
    {
      "switchId": "sw-edge-a", "label": "Edge A",
      "otherInBps": 2000000000,
      "inputs": [
        { "iface": "xe-0/0/1", "deltaBps": 7000000000,
          "peerKind": "host", "peerId": "lab-gpu-01", "peerIface": "eno1" }
      ]
    }
  ]
}
```

### k8s（node / pod / namespace）

edge switch 接的是 k8s node 時，同一條 Sankey 直接接下去（完整版在 `samples/k8s.json`）：

```jsonc
{
  "kind": "destination",
  "investigation": { "switchId": "sw-tor-k8s", "iface": "et-0/0/48", "direction": "in", "deltaBps": 30000000000 },
  "hops": [
    { "switchId": "sw-tor-k8s", "label": "ToR k8s", "role": "switch",
      "outputs": [
        { "iface": "xe-0/0/11", "deltaBps": 14000000000, "peerKind": "node", "peerSwitchId": "node-w-11", "peerIface": "bond0" },
        { "iface": "xe-0/0/12", "deltaBps": 8000000000,  "peerKind": "node", "peerSwitchId": "node-w-12", "peerIface": "bond0" },
        { "iface": "xe-0/0/13", "deltaBps": 5000000000,  "peerKind": "node", "peerSwitchId": "node-w-13", "peerIface": "bond0" },
        { "iface": "xe-0/0/20", "deltaBps": 3000000000,  "peerKind": "host", "peerId": "srv-log-01", "peerIface": "eno1" }
      ] },
    { "switchId": "node-w-11", "role": "node", "otherOutBps": 2500000000,
      "outputs": [
        { "iface": "veth3a1f", "deltaBps": 8000000000, "peerKind": "pod", "peerId": "ingest-7d9c", "namespace": "telemetry" },
        { "iface": "veth9b02", "deltaBps": 3500000000, "peerKind": "pod", "peerId": "kafka-2", "namespace": "stream" }
      ] },
    { "switchId": "node-w-12", "role": "node",
      "outputs": [
        { "deltaBps": 5500000000, "peerKind": "pod", "peerId": "ingest-4f11", "namespace": "telemetry" },
        { "deltaBps": 2500000000, "peerKind": "pod", "peerId": "debug-shell", "namespace": "debug" }
      ] },
    { "switchId": "node-w-13", "role": "node" }
  ]
}
```

五個情境一次示範：`node-w-11` 是標準 switch → node → pod → ns（veth 名照填）；`node-w-12`
的 port **省略 iface**（k8s 內部沒有 switch interface，靠 `peerId` 認 port）；`node-w-13`
是 **node 當葉**（沒列 pod，進來的 5G 由平衡式補成其他輸出）；`srv-log-01` 是混在其中的
非 k8s host 葉；`telemetry` 的兩個 pod 掛在不同 node 上，圖上**相鄰排列、共用同色 ns 色條**，
而且**自動匯進同一個 telemetry 終點節點**（13.5G 直接在圖上讀）。追來源方向見
`samples/k8s-source.json`（ns 終點在最左欄，`batch` 兩個 pod 跨 node 匯流）。

`samples/` 底下是網頁上那些範例的 JSON，可以直接拿來改。

### 驗證錯誤對照

載入失敗時會直接印出這些訊息，照著改欄位就好：

| 訊息 | 意思 |
| --- | --- |
| 最外層必須是 JSON 物件。 | 檔案最外面是陣列或字串 |
| 缺少 investigation。 | 沒有 `investigation` 這個 key |
| investigation.switchId 必填。 | 沒給、或給了空字串 |
| investigation.iface 必填。 | 同上 |
| investigation.deltaBps 必須是正數（bps）。 | 不是數字、是 0、或是負數；別寫成 `"10G"` |
| investigation.direction 只能是 "in" 或 "out"。 | 拼錯，例如寫成 `"input"` |
| kind 只能是 "destination" 或 "source"。 | 拼錯 |
| hops 必須是非空陣列。 | `hops` 不是陣列，或是空的 `[]` |
| hops[i] 不是物件。 | 陣列裡混了字串或數字 |
| hops[i].switchId 必填。 | 那一跳沒給 id，就沒得合併 |
| hops[i].tier 必須是非空字串。 | `tier` 給了數字、空字串或其他型別 |
| hops[i].role 必須是非空字串。 | `role` 給了數字、空字串或其他型別（`namespace` 同款訊息） |
| hops[i].outputs 必須是陣列。 | 給了單一物件，忘了包 `[]` |
| hops[i].outputs[j] 不是物件。 | port 陣列裡混了別的東西 |
| hops[i].outputs[j].iface 必填。 | 一般 switch hop 的 port 沒給 interface 名 |
| hops[i].outputs[j] 省略 iface 時必須給 peerSwitchId 或 peerId。 | `role: "node"/"pod"` 的 port 才能省 iface，但沒 iface 又沒對端 id 就沒得認 port |
| hops[i].outputs[j].deltaBps 必須是非負數。 | port 的量不是數字或是負數 |
| hops[i].outputs[j].peerKind 必須是非空字串。 | `peerKind` 給了數字或空字串（`namespace` 同款訊息） |
| hops[i].outputs[j] 的 peerKind 為 "pod" 時 namespace 必填（pod 一定屬於某個 namespace）。 | 即將畫成 pod 卡的 port 沒給 `namespace`；pod 流量要匯進 ns 終點節點。對端接進 `hops` 的 proxy pod 不受此限 |
| hops[i] 的 role 為 "pod" 時 namespace 必填。 | `role: "pod"` 的中繼 hop 沒給 `namespace` |
| hops[i].otherInBps 必須是非負數（bps）。 | 給了負數或非數字；負殘差會讓色塊算出負高度、SVG 破圖 |
| hops[i].otherOutBps 必須是非負數（bps）。 | 同上 |
| investigation.switchId「X」在 hops 裡找不到。 | 起點那台沒有出現在 `hops`，通常是 id 打錯或大小寫不一致 |

（`inputs` 的訊息一樣，只是把 `outputs` 換成 `inputs`。）

另外有幾種**警告**，不會擋著不畫，會列在圖下方：

- `otherInBps／otherOutBps 兩個都給了但湊不出平衡式` — 圖照你給的顯式值畫，那台的左右兩疊
  色塊厚度就不會相等。訊息會把兩邊算式攤開、指出哪邊多多少；拿掉其中一個讓平衡式自動補就會守恆
- `拓樸疑似有環` — hops 兜出了環，欄位順序會不準
- `同一台在不同 hop 給了不同 tier` — 同 `switchId` 的 hop 標了兩種 tier，採用先出現的
- `逆著多數流量方向` — 兩群之間雙向都有流量，總量小的方向畫成回流帶、不參與排欄
- `群組間仍繞成環` — 環繞過三群以上，移除環上流量最小的那個方向破環
- `在不同 hop 給了不同 peerKind／namespace` — 同一個 port 拆在多個 hop 寫、標註衝突，採先出現的值
- `標了 namespace，但對端已是 hop` — port 上的 ns 只會出現在帶的 tooltip、不會標在盒上；請改標在該 hop 的 `namespace` 欄位

### 同層互連（tier）

欄位預設照最長路徑排：每條邊都逼下游至少右一欄。同一層彼此互連時（例如 bdr↔dci 跨 DC），
互連下游的機器會被推到右邊一欄，同一層被拆成兩欄。把同層的 hop 都標同一個 `tier` 就能鎖回同欄：

- 同 `tier` 的機器整群視為一個節點跑最長路徑，欄位順序仍由拓樸自動推，**不用宣告層級編號**；tier 內部的邊不參與排欄。沒標 `tier` 的 hop 行為完全不變。
- tier 內部的邊畫成**欄右側的弧帶**（往右凸再折回），厚度與青帶共用同一把比例尺，守恆照常經過。
  它不是另一種狀態，就是一條已追查的帶，只是兩端排在同一欄才改畫成馬蹄形；馬蹄形讀不出方向，
  所以弧的終點端有個**箭頭指流向**。
- 範例見 `samples/dci-tier.json`（網頁上的「同層互連（tier）」）。

## 追查方向

封包方向永遠左到右。不做兩套座標、不左右翻圖。差別只在追查起點釘在哪一側。

| 模式 | 你看的 counter | 下一跳 | 起點位置 | JSON |
| --- | --- | --- | --- | --- |
| 追終點 | 某條 in 增加 | 貢獻大的 out | 最左 | `kind:"destination"` 或 `investigation.direction:"in"` |
| 追來源 | 某條 out 增加 | 貢獻大的 in | 最右 | `kind:"source"` 或 `investigation.direction:"out"` |

追終點 hop 填 `outputs`；追來源 hop 填 `inputs`。
同一台 switch 在 `hops` 出現多次（雙 uplink 匯入核心）會合併成一個盒子，不會畫成兩台。

## 守恆與殘差

每層只跟前 N 名或佔比 ≥ 門檻（例如前 3 名 / ≥ 10%）時：

- **其他輸出**（玫瑰）：這層 focus 增加量裡，沒跟下去的 port（截斷、太小、已滿 N 名）
- **其他輸入**（琥珀）：跟下去的出口／入口總量比剛追進來那條更大（別的上聯、沒追的來源）

同一層可以兩種都有。平衡式：

```
已知 in + 其他輸入 = 已追查 out + 其他輸出
```

`otherInBps` / `otherOutBps` **不給就由平衡式自動補缺口**，所以最少只要填實際跟到的 port 就會守恆。
兩個都給又對不上，圖照顯式值畫並在摘要下方出警告。

## 畫法（目前生效的定案）

- 青色長帶＝有跟下去的 uplink／追查路徑，帶寬用**速率增量 Δ**，數字帶 `+` 號。
- 殘差不進走廊：不畫成穿越別台的長色帶，也不做盒子內底部 chips。
- 殘差貼在該台外側的虛線色塊：其他輸入在左、其他輸出在右；**高度跟 Gbps 等比，
  跟青帶共用同一把比例尺**（`maxVal` 也把殘差算進去），標籤與數量寫在色塊旁。
  這樣「有追查」跟「沒追查」的比例一眼看得出來。
- 殘差是盒子左右 port 疊裡的**真槽位**，跟已追查 port 一起排版。同一台左右兩側的
  **色塊厚度總和完全相等**（守恆等式保證）；但每一列有 24px 最小高度、列間 9px 間距，
  所以**兩疊的總高度不會剛好一樣**——守恆看色塊厚度，不是看疊起來的總高度。
- 小於該台自己讀數誤差（`max(已知 in, 已追查 out) × 0.5% + 1 bps`）的殘差不畫，
  免得浮點雜訊在圖上長出一塊。圖、hop 摘要、Mermaid 用同一個門檻。
- 盒子裡只畫已追查 port，殘差不用斜線填滿整台 switch。
- 追查終止葉節點是灰色虛線小卡（「追查終止」「未再往下追」＋ iface ＋ 帶寬），不是又一台 switch。
- k8s 接在同一條 Sankey 上：switch → node（天藍虛線盒）→ pod（天藍虛線中繼卡，標 name 與
  `ns/<namespace>`）→ namespace（ns 色終點卡）。不是每個 switch iface 都接 node；node 可以
  當葉（不列 `outputs` 就整台由平衡式補成其他輸出）；pod 一定屬於某個 namespace（驗證強制）。
  node 用同一套截斷，沒跟的 pod 併成該 node 的其他輸出。
- **namespace 是自動推導的終點節點**：每個 pod 卡自動再接一條邊匯進所屬 ns 的終點卡，
  pod → ns 這條邊的值就是 pod 自己的量測 Δ——**同一筆數字的重新分組，不是推估**。
  **全圖同 ns 合一個節點**（跨 node 的 pod 匯流），「這個 ns 總共多少」直接在圖上讀；
  追來源模式鏡像，ns 終點落在最左欄。列進 `hops` 的中繼 pod（proxy pod）**不接** ns——
  它的流量已流向自己的下游，再接會重複計量破壞守恆，它的 ns 只是盒副標。
  同 ns 的 pod 在欄內**相鄰排列**、左緣掛同色 ns 色條（色盤 5 色依首次出現順序取用、
  超過循環）；pod 落在不同深度時各 ns 各自落欄，是預期行為。彙總數字在 `summary()`
  的「namespace 流量小計」表（CLI 文字報告也有；目前 app 沒有顯示這張表）。
- 整欄都是 k8s node 時欄標題標「第 N 跳 · k8s node」；整欄都是 pod 卡標「第 N 跳 · pod」；
  整欄都是 ns 終點標「追查終止 · namespace」。
- hop 數字摘要是圖外資訊（`summary()` 回傳 HTML 字串），不是盒子內標籤；
  目前 app 沒有顯示，CLI 文字報告有同樣內容。
- 圖區是固定尺寸畫布：SVG 填滿容器，`viewBox` 的 meet-fit 就是「符合視窗」，
  縮放平移只改一層 `<g>` 的 `transform`。字級與線寬跟著等比縮放（真幾何縮放）。

## CLI

`tools/trace_sankey.py`：先算 residual 再畫／印。純文字離線可用；本機裝了 plotly 就能出互動 HTML。

```bash
make draw    FILE=samples/classic.json          # python3 tools/trace_sankey.py samples/classic.json
make mermaid FILE=samples/k8s.json KIND=sankey  # ... --mermaid sankey
make mermaid FILE=samples/campus.json KIND=flow # ... --mermaid flow
make html    FILE=trace.json OUT=out.html       # ... --plotly out.html（需要 plotly）
make check                                      # 所有 samples 跑一次

python3 tools/trace_sankey.py samples/pruned.json --json   # 印算好的模型
cat trace.json | python3 tools/trace_sankey.py -           # 吃 stdin
```

## 檔案

```
Makefile                     跑起來與驗證的入口（make help）
packages/trace-sankey/       npm 套件（零依賴、純 ESM、無 build step）
  src/model.js               驗證、合併 hop、顯示門檻過濾、算殘差
  src/render.js              SVG Sankey、等比殘差色塊、終止小卡、hop 摘要（summary）
  src/zoom.js                createZoom()：縮放平移（滾輪定位游標、拖曳、雙指、符合視窗／1:1）
  src/tooltip.js             createTooltip()：帶子 hover 的 tooltip
  src/mount.js               mount(el, doc, opts)：一行接好整條管線
  src/react.js               <TraceSankey> React 元件（trace-sankey/react）
  src/samples.js             九個內建範例（trace-sankey/samples）
  styles/trace-sankey.css    圖與 tooltip 的樣式（trace-sankey/style.css）
  types/index.d.ts           TypeScript 型別
app/                         Vite + React 使用端：圖 + 顯示門檻 + 圖例 + 縮放工具列
electron/                    Electron 測試殼（make electron）：BrowserView 載 nginx，
                             可用環境變數重現各種「host 設錯」的情況。
                             刻意不在 npm workspaces 裡，見 electron/README.md
samples/*.json               範例 JSON（CLI 也吃同一份；make check 會全部跑一次）
stress/                      縮放平移的壓力測試資料與產生器（刻意不放 samples/，
                             免得 make check 被超大檔拖慢）
tools/trace_sankey.py        CLI：文字報告 / Mermaid / plotly
tools/golden.mjs             重構對拍：dump 所有範例輸出，前後 diff -r
Dockerfile                   多階段；--target content = 只有 dist 的小映像（主要），
                             不帶 target = nginx 全包的自足映像（次要）
docker-compose.yml           分離式：content 映像倒進 volume + 官方 nginx（make up）
docker-compose.dev.yml       nginx 直接 bind mount 主機 app/dist（make up-dev）
deploy/conf.d/default.conf   nginx server 區塊：try_files SPA fallback、快取、gzip
deploy/kustomization.yaml    k8s：ConfigMap 直接讀上面那支 conf，不複製第二份
deploy/k8s/                  k8s Deployment（initContainer 倒內容）與 Service
```

Mermaid 匯出目前只在 CLI（網頁版的匯出分頁已隨舊靜態頁移除）。
