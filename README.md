# Interface Increment 追查 Sankey

向後端 API 查一次追查，把回傳的 cytoscape-style wire JSON（`elements.nodes` / `elements.edges`）畫成守恆的 Sankey。
同一份契約同時吃 switch 追查資料（`delta_bps`）與參考面板（kube-state-graph）的 storage-flow 資料
（`read_bytes_per_sec` / `write_bytes_per_sec`）。舊的 `investigation + hops[]` 格式已不再接受，
轉換方式見 [docs/migration-wire-format.md](docs/migration-wire-format.md)。

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
（Vite + React 使用端：查詢表單 + 圖 + 顯示門檻）。

```bash
git clone <repo> && cd sankey-panel

npm install                   # 第一次；裝 app 的 react/vite（套件本身零依賴）
make dev                      # 起 dev server（= npm run dev --workspace app）
make check                    # 所有範例（內建 + samples/ + stress/）build 一遍
make up                       # 產品用：起 nginx + 內容 volume（見「用 nginx 部署」）
make help                     # 所有 target
```

app 開場是空的：在上方填查詢條件（起點 switch、時間範圍、追多深…）按「查詢」，
由後端 API 跑追查、回傳一份追查 JSON，網頁直接畫出來。參數見「查詢 API」一節。
查詢失敗（連不到、HTTP 錯誤、回應不是 JSON、回應不合契約）只出錯誤橫幅，
**不會毀掉你正在看的圖**。資料來源整個關在 `app/src/useTraceDoc.js`、
API 呼叫關在 `app/src/api.js`，換端點只改 `api.js` 裡的一個常數。

開發時 dev server 會把 `/api` 代理到 `http://localhost:8000`（正式環境由 nginx 做同一件事），
後端不在那裡就指過去：

```bash
VITE_DEV_API=http://10.0.0.5:8000 make dev
```

#### dev 專用的本機資料來源（不用起後端）

`make dev` 的上方會多一列標著 `dev` 的控制項：一個內建範例下拉（`trace-sankey/samples`
那十一份），與一顆「選檔…」（讀本機任何 `.json`，`samples/` 與 `stress/` 都載得到）。
改 `render.js`／CSS 想掃過所有範例、或想看 `stress/05-huge.json` 那種規模時不必起後端。
兩條路都走 `useTraceDoc` 裡跟 API 回應同一個 `validate()`，所以手改的 JSON 打錯字會出
一樣的錯誤橫幅，而且**不會清掉你正在看的圖**。

**只有 `make dev` 有這一列。** 它整支關在 `import.meta.env.DEV` 的動態 import 後面，
`vite build` 會把那個條件換成 `false`、整段連同 `import()` 一起消掉，所以 chunk 根本不會產生——
`app/dist` 裡沒有任何範例位元組，「同一顆 content 映像跨環境共用」的前提不變。
`make build`／`make up-dev`／`make electron` 端的都是正式 build，那裡沒有這一列**是設計，不是壞掉**。
要自己確認：

```bash
npm run build --workspace app
grep -ra "sw-edge-a\|lab-gpu-01\|DevSampleBar\|trace-sankey/samples" app/dist/assets/*.js   # 期望沒有輸出
find app/dist -name '*.js' | wc -l                                                            # 期望 1，沒有多出 chunk
```

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
- **`/api/` 反向代理到追查 API**：前端只打同源相對路徑（免 CORS），後端位置寫在
  `deploy/conf.d/default.conf` 的 `set $trace_api http://api:8000;` 那一行。
  這是刻意的——Vite 會在 **build 時**把網址烤進 bundle，前端一旦寫死後端網址，
  同一顆 content 映像就沒辦法跨環境共用了。換環境只要改設定 + `nginx -s reload`。
- `proxy_pass` 寫成**變數 + `resolver`** 而不是固定 hostname：nginx 啟動時就會解析固定
  hostname，API 還沒起來會直接「host not found in upstream」**啟動失敗**，連靜態頁都端不出來。
  寫成變數會把 DNS 延到每次請求才查，API 晚起來最多是 502。k8s 上要把 `resolver` 換成
  kube-dns 的 ClusterIP。
- **API 不要對外 publish port**：只有 nginx 需要連得到它。這個工具沒有帳號驗證，
  連得到 `/api/` 的人就查得到全部資料（見「查詢 API」一節）。

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

另外兩點：

- 用 http origin 而不是 `file://`：查詢打的是同源相對路徑 `/api/…`，`file://` 下沒有
  可用的同源可言，代理不會生效。
- `deploy/conf.d/default.conf` 的 `X-Frame-Options: DENY` 不會擋 BrowserView——它是獨立的
  top-level WebContents，不是 frame；擋的是真的被別人 `<iframe>` 進去。

`electron/` 底下有一支可跑的測試殼（`make electron`），既是參考實作，
也能用環境變數重現各種「host 設錯」的情況。
**host 端的設定不是你能控制的**，你這一側該怎麼防守看
[被 Electron 鑲嵌時](#被-electron-鑲嵌時host-端不受你控制)。

### 當套件用

```js
// React：
import { TraceSankey } from 'trace-sankey/react';
import 'trace-sankey/style.css';
<TraceSankey doc={wireJson} minBps={0} channels="both" className="my-chart" />
// 容器高度由你的 CSS 決定（元件不設高度）

// 不用 React（vanilla）：
import { mount } from 'trace-sankey';
const inst = mount(document.getElementById('chart'), wireJson, { minBps: 0, channels: 'both' });
inst.setMinBps(5e8); inst.setChannels('read'); inst.zoom.fit(); inst.destroy();

// 只要 SVG 字串（Node 也能跑，沒有 DOM 依賴）：
import { build, render } from 'trace-sankey';
const model = build(wireJson, { minBps: 0, channels: 'both' });
if (model.ok) fs.writeFileSync('out.svg', render(model));
```

對外契約（自己接互動時可依賴）：

- render 產出的 `<g class="zoom-layer">` 是縮放的掛點。
- 每條 `.band` 上的 `data-tip` 屬性是一份 JSON（`from/to/fi/ti/bps` ＋ storage 資料才有的
  `unit/channel/tier/attr/extra`），每張卡片的 `<g>` 也有一份（`{node:1, title, rows:[[k,v],…]}`，
  render 已經把數字格式化好）；tooltip 的資料都從這來，不掛套件 tooltip 的人可以自己讀。
- `channels` 選項（`'both'`（預設）／`'read'`／`'write'`）：storage 資料每條邊有 read／write 兩條帶，
  只看其中一種時另一種的量**併進其他輸入／其他輸出**（與顯示門檻同一套機制，每台仍守恆）。
  `delta_bps` 的邊沒有通道、不受影響。app 沒有這個開關，是給使用套件的人接的。

SVG 的文字顏色與字級在 `trace-sankey/style.css`，不載入會沒有正確外觀。

### 顯示門檻

控制列的「顯示門檻」填一個整數（單位 bps，旁邊即時翻成 Gbps／Mbps／kbps），
圖上就只留值**大於**這個值的帶子。追一條 10G 的主幹時，這是把幾 Mbps
的雜訊帶清掉的開關。storage 資料的帶是 bytes/s，門檻直接比數值（不換算單位）。

- 濾掉的量**不會消失**，會併進該台的其他輸入／其他輸出，所以
  「已知 in ＋ 其他輸入 ＝ 已追查 out ＋ 其他輸出」照樣成立。
- 一台 switch 濾完身上一條帶都不剩，就**整台不顯示**。
- 追查起點那條**永遠保留**——濾掉它整張圖就沒有錨了。沒有 `investigation` 的圖有可能被濾到
  一台不剩：那不是錯誤，畫布會空著並標一句說明，門檻旁的統計照樣顯示隱藏了多少。
- 殘差色塊本身不受門檻管，照舊只看該台的讀數誤差門檻。
- 門檻輸入旁會顯示隱藏了幾條帶、幾台、總共多少量（model 的 `filtered`／
  `filteredNodes`，warnings 裡也有同一句）。
- 這是**顯示**用的門檻，不進 JSON 契約、不影響 `validate()`（`build(doc, { minBps })` 的第二個參數）。
- 門檻過濾的每一條「帶」是**加總後**的邊：同 `(source, target, source_iface, target_iface, channel)`
  的多條邊先相加再比門檻。錨邊與推導的 pod → application／namespace 邊豁免。

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

**你這邊的因應（網頁，已實作）**：`app/src/App.jsx` 有一個 effect **無條件對
`dragenter`／`dragover`／`drop` 呼叫 `preventDefault()`**，掛在 document 的
**capture 階段**。原因：`dragover` 沒被取消的話，Chromium 根本不會把 `drop` 事件送進頁面，
而是直接導航到那個檔案。不看 `dataTransfer.types` 是刻意的——有些拖放來源不給 types，
「先問再攔」就會漏；掛 capture 是為了不被任何子層的 `stopPropagation()` 繞過。

⚠️ **這個 effect 沒有任何功能，只有這道防線**：開檔與拖放讀 JSON 的功能已經隨
「JSON 改由 API 查詢」移除了，但 effect 要留著。看到它「什麼都沒做」就順手刪掉，
會安靜地把這個防護一起刪掉。

代價是拖文字進「顯示門檻」輸入框的原生行為會失效，可接受。
**nginx 端無能為力**：這是 renderer 的行為，不經過 HTTP。

> 驗證：`GUARD=off npm start`，然後拖一個 `.json` 進視窗——**應該什麼都不發生**。
> 整頁真的跳成 `file://…` 就代表上面那個 effect 壞了或被刪了。

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

### 4. 存過的自訂 JSON 不見了（已不再適用，但 origin 仍然要看）

**原本的坑**：自訂 JSON 存在 `localStorage`（鍵 `trace-sankey/custom`），而 `localStorage`
綁在 **origin** 上，三種 host 設定都會弄丟它——非持久 session、`localhost` 與 `127.0.0.1`
被當成兩個 origin、以及用 `file://` 載。

**現況：這個坑消失了**。JSON 改成每次查 API 拿，網頁**完全不再寫 `localStorage`**，
沒有東西可以掉。

**但 origin 還是有意義**，只是理由換了：查詢打的是同源相對路徑 `/api/…`，
所以 host 必須用 http origin 載（`file://` 下 `/api/` 直接失效，見 §7）。
host 換 port／hostname 寫法不再會弄丟資料，但仍會換掉未來的 cookie 儲存空間。

**nginx 端可做（預設不開）**：強制單一 canonical origin：

```nginx
# 代價：該機器若解不到 localhost 就會壞，只在確定環境開
if ($host = "127.0.0.1") { return 301 http://localhost:$server_port$request_uri; }
```

> 重現：`SESSION=temp npm start`（現在應該**看不到**任何差異——那就是對的）。

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

### 7. 打 API 取資料（已實作）

先講結論：**view 的類別依然無關；但 API 化會新增一批 host 相關的坑，而它們有同一個解——
讓 nginx `proxy_pass /api/` 到後端，網頁只打相對路徑 `/api/...`。這個解已經落地**
（`deploy/conf.d/default.conf` 的 `/api/` location，網頁端在 `app/src/api.js`）。
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
  這是必須要求 host 用 http origin 的**主要**理由（見 §4）。
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

## 查詢 API

網頁按下「查詢」後打的是**同源相對路徑**，由 nginx（開發時是 Vite dev server）代理到後端：

```
GET /api/trace?hostname=tor-01&from_ts=1757000000000&to_ts=1757003600000
    &max_hops=7&top_n=3&threshold=10&track_dir=source
```

| query 參數 | 型別 | 預設 | UI 欄位 |
|---|---|---|---|
| `hostname` | string，必填 | — | 起點交換器 hostname |
| `from_ts` | int，epoch **毫秒** | 現在時間 −1 小時 | 起始時間 |
| `to_ts` | int，epoch **毫秒** | 現在時間 | 結束時間 |
| `max_hops` | int ≥ 1 | 7 | 最多追查層數（跳） |
| `top_n` | int ≥ 1 | 3 | 每台取前幾大 interface |
| `threshold` | float 0–100 | 10 | 貢獻門檻（％） |
| `track_dir` | `source` \| `destination` | `source` | 追查方向 |

- 七個參數**一律顯式帶上**（含預設值），後端不必猜、log 也看得出這次查了什麼。
- 時間是 epoch **毫秒**，由輸入框的本地時間換算（不是 UTC 字串）。
- 回應**直接就是下面那份追查 JSON 契約本體**，不包 envelope。前端拿到後照樣跑
  `validate(doc)` 才畫，不合契約會出橫幅、圖留在上一次的結果。
- 端點路徑目前是 `/api/trace`；後端不同就改 `app/src/api.js` 的 `ENDPOINT` 常數。

### 可分享的網址

查詢成功後，條件會同步寫進**網址列**（`history.replaceState`，不進上一頁），
複製整條網址給同事，他打開就會看到同一張圖：

```
http://localhost:8080/?hostname=tor-01&from_ts=1757000000000&to_ts=1757003600000
    &max_hops=7&top_n=3&threshold=10&track_dir=source&min_bps=500000000
```

- 參數名與型別**與上表的 API query 完全一樣**，另外多一個 `min_bps`（顯示門檻，
  0＝不過濾時不寫進網址）。
- 時間同樣是 epoch **毫秒**：跨時區分享不會歧義（本地時間字串沒有時區後綴，
  對方會用他的時區解讀，看到不同區間）。
- 打開帶 `hostname` 的網址會**自動查一次**；沒帶 `hostname` 就只是填好表單、等你按查詢。
- 時間**沒帶**就用預設的最近 1 小時；**帶了但不是數字**會出「網址裡的查詢條件有誤」橫幅，
  不會安靜地改用別的時間。
- **查詢失敗不會動網址**——網址永遠代表你正在看的那張圖。

**沒有存取控制**：這個工具沒有帳號、token 或 session，連得到服務的人就查得到全部資料
（瀏覽器的同源政策／CORS 只約束網頁裡的 JS，擋不住 curl）。要限制的話請在部署層做——
API 不對外開 port、nginx 綁內網或加 IP 白名單。

## 輸入 JSON 規格

格式是 cytoscape-style 的 wire JSON：`{ elements: { nodes: [{ data }], edges: [{ data }] } }`，
與參考面板（kube-state-graph-frontend 的 Storage Flow Sankey）吃同一份契約，再加上我們的擴充
（`investigation`、`labels.tier`、`other_*_bps`、`metrics.delta_bps`）。
**參考面板會用到的合法資料，丟進來也合法且畫得出來。** 舊格式怎麼轉：[docs/migration-wire-format.md](docs/migration-wire-format.md)。

整體長相（`// 註解` 是說明，JSON 本身不能有註解）：

```jsonc
{
  "apiVersion": "v1",                 // 選填，忽略
  "clusters": ["prod"],               // 選填，忽略
  "kind": "destination" | "source",   // 選填；否則看 investigation.direction（out→source）；預設 destination
  "investigation": {                  // 選填（我們的擴充）。沒給＝無錨卡、不查 root
    "node_id": "sw-edge-a",           // 必須是 hop 型節點
    "iface": "xe-0/0/1", "delta_bps": 10000000000,   // delta_bps > 0（bps）
    "direction": "in" | "out", "note": ""
  },
  "elements": {
    "nodes": [{ "data": {
      "id": "…", "type": "…",         // 必填；id 不可重複
      "name": "…",                    // 選填，卡片標題，缺就用 id
      "parent": "…",                  // 選填，群組鏈（namespace / application）
      "labels": { "namespace": "…", "tier": "…", "ontap_cluster": "…" },   // 選填，純字串對應表
      "status": "normal|warning|critical",           // 選填；其他值視同沒有
      "usage": { "used_bytes": 0, "capacity_bytes": 0 },   // 兩欄各自獨立
      "health": "…", "hardware": { "model": "…" }, "perf": { … }, "alerts": [ { "name": "…", "severity": "…" } ],
      "clients": [ { "ip": "…", "hostname": "…", "owner": "…" } ],   // 我們的擴充：這個 port 上掛了誰
      "other_in_bps": 0, "other_out_bps": 0          // 我們的擴充，≥ 0，顯式殘差
    }}],
    "edges": [{ "data": {
      "id": "e1", "type": "network-flow" | "storage-flow",   // 其他 type 整條忽略
      "source": "…", "target": "…",                          // 一律封包方向
      "labels": { "tier": "…", "source_iface": "…", "target_iface": "…", "attribution": "split" },
      "metrics": { "delta_bps": 0, "read_bytes_per_sec": 0, "write_bytes_per_sec": 0,
                   "read_ops": 0, "write_ops": 0, "read_latency_us": 0, "write_latency_us": 0,
                   "max_iops": 0, "max_bytes_per_sec": 0 }
    }}]
  }
}
```

單位：`delta_bps`／`other_*_bps`／`investigation.delta_bps` 是 **bps**（10 Gbps 寫 `10000000000`）；
`read/write_bytes_per_sec`／`max_bytes_per_sec`／`total_bytes_per_sec` 是 **bytes/s**；`used_bytes`／`capacity_bytes` 是 **bytes**；
`*_latency_us` 是 **µs**。程式**不換算**單位，只依欄位選顯示尺。

### 頂層

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `elements` | object | ✔ | 必須含 `nodes` 與 `edges` 兩個陣列（可以是空陣列，但 `nodes` 裡至少要有一個 hop 型節點才畫得出圖） |
| `kind` | `"destination"` \| `"source"` | | 追查方向。沒給就看 `investigation.direction`，再沒給就當 `destination`。見「追查方向」 |
| `investigation` | object | | 追查起點。**選填**：給了就畫錨卡與錨邊；沒給就沒有起點、沒有 root，第一欄從「第 0 跳」起算 |
| `apiVersion`、`clusters` | | | 參考 wire 會帶，忽略 |

不認得的頂層鍵一律忽略（`pruning` 也是——舊格式的截斷註記已從契約移除）。

### `investigation`

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `node_id` | string | ✔ | 起點那台的 `id`。必須存在於 `nodes`，且 `type` 是 hop 型（見下）；被丟掉的 k8s node（只被 `pod-node` 邊碰到）不能當起點 |
| `iface` | string | ✔ | 你看到增加的那條 interface。顯示在錨卡與錨邊兩端 |
| `delta_bps` | number > 0 | ✔ | 速率增量 Δ，bps。錨邊的帶寬。**永遠不受顯示門檻／通道過濾** |
| `direction` | `"in"` \| `"out"` | | `in` = 追終點，`out` = 追來源。`kind` 優先 |
| `note` | string | | 一句話備註，顯示在錨卡的 tooltip |

### `nodes[].data`

| 欄位 | 型別 | 必填 | 效果 |
| --- | --- | --- | --- |
| `id` | string（非空） | ✔ | 唯一鍵，**不可重複**。邊的 `source`／`target`、`investigation.node_id`、別的節點的 `parent` 都指它 |
| `type` | string（非空） | ✔ | 決定畫成什麼（見「節點 `type` 分三類」）。自由字串，不認得的值畫成葉卡 |
| `name` | string | | 卡片標題；缺或空字串就用 `id`。群組節點的 `name` 是 application／namespace 終點卡的標題 |
| `parent` | string（非空） | | 上一層群組節點的 `id`，可以一層層接（pod → controller → application → namespace）。指到不存在的 id 視同沒有 parent；鏈成環不會卡死（走到重複就停）。只有 pod 會沿 parent 鏈找 application／namespace，其他型別的 parent 不影響畫面 |
| `labels` | object，值全是 string | | 純字串對應表；出現非字串的值是驗證錯誤。認得的鍵見下表，其他鍵忽略 |
| `status` | `"normal"` \| `"warning"` \| `"critical"` | | 卡片外框色：critical 玫瑰、warning 琥珀（優先於 root 的青框）、normal 中性框。其他任何值**視同沒有**（中性框，不報錯、不退成 normal）。也進 tooltip |
| `usage` | object | | `{ used_bytes, capacity_bytes }`，見「`usage`」。不是物件是驗證錯誤 |
| `health` | string | | 只進 tooltip（`health` 列），原字串照印。不影響外框色——status 才管顏色 |
| `hardware` | object | | 只讀 `hardware.model`，進 tooltip（`model` 列）；其他鍵忽略 |
| `perf` | object | | 只讀 `cpu_busy_pct`／`total_ops`／`total_latency_us`／`total_bytes_per_sec` 四個有限數字，進 tooltip 並標「（raw）」——原始讀數，不判定好壞、不上色 |
| `alerts` | array of `{ name, severity? }` | | 每則一列進 tooltip：有 `severity` 印 `<severity> <name>`，沒有就只印 `name`；沒有 `name` 的項目跳過。不畫成 badge |
| `clients` | array of `{ ip?, hostname?, owner? }` | | 我們的擴充：沒有 LLDP 鄰居時，這個 port 上查到的 client，見「`clients`：無鄰居 port 的表達方式」。不是陣列是驗證錯誤 |
| `other_in_bps` | number ≥ 0 | | 我們的擴充：顯式的「其他輸入」殘差。不給就由平衡式補（見「守恆與殘差」）。負數或非數字是驗證錯誤。只對 hop 型節點有意義；no-flow 卡給了會警告並歸零 |
| `other_out_bps` | number ≥ 0 | | 同上，「其他輸出」 |

參考 wire 上還會出現但我們**不讀也不報錯**的鍵：`ipaddress`／`owner`／`application`／`containers`／`storageclass`／`ready_status`。

#### `labels` 認得的鍵（節點）

| 鍵 | 效果 |
| --- | --- |
| `namespace` | pod：ns 的**最後備援**（`parent` 鏈找不到 application／namespace 祖先時才用）。pvc 等其他 hop：副標印 `ns/<namespace>`（ns 色），tooltip 也有。非 pod 的葉卡：左緣掛 ns 色條 |
| `tier` | 同 `tier` 的節點**鎖在同一欄**，彼此之間的邊畫成右側弧帶。字串內容自訂，只比對相同與否。見「同層互連（tier）」。`netapp-node`／`netapp-aggr`／`netapp-svm`／`pvc` 沒給時自動以 `type` 當 tier |
| `ontap_cluster` | 副標多印一段 ` · <ontap_cluster>`，tooltip 多一列。給哪種 type 都會印，慣例是 netapp 三型別 |

### 節點 `type` 分三類

| 類別 | `type` 值 | 畫法 |
| --- | --- | --- |
| **hop** | `switch`、`node`、`pod`、`netapp-node`、`netapp-aggr`、`netapp-svm`、`pvc` | 有槽位、算殘差的盒子。`switch`／`pvc` 實線框；`node`／`pod`／`netapp-*` 是「設備」，虛線框（root 的青框與 status 色優先）。副標：`id`，非 switch 加 ` · <type>` |
| **群組** | `namespace`、`application`、`cluster`、`storage-cluster`、`controller` | **不直接畫**，只能出現在別的節點的 `parent` 鏈上；pod 的 application／namespace 終點卡由此推導。flow 邊接到群組是驗證錯誤 |
| **葉** | 其他任何值（`host`、`router`…） | 灰色「追查終止」小卡（`追查終止`／`未再往下追`＋iface＋數量）。帶 `clients` 時右上角換成 client 標記、卡面改成 client 表格，並再接一欄 owner 卡（見「`clients`」）。**不能再有往下走的 flow 邊**（追終點：不能當 `source`；追來源：不能當 `target`）→ 驗證錯誤；要接下去請改用 hop 型 type |

再細分幾條規則：

- **葉 pod** ＝ `type:"pod"` 且沒有往下走的 flow 邊（追終點：沒有 out 邊；追來源：沒有 in 邊；不看 metrics，只看邊存不存在）
  → 天藍虛線 pod 卡，並**自動接一條推導邊**到 application／namespace 終點卡；**proxy pod** ＝ 有往下走的邊 → 一般 hop 盒，
  不接 ns（流量已流向下游，再接會重複計量），它的 ns 只是盒副標。
- **pod 的 namespace 解析順序**：`parent` 鏈上有 `application` 祖先 → 先接 application 卡（標題＝該群組的 `name`），
  再取那個 application 的 `namespace` 祖先；否則 pod 自己的 `namespace` 祖先；否則 `labels.namespace`；
  都沒有 → pod 卡不接 ns（合法：沒有色條、卡矮一階、不報錯不警告）。同名 application 出現在兩個 ns 是兩張卡。
- **推導邊的值**：pod → application 與 application → namespace 都是 pod 自己那條（或那幾條）入邊的加總——
  同一筆數字的重新分組，不是推估。全圖同 ns／同 app 合一個終點卡，終點卡上印合計與 pod 數。
- **群組卡的 `status`** ＝ 成員 pod 的最差值（`normal < warning < critical`）；沒有任何成員有 status 就維持中性框。
- **自動 tier**：`netapp-node`／`netapp-aggr`／`netapp-svm`／`pvc` 沒給 `labels.tier` 時以 `type` 當 tier，
  同型別鎖同欄（參考面板的欄就是型別；FlexGroup 這種從 SVM 起頭、沒有上游 aggr 的路徑才不會被最長路徑推到第 0 欄）。
  `switch`／`node`／`pod` 不自動，要鎖請明給 `labels.tier`。
- **只被 `tier:"pod-node"` 邊碰到的 `type:"node"` 節點靜默丟掉**（那是參考面板 Node layout 的外框，我們不畫）。
  同一個 node 若還有任何 flow 邊接到它，就照常畫成 hop。
- **no-flow 卡**：列在 `nodes`、也是 hop 型，但一條可畫的 flow 邊都沒接到（沒有邊，或邊都沒有量測值）
  → 只畫盒子，沒有槽位、沒有殘差；不會被顯示門檻算成「隱藏 N 台」。給了 `other_*_bps` 會警告並歸零。
- `nodes` 裡**沒有任何 hop 型節點**（只有群組和葉）→ 驗證錯誤「圖上沒有任何可畫的節點」。

### `edges[].data`

| 欄位 | 型別 | 必填 | 效果 |
| --- | --- | --- | --- |
| `id` | string（非空） | ✔ | 唯一，不可重複。只用來認邊與寫警告 |
| `type` | string（非空） | ✔ | **只有 `network-flow` 與 `storage-flow` 會畫**，其他值整條忽略（但 `source`／`target` 仍須存在）。兩者畫法沒有差別，差別在 `metrics` 帶什麼 |
| `source` | string | ✔ | 上游節點 `id`，**一律封包方向**（追來源模式也一樣，起點會自己跑到最右）。必須存在於 `nodes` |
| `target` | string | ✔ | 下游節點 `id`。同上 |
| `labels` | object，值全是 string | | 認得的鍵見下表，其他鍵忽略 |
| `metrics` | object | | 帶寬與 tooltip 資料，見「邊：權重與通道」。缺、不是物件、或算不出任何一條帶 → 這條邊不畫（但仍算「有邊」：影響葉 pod／proxy pod 判定與 no-flow 判定） |

#### `labels` 認得的鍵（邊）

| 鍵 | 效果 |
| --- | --- |
| `source_iface` | 上游那一側的 interface 名。印在 `source` 盒子右緣的槽位旁、tooltip 的「出口 iface」；葉卡上印在數量前面 |
| `target_iface` | 下游那一側的 interface 名。印在 `target` 盒子左緣的槽位旁、tooltip 的「入口 iface」。**沒填就留空，不猜** |
| `tier` | `"pod-node"` → 整條邊忽略（只是「pod 排在哪台 node」的擺放資訊，永遠不畫）。其他值一律畫，並顯示在帶的 tooltip（`svm-pvc`、`pvc-pod`…）。跟節點的 `labels.tier` 是兩件事 |
| `attribution` | `"split"` → tooltip 標「平均攤分的估計值」（參考面板對 RWX 多 pod 共用 PVC 的攤分標記）。其他值原字串進 tooltip |

同 `(source, target, source_iface, target_iface, channel)` 的多條邊會**相加成一條帶**；`tier`／`attribution`／`metrics` 的附加欄位採先出現的那條。

### 邊：權重與通道（`metrics`）

一條邊的 `metrics` 會變成**零到兩條帶**：

| `metrics` 內容 | 結果 |
| --- | --- |
| 有 `rate` 鍵（不管值是什麼） | RED 家族（trace 呼叫邊的 rate／error_rate／p90），整個 `metrics` 忽略，**不畫** |
| 有 `delta_bps`（≥ 0 的有限數） | **一條**無通道的青帶，單位 bps，顯示帶 `+` 號（`+20 Gbps`，速率的**差**） |
| 沒有 `delta_bps`，有 `read_bytes_per_sec`／`write_bytes_per_sec` | **各自存在就各一條帶**：read 青、write 燃橘，單位 bytes/s，顯示不帶號（`5.24 MB/s`，絕對速率）、**不乘 8、不相加**。只有 read 就只有一條 |
| 三個權重欄位都沒有 | 不畫 |

| 欄位 | 型別 | 效果 |
| --- | --- | --- |
| `delta_bps` | number ≥ 0 | 帶寬（bps）。有它就不看 read／write |
| `read_bytes_per_sec` | number ≥ 0 | read 帶的帶寬（bytes/s） |
| `write_bytes_per_sec` | number ≥ 0 | write 帶的帶寬（bytes/s） |
| `read_ops`、`write_ops` | number | 只進 tooltip（「IOPS（read / write）」列） |
| `read_latency_us`、`write_latency_us` | number | 只進 tooltip（「read 延遲」「write 延遲」，µs） |
| `max_iops` | number | 只進 tooltip（「QoS 上限 N IOPS」） |
| `max_bytes_per_sec` | number | 只進 tooltip（「QoS 上限 X/s」） |

規則：

- **absent ≠ 0**：值為 `0` 是真讀數，照畫（最細 3px 的帶）；只有「`metrics` 缺／該欄位缺／非有限數」才是不畫。
  絕不把缺值補成 0。
- 權重欄位**負數 → 丟該欄並警告**（視同缺值；不是驗證錯誤，因為參考面板不擋負值）。
  `other_*_bps` 負數仍是驗證錯誤——那才會算出負的色塊高度。
- 沒有任何一條帶的邊會累計進一則警告「N 條 flow 邊沒有可用的量測值」。
- 同一張圖混用 `delta_bps`（bps）與 `read/write_bytes_per_sec`（bytes/s）會警告：帶寬比例尺跨單位沒有意義。
- **殘差不拆讀寫**：一台 hop 左右兩疊把 read 帶與 write 帶一起加總，「其他輸入／其他輸出」仍是單一色塊。
- 套件的 `channels` 選項（`'both'`／`'read'`／`'write'`）可以只看一種通道；被藏起來的通道併進其他輸入／其他輸出。見「當套件用」。

### `usage`

| 欄位 | 型別 | 效果 |
| --- | --- | --- |
| `used_bytes` | number ≥ 0 | 已用容量（bytes） |
| `capacity_bytes` | number ≥ 0 | 總容量（bytes） |

兩欄各自獨立：非有限數或負數就丟該欄、不報錯。兩欄都在 → 盒子副標下多一行「使用 700 GB / 1 TB（70%）」
（盒子標題區高一行）；只剩一邊 → 副標不畫（**絕不填 0**），tooltip 顯示「已用 X」或「容量 Y」。
`usage` 不是物件才是驗證錯誤。哪種 type 都可以帶，參考資料用在 `pvc` 與 `netapp-aggr`。

### `clients`：無鄰居 port 的表達方式

追到某個 interface 沒有 LLDP 鄰居時，追查就斷在那裡。慣例是替那個 port 合成一個葉節點
（`type: "host"`，id 常是 `<switch>:<iface>`）。後端若能改用 ARP／MAC table／DHCP／CMDB
查出這個 port 上掛了誰，就把結果放進該節點的 `clients`：

```jsonc
{ "data": {
  "id": "sw-tor-1:xe-0/0/12", "type": "host",
  "clients": [
    { "ip": "10.42.7.31", "hostname": "lab-gpu-01", "owner": "網管部 王小明" }
  ]
} }
```

- 三個欄位**都選填**，但**至少要有 `ip` 或 `hostname`**，否則該筆靜默丟棄（只有 owner 在圖上
  認不出是哪台機器）。認不得的鍵忽略——之後後端先送 `mac`／`vlan` 也不會壞，只是還沒有畫面。
- **一個 port ＝ 一張葉卡**，不是一個 client 一張卡／一條帶。後端量得到的是整個 port 的
  Δ bps、量不到 per-client，攤分就是推估（見「不做的事」）。量停在 port 那一層，
  卡上把這個 port 掛了誰列成一張表。
- 放在**節點**上而不是邊上：一張葉卡可能有多條邊進來，放邊上就要合併清單。
- 任何節點都可以帶 `clients`（hop 也行，只進 tooltip）；**只有葉卡會畫到卡面上**。
- 卡面畫成 `hostname` / `ip` / `owner` 三欄的小表格（**有表頭**），**每台一列、全部列出**。
  某一欄所有 client 都沒值就整欄不畫，卡也跟著窄；每格會截斷長字串（`…`），
  **完整值一律在 tooltip**，不截斷。
- 有 `clients` 的卡**不畫合成 id 當標題**（`sw-tor-1:xe-0/0/12` 順著帶子回去就知道了，
  抄在卡上是重複資訊），**最後一行也不再重複 iface**、只留量。真的給了 `name` 才畫標題。
- 節點沒給 `name` 且剛好只有一筆 client 時，節點的顯示名稱用該 client 的 `hostname`
  （沒有 hostname 就用 `ip`）——**那條量測帶的 tooltip 讀的就是這個名稱**，
  所以會顯示成 `sw-tor-1 → 10.42.7.32` 而不是合成 id。合成 id 仍在卡片的 tooltip 裡。
  兩台以上時帶的 tooltip 改用 `client` 那一列列出清單。
- 範例：`samples/client.json`。

#### 依 `owner` 再聚合一層

有 `clients` 的 port 葉卡右邊會再長一欄 **owner 卡**，同名 owner 全圖合一，
「這個人名下總共多少流量」直接在圖上讀（比照 pod → application → namespace 的推導卡）。
`owner` 是自由字串，原樣當鍵；沒有 `owner` 的 client 全歸同一張「未知 owner」卡
（用內部鍵，真的有人叫這個名字也不會被併掉）。**沒有 `clients` 的葉不長 owner 層**，
維持原本的「追查終止」小卡。

量怎麼帶過去，取決於這個 port 掛了幾個 owner：

| 情況 | 帶 | 為什麼 |
| --- | --- | --- |
| 整張卡同一個 owner（含全部都沒有 owner） | **實量帶**：青色、帶全額數字 | 跟 pod → app 一樣是同一筆數字的重新分組 |
| 一張卡掛了多個 owner | **歸屬線**：灰虛線、不帶數字 | 後端量得到的只有整個 port 的 Δ bps，按台數拆給各 owner 就是攤分推估（見「不做的事」） |

- 混合 owner 的 port **照樣分多條線連到每一個 owner**，只是那些線不帶量——歸屬看得到，量停在 port。
- owner 卡上第一行是**已量到的合計**（只累加實量帶）。名下只要有一個 port 是混合的，
  數字後面就標「（部分 port）」；名下全是混合 port 時第一行改印「量停在 port」，
  **絕不印一個 0**——那會被讀成「這個人沒有流量」。第二行是 `N 台 client · M 個 port`。
- 接了 owner 卡的 port 葉，左上角從「追查終止」改成 `port`（它已經是中繼了，比照 pod 卡）。
- owner 層在葉之後，**完全不影響每台 hop 的守恆**（殘差只算 hop）。

### 畫面對照：每個欄位出現在哪

| 畫面元素 | 來源 |
| --- | --- |
| 盒子標題 | `name`，缺就 `id` |
| 盒子副標 | `id` · `ns/<namespace>`（pod：推導的 ns；其他：`labels.namespace`）· `<type>`（switch 不印）· `labels.ontap_cluster` |
| 盒子第三行 | `usage`（兩欄齊全才有） |
| 盒子外框 | `status` 色 > 追查起點青框 > 設備天藍虛線 > 預設灰 |
| 槽位旁的小字 | 邊的 `labels.source_iface`（右緣）／`target_iface`（左緣） |
| 帶寬與帶上數字 | `metrics.delta_bps` 或 `read/write_bytes_per_sec`（加總後） |
| 帶的顏色 | 無通道／read 青、write 燃橘、回流玫瑰（不分通道） |
| 殘差色塊 | `other_in_bps`／`other_out_bps`，或平衡式自動補 |
| 葉卡 | `type` 不是 hop／群組的節點：標題 `name`／`id`、`labels.namespace` 色條、iface、數量合計；右上角 `未再往下追` |
| 葉卡（帶 `clients`） | 標題只在有 `name` 時畫；`labels.namespace` 色條、`clients` 的 `hostname` / `ip` / `owner` 三欄表格（有表頭、每台一列、全部列出、空欄不畫）、數量合計（**不重複印 iface**）；右上角 `client`／`N 個 client` |
| owner 卡 | 從葉卡的 `clients[].owner` 推導：標題＝owner 字串（沒有的歸「未知 owner」）、已量到的合計（只算「整張卡同一個 owner」的 port，不足時標「（部分 port）」／全無時印「量停在 port」）、`N 台 client · M 個 port` |
| 歸屬線 | 一個 port 掛多個 owner 時葉卡 → 各 owner 卡的灰虛線，**不帶量、不印數字** |
| pod 卡 | `type:"pod"` 且沒有往下走的邊：ns 色條（推導的 ns）、iface、數量 |
| application／namespace 終點卡 | 從 pod 的 `parent` 鏈推導：標題＝群組的 `name`、合計、pod 數、成員最差 `status` 框 |
| 錨卡 | `investigation`：`iface`、方向、`delta_bps`、`note`（tooltip） |
| 帶的 tooltip | from／to、出口／入口 iface、速率（含 channel；**歸屬線沒有這一列**）、ns、`client`（下游那端的葉有 `clients` 時；往 owner 卡的邊改列 port 那端）、`歸屬`（歸屬線）、tier、attribution、IOPS、延遲、QoS 上限、是否錨邊／回流 |
| 卡片的 tooltip | 型別／名稱、id、ns、ontap_cluster、已追查 in／out 與殘差（或合計＋pod 數；owner 卡是已量到的合計＋台數＋port 數）、usage、status、health、model、perf(raw)、alerts、no-flow、`clients`（每筆一列、不截斷） |
| 欄標題 | 整欄同一非 switch 型別 → `第 N 跳 · <型別名>`；整欄 pod／application／namespace／owner 各有文案（整欄都接了 owner 的 port 葉標 `第 N 跳 · port`） |

### 範例

追終點（`samples/classic.json`；Edge A 只追進來 10G 卻出去 20G，缺的 10G 自動變成 Edge A 的其他輸入）：

```json
{
  "kind": "destination",
  "investigation": { "node_id": "sw-edge-a", "iface": "xe-0/0/1", "direction": "in", "delta_bps": 10000000000 },
  "elements": {
    "nodes": [
      { "data": { "id": "sw-edge-a", "type": "switch", "name": "Edge A" } },
      { "data": { "id": "sw-core-1", "type": "switch", "name": "Core 1" } },
      { "data": { "id": "srv-db-07", "type": "host" } }
    ],
    "edges": [
      { "data": { "id": "e0", "type": "network-flow", "source": "sw-edge-a", "target": "sw-core-1",
                  "labels": { "source_iface": "et-0/0/48", "target_iface": "et-1/0/1" }, "metrics": { "delta_bps": 20000000000 } } },
      { "data": { "id": "e1", "type": "network-flow", "source": "sw-core-1", "target": "srv-db-07",
                  "labels": { "source_iface": "et-1/0/9", "target_iface": "eno1" }, "metrics": { "delta_bps": 20000000000 } } }
    ]
  }
}
```

追來源（`samples/source.json`）：`kind:"source"`，起點釘在最右；**邊仍一律照封包方向寫**（上游 → 下游），
只是追查是往 `target` 的反方向走：

```json
{
  "kind": "source",
  "investigation": { "node_id": "sw-core-1", "iface": "et-1/0/9", "direction": "out", "delta_bps": 20000000000 },
  "elements": {
    "nodes": [
      { "data": { "id": "sw-core-1", "type": "switch", "name": "Core 1" } },
      { "data": { "id": "sw-edge-a", "type": "switch", "name": "Edge A" } },
      { "data": { "id": "lab-gpu-01", "type": "host" } }
    ],
    "edges": [
      { "data": { "id": "e0", "type": "network-flow", "source": "sw-edge-a", "target": "sw-core-1",
                  "labels": { "source_iface": "et-0/0/48", "target_iface": "et-1/0/1" }, "metrics": { "delta_bps": 12000000000 } } },
      { "data": { "id": "e1", "type": "network-flow", "source": "lab-gpu-01", "target": "sw-edge-a",
                  "labels": { "source_iface": "eno1", "target_iface": "xe-0/0/1" }, "metrics": { "delta_bps": 7000000000 } } }
    ]
  }
}
```

k8s（`samples/k8s.json` 的節錄）：`node` 是虛線盒、`pod` 是中繼卡、namespace 終點自動推導；k8s 內部的邊可以不寫 iface；
沒有往下走的邊的 node 就整台由平衡式補成其他輸出：

```json
{
  "kind": "destination",
  "investigation": { "node_id": "sw-tor-k8s", "iface": "et-0/0/48", "direction": "in", "delta_bps": 30000000000 },
  "elements": {
    "nodes": [
      { "data": { "id": "sw-tor-k8s", "type": "switch", "name": "ToR k8s" } },
      { "data": { "id": "node-w-11", "type": "node", "other_out_bps": 2500000000 } },
      { "data": { "id": "node-w-13", "type": "node" } },
      { "data": { "id": "ingest-7d9c", "type": "pod", "labels": { "namespace": "telemetry" } } },
      { "data": { "id": "kafka-2", "type": "pod", "labels": { "namespace": "stream" } } }
    ],
    "edges": [
      { "data": { "id": "e0", "type": "network-flow", "source": "sw-tor-k8s", "target": "node-w-11",
                  "labels": { "source_iface": "xe-0/0/11", "target_iface": "bond0" }, "metrics": { "delta_bps": 14000000000 } } },
      { "data": { "id": "e2", "type": "network-flow", "source": "sw-tor-k8s", "target": "node-w-13",
                  "labels": { "source_iface": "xe-0/0/13", "target_iface": "bond0" }, "metrics": { "delta_bps": 5000000000 } } },
      { "data": { "id": "e4", "type": "network-flow", "source": "node-w-11", "target": "ingest-7d9c",
                  "labels": { "source_iface": "veth3a1f" }, "metrics": { "delta_bps": 8000000000 } } },
      { "data": { "id": "e5", "type": "network-flow", "source": "node-w-11", "target": "kafka-2",
                  "metrics": { "delta_bps": 3500000000 } } }
    ]
  }
}
```

storage 最小例（`parent` 鏈、read／write 兩條帶、status、usage）；完整版是 `samples/storage.json`——參考面板的 demo fixture 原封不動，
含 FlexGroup（從 SVM 起頭）、split 歸因、未排程 pod、沒有 application 的 pod、三種 alert 形狀、未判定 status 的 SVM：

```json
{
  "elements": {
    "nodes": [
      { "data": { "id": "ns/prod", "type": "namespace", "name": "prod" } },
      { "data": { "id": "app/mongodb", "type": "application", "name": "mongodb", "parent": "ns/prod" } },
      { "data": { "id": "netapp/aggr1", "type": "netapp-aggr", "name": "aggr1", "status": "warning",
                  "usage": { "used_bytes": 700000000000, "capacity_bytes": 1000000000000 },
                  "labels": { "ontap_cluster": "ontap-prod" } } },
      { "data": { "id": "netapp/svm_shop", "type": "netapp-svm", "name": "svm_shop", "labels": { "ontap_cluster": "ontap-prod" } } },
      { "data": { "id": "pvc/data-mongo-0", "type": "pvc", "name": "data-mongo-0", "status": "normal", "labels": { "namespace": "prod" } } },
      { "data": { "id": "pod/mongo-0", "type": "pod", "name": "mongo-0", "status": "normal", "parent": "app/mongodb" } }
    ],
    "edges": [
      { "data": { "id": "sf-1", "type": "storage-flow", "source": "netapp/aggr1", "target": "netapp/svm_shop",
                  "labels": { "tier": "aggr-svm" }, "metrics": { "read_bytes_per_sec": 5505024, "write_bytes_per_sec": 1048576 } } },
      { "data": { "id": "sf-2", "type": "storage-flow", "source": "netapp/svm_shop", "target": "pvc/data-mongo-0",
                  "labels": { "tier": "svm-pvc" },
                  "metrics": { "read_bytes_per_sec": 5505024, "write_bytes_per_sec": 1048576,
                               "read_latency_us": 830, "write_latency_us": 1200, "max_iops": 5000, "max_bytes_per_sec": 104857600 } } },
      { "data": { "id": "sf-3", "type": "storage-flow", "source": "pvc/data-mongo-0", "target": "pod/mongo-0",
                  "labels": { "tier": "pvc-pod" }, "metrics": { "read_bytes_per_sec": 5505024, "write_bytes_per_sec": 1048576 } } }
    ]
  }
}
```

畫出來：`aggr1`（warning 框、usage 副標）→ `svm_shop` → `data-mongo-0` → `mongo-0`（pod 卡）→ `mongodb`（application 卡）→ `prod`（namespace 卡），
每段兩條帶（read `5.51 MB/s` 青、write `1.05 MB/s` 燃橘）；沒有 `investigation` 所以沒有錨卡，`aggr1` 是源頭、左側不畫其他輸入。

### 驗證錯誤對照

載入失敗時會直接印出這些訊息，照著改欄位就好（`nodes[i]`／`edges[i]` 的 i 是陣列索引）：

| 訊息 | 意思 |
| --- | --- |
| 最外層必須是 JSON 物件。 | 檔案最外面是陣列或字串 |
| kind 只能是 "destination" 或 "source"。 | 拼錯 |
| investigation 必須是物件。 | 給了字串或陣列 |
| investigation.node_id 必填。 | 沒給、或給了空字串（舊格式的 `switchId` 要改名） |
| investigation.iface 必填。 | 同上 |
| investigation.delta_bps 必須是正數（bps）。 | 不是數字、是 0、或是負數；別寫成 `"10G"`（舊格式的 `deltaBps` 要改名） |
| investigation.direction 只能是 "in" 或 "out"。 | 拼錯 |
| investigation.node_id「X」在 nodes 裡找不到。 | 起點那台沒有出現在 `nodes`，通常是 id 打錯 |
| investigation.node_id「X」的 type 是 Y，追查起點必須是 hop 型… | 起點指到葉或群組節點 |
| 缺少 elements（必須是物件，含 nodes 與 edges 陣列）。 | 沒有 `elements`——**舊格式（`hops`）會落在這裡** |
| elements.nodes 必須是陣列。／elements.edges 必須是陣列。 | 型別錯 |
| nodes[i] 必須是 { data: {...} } 物件。 | 忘了包一層 `data` |
| nodes[i].data.id 必填（非空字串）。／.type 必填 | 缺 id 或 type |
| nodes[i].data.id「X」重複。 | 同 id 出現兩次——舊格式同一台多次出現要自己合併 |
| nodes[i].data.name 必須是字串。 | 給了數字 |
| nodes[i].data.parent 必須是非空字串。 | 給了空字串或非字串 |
| nodes[i].data.labels 必須是字串對字串的物件。 | labels 裡有數字／布林／巢狀 |
| nodes[i].data.usage 必須是物件。 | 給了數字 |
| nodes[i].data.clients 必須是陣列。 | 給了字串或物件；陣列內認不得的項目則靜默丟棄，不報錯 |
| nodes[i].data.other_in_bps 必須是非負數（bps）。 | 負數或非數字；負殘差會讓色塊算出負高度（`other_out_bps` 同款） |
| edges[i] 必須是 { data: {...} } 物件。 | 忘了包一層 `data` |
| edges[i].data.id／type／source／target 必填（非空字串）。 | 缺欄位 |
| edges[i].data.id「X」重複。 | 邊 id 撞了 |
| edges[i].data.labels 必須是字串對字串的物件。 | 同節點 labels |
| edges[i].data.source「X」在 nodes 裡找不到。 | 對端節點沒列在 `nodes`——舊格式的葉要自己建成節點（`target` 同款） |
| edges[i].data.source「X」是群組節點（type: namespace）… | flow 邊接到群組；群組只能透過 `parent` 鏈表達 |
| edges[i]：「X」（type: host）不是 hop 型節點，畫成追查終止葉卡，不能再有往下走的 flow 邊… | 葉型節點當了上游；要接下去請改用 hop 型 type |
| 圖上沒有任何可畫的節點。 | `nodes` 裡沒有任何 hop 型節點 |

另外有幾種**警告**，不會擋著不畫，會列在圖下方：

- `other_in_bps／other_out_bps 兩個都給了但湊不出平衡式` — 圖照你給的顯式值畫，那台的左右兩疊
  色塊厚度就不會相等。訊息會把兩邊算式攤開、指出哪邊多多少；拿掉其中一個讓平衡式自動補就會守恆
- `邊「e」的 read_bytes_per_sec 是負數` — 該欄視同沒有量測，不畫
- `N 條 flow 邊沒有可用的量測值` — metrics 缺、非數字或屬於 RED 家族，不畫
- `同一張圖混用了 delta_bps（bps）與 read/write_bytes_per_sec（bytes/s）` — 帶寬比例尺跨單位沒有意義
- `X：沒有任何可畫的 flow 邊（no-flow 卡），給了 other_in_bps／other_out_bps 也不畫` — 已歸零
- `只顯示 read 通道：N 條 write 帶不畫` — `channels` 選項的效果，量已併進其他輸入／其他輸出
- `顯示門檻 > …：隱藏 N 條帶` — 見「顯示門檻」
- `拓樸疑似有環` — 欄位順序會不準
- `逆著多數流量方向` — 兩群之間雙向都有流量，總量小的方向畫成回流帶、不參與排欄
- `群組間仍繞成環` — 環繞過三群以上，移除環上流量最小的那個方向破環

### 同層互連（tier）

欄位預設照最長路徑排：每條邊都逼下游至少右一欄。同一層彼此互連時（例如 bdr↔dci 跨 DC），
互連下游的機器會被推到右邊一欄，同一層被拆成兩欄。把同層的節點都標同一個 `labels.tier` 就能鎖回同欄：

- 同 `tier` 的機器整群視為一個節點跑最長路徑，欄位順序仍由拓樸自動推，**不用宣告層級編號**；tier 內部的邊不參與排欄。沒標 `tier` 的節點行為完全不變。
- tier 內部的邊畫成**欄右側的弧帶**（往右凸再折回），厚度與青帶共用同一把比例尺，守恆照常經過。
  它不是另一種狀態，就是一條已追查的帶，只是兩端排在同一欄才改畫成馬蹄形；馬蹄形讀不出方向，
  所以弧的終點端有個**箭頭指流向**。
- 範例見 `samples/dci-tier.json`（`make dev` 的 dev 範例下拉裡叫「同層互連（tier）」）。

## 追查方向

封包方向永遠左到右。不做兩套座標、不左右翻圖。差別只在追查起點釘在哪一側。

| 模式 | 你看的 counter | 下一跳 | 起點位置 | JSON |
| --- | --- | --- | --- | --- |
| 追終點 | 某條 in 增加 | 貢獻大的 out | 最左 | `kind:"destination"` 或 `investigation.direction:"in"` |
| 追來源 | 某條 out 增加 | 貢獻大的 in | 最右 | `kind:"source"` 或 `investigation.direction:"out"` |

兩種模式的邊都一樣照封包方向寫（`source` 上游、`target` 下游）；差別只在追查是順著還是逆著邊走，
以及葉在哪一側（追終點：葉是 `target`；追來源：葉是 `source`）。
同一對節點之間多條邊各自一條帶；同 iface 的多筆量測自動相加。

## 守恆與殘差

每層只跟前 N 名或佔比 ≥ 門檻（例如前 3 名 / ≥ 10%）時：

- **其他輸出**（玫瑰）：這層 focus 增加量裡，沒跟下去的 port（截斷、太小、已滿 N 名）
- **其他輸入**（琥珀）：跟下去的出口／入口總量比剛追進來那條更大（別的上聯、沒追的來源）

同一層可以兩種都有。平衡式：

```
已知 in + 其他輸入 = 已追查 out + 其他輸出
```

`other_in_bps` / `other_out_bps` **不給就由平衡式自動補缺口**，所以最少只要填實際跟到的邊就會守恆。
兩個都給又對不上，圖照顯式值畫並在摘要下方出警告。

兩個例外：

- **源頭不補其他輸入**：一台 hop 一條入邊都沒有（也沒有被門檻／通道藏起來的入邊）、又沒顯式給
  `other_in_bps`，就視為圖的源頭（netapp-node 的流量來自磁碟），左側不畫殘差。只做入側——
  「沒有往下的邊就由平衡式補其他輸出」（k8s 範例的 `node-w-13`：node 當葉）照舊。
- **殘差不拆讀寫**：storage 資料每條邊 read／write 兩條帶，但左右兩疊一起加總，殘差仍是單一色塊。

## 畫法（目前生效的定案）

- 青色長帶＝有跟下去的 uplink／追查路徑，帶寬用**速率增量 Δ**（`delta_bps`），數字帶 `+` 號。
- storage 資料（`read_bytes_per_sec`／`write_bytes_per_sec`）每條邊**兩條帶**：read 沿用青、write 燃橘
  （`#c2410c`），數字是 bytes/s 的絕對速率、不帶號（`5.24 MB/s`）。同欄弧帶的箭頭跟著通道換色；
  回流帶維持玫瑰、不分通道。圖例在有通道時自動換成 read／write 兩色。
- 殘差不進走廊：不畫成穿越別台的長色帶，也不做盒子內底部 chips。
- 殘差貼在該台外側的虛線色塊：其他輸入在左、其他輸出在右；**高度跟 Gbps 等比，
  跟青帶共用同一把比例尺**（`maxVal` 也把殘差算進去），標籤與數量寫在色塊旁。
  這樣「有追查」跟「沒追查」的比例一眼看得出來。
- 殘差是盒子左右 port 疊裡的**真槽位**，跟已追查 port 一起排版。同一台左右兩側的
  **色塊厚度總和完全相等**（守恆等式保證）；但每一列有 24px 最小高度、列間 9px 間距，
  所以**兩疊的總高度不會剛好一樣**——守恆看色塊厚度，不是看疊起來的總高度。
- 小於該台自己讀數誤差（`max(已知 in, 已追查 out) × 0.5% + 1 bps`）的殘差不畫，
  免得浮點雜訊在圖上長出一塊。圖與 hop 摘要用同一個門檻。
- 盒子裡只畫已追查 port，殘差不用斜線填滿整台 switch。
- 追查終止葉節點是灰色虛線小卡（「追查終止」「未再往下追」＋ iface ＋ 帶寬），不是又一台 switch。
  節點帶 `clients` 時右上角改成 `client`／`N 個 client`，卡面改成 `hostname` / `ip` / `owner`
  三欄表格、每台一列全部列出，並省掉合成 id 標題與重複的 iface（見「`clients`」）。
- **`clients` 再依 `owner` 聚合出一欄 owner 卡**（同名全圖合一，沒 owner 的歸「未知 owner」）：
  整張卡同一個 owner 才把量整額帶過去（青色實量帶），一個 port 掛多個 owner 時**量停在 port**、
  只畫灰虛線的歸屬線（不帶量、不印數字）——按台數拆開就是攤分推估。接了 owner 的 port 葉
  左上角改成 `port`。整欄 owner 的欄標題是「追查終止 · owner」。
- k8s 接在同一條 Sankey 上：switch → node（天藍虛線盒）→ pod（天藍虛線中繼卡，標 name 與
  `ns/<namespace>`）→ namespace（ns 色終點卡）。不是每個 switch iface 都接 node；node 可以
  當葉（沒有往下的邊就整台由平衡式補成其他輸出）；pod 沒有 namespace 也合法（不接 ns、沒有色條）。
  node 用同一套截斷，沒跟的 pod 併成該 node 的其他輸出。
- storage 鏈接在同一套畫法上：netapp-node／netapp-aggr／netapp-svm 是虛線設備盒、pvc 實線盒；
  副標多一段 ` · <type>`，有 `labels.ontap_cluster` 再多一段；`usage` 兩欄齊全就在副標下多一行
  「使用 X / Y（N%）」。**`status` 決定外框色**：critical 玫瑰、warning 琥珀（比 root 的青框優先），
  沒有 status 就是中性框。
- **pod 有 `application` 祖先時先接 application 卡**（`parent` 鏈），再由 application 匯進 namespace：
  pod → application → namespace 兩條推導邊都是 pod 自己的量測值的重新分組，不是推估。沒有 application
  的 pod 直接跨到 namespace。整欄 application 的欄標題是「第 N 跳 · application」。
- **no-flow 卡**：列在 `nodes` 但一條可畫的 flow 邊都沒接到的 hop，只畫盒子（沒槽位、沒殘差），
  不會被門檻算成「隱藏 N 台」。
- **每張卡片都有 tooltip**（hover 盒子）：型別／名稱、id、ns、ontap_cluster、已追查 in／out 與殘差、usage、clients、
  status（群組卡標「成員 pod 中最差」）、health、hardware.model、perf 四欄（標 raw，不判定好壞）、alerts
  （`<severity> <name>`）、no-flow 說明——沒有的鍵不出現。帶子 tooltip 在原有欄位之後加 channel、tier、
  attribution、IOPS、延遲、QoS 上限。
- **namespace 是自動推導的終點節點**：每個 pod 卡自動再接一條邊匯進所屬 ns 的終點卡，
  pod → ns 這條邊的值就是 pod 自己的量測 Δ——**同一筆數字的重新分組，不是推估**。
  **全圖同 ns 合一個節點**（跨 node 的 pod 匯流），「這個 ns 總共多少」直接在圖上讀；
  追來源模式鏡像，ns 終點落在最左欄。有往下走的邊的中繼 pod（proxy pod）**不接** ns——
  它的流量已流向自己的下游，再接會重複計量破壞守恆，它的 ns 只是盒副標。
  同 ns 的 pod 在欄內**相鄰排列**、左緣掛同色 ns 色條（色盤 5 色依首次出現順序取用、
  超過循環）；pod 落在不同深度時各 ns 各自落欄，是預期行為。彙總數字在 `summary()`
  的「namespace 流量小計」表（目前 app 沒有顯示這張表）。
- 整欄同一種非 switch 型別時欄標題帶型別名：「第 N 跳 · k8s node」「第 N 跳 · NetApp aggregate」
  「第 N 跳 · SVM」「第 N 跳 · PVC」；整欄都是 pod 卡標「第 N 跳 · pod」；整欄 application 標
  「第 N 跳 · application」；整欄都是 ns 終點標「追查終止 · namespace」；整欄都是 owner 卡標
  「追查終止 · owner」，整欄都是接了 owner 的 port 葉標「第 N 跳 · port」。沒有 `investigation` 時
  第一欄就是「第 0 跳」——編號是相對欄號，不是輸入裡的跳數。
- hop 數字摘要是圖外資訊（`summary()` 回傳 HTML 字串），不是盒子內標籤；目前 app 沒有顯示。
- 圖區是固定尺寸畫布：SVG 填滿容器，`viewBox` 的 meet-fit 就是「符合視窗」，
  縮放平移只改一層 `<g>` 的 `transform`。字級與線寬跟著等比縮放（真幾何縮放）。

## 與參考面板的行為分歧（刻意）

參考面板（kube-state-graph-frontend）的 Storage Flow Sankey 與這裡吃同一份 wire 契約，但畫法上有幾處刻意不同：

- **守恆與殘差**：參考明文禁止 client 端聚合／對帳，上下游對不起來也不警告；我們反過來以守恆為核心。
  參考後端保證每個中間節點逐方向 inflow == outflow，所以 aggr／svm／pvc 的殘差會 ≈ 0；
  加上「源頭不補其他輸入」，參考資料在這邊只會剩下語意正確的殘差。
- **同鍵多條邊相加**：參考不合併；我們相加是超集，安全。
- **`labels.tier` 認不得的邊**：參考整條丟掉；我們照畫（switch 拓樸沒有 tier 詞彙）。
- **其他 type（`host`／`router`）**：參考靜默丟棄；我們畫成灰色「追查終止」葉卡。
- **欄內排序**：參考依流量遞減；我們用拓樸／上游重心，帶子才不互穿。
- **不做的 UI**：app 端的 Read／Write／Both 切換鈕（帶子分兩條，但切換是套件 API `channels`）、
  Flat／Node layout 切換與 k8s node 外框、hover 全路徑高亮、Flow summary 數字表、Locate 跳轉、
  淺色主題、az/env/root scope bar 與 URL 參數、四段式空狀態。

## 檔案

```
Makefile                     跑起來與驗證的入口（make help）
packages/trace-sankey/       npm 套件（零依賴、純 ESM、無 build step）
  src/model.js               驗證、分類節點、加總同鍵的邊、顯示門檻／通道過濾、算殘差
  src/render.js              SVG Sankey、等比殘差色塊、各種卡片、欄標題、hop 摘要（summary）
  src/zoom.js                createZoom()：縮放平移（滾輪定位游標、拖曳、雙指、符合視窗／1:1）
  src/tooltip.js             createTooltip()：帶子與卡片 hover 的 tooltip
  src/mount.js               mount(el, doc, opts)：一行接好整條管線
  src/react.js               <TraceSankey> React 元件（trace-sankey/react）
  src/samples.js             十個內建範例（trace-sankey/samples）；storage 是參考面板的 demo fixture
  styles/trace-sankey.css    圖與 tooltip 的樣式（trace-sankey/style.css）
  types/index.d.ts           TypeScript 型別
app/                         Vite + React 使用端
  src/api.js                 追查 API 的唯一出入口（組 query、fetch、翻譯錯誤）
  src/useTraceDoc.js         資料來源 hook：查詢、abort、契約驗證
  src/TraceQueryBar.jsx      查詢條件表單（七個欄位 + 送出前檢查）
  src/App.jsx                圖、顯示門檻、圖例、縮放工具列的接線
  src/DevSampleBar.jsx       dev 專用的本機資料來源列（內建範例下拉＋選檔）。
                             只被 App 的 import.meta.env.DEV 分支動態載入，不進正式 bundle
electron/                    Electron 測試殼（make electron）：BrowserView 載 nginx，
                             可用環境變數重現各種「host 設錯」的情況。
                             刻意不在 npm workspaces 裡，見 electron/README.md
samples/*.json               範例 JSON（與 samples.js 同一批；make check 會全部 build 一次）。
                             storage.json 原封不動取自 akira-core/kube-state-graph-frontend
                             public/demo/storage-graph.json @ 9e568c7（Apache-2.0）
stress/                      縮放平移的壓力測試資料與產生器（make check 也會 build 它們）
tools/golden.mjs             重構對拍：dump 所有範例輸出，前後 diff -r；check 子命令＝make check
docs/migration-wire-format.md  舊 investigation+hops 格式 → elements 格式的手動遷移指南
Dockerfile                   多階段；--target content = 只有 dist 的小映像（主要），
                             不帶 target = nginx 全包的自足映像（次要）
docker-compose.yml           分離式：content 映像倒進 volume + 官方 nginx（make up）
docker-compose.dev.yml       nginx 直接 bind mount 主機 app/dist（make up-dev）
deploy/conf.d/default.conf   nginx server 區塊：/api/ 反向代理、SPA fallback、快取、gzip
deploy/kustomization.yaml    k8s：ConfigMap 直接讀上面那支 conf，不複製第二份
deploy/k8s/                  k8s Deployment（initContainer 倒內容）與 Service
```

