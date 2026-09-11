# Electron 測試殼

用 `BrowserView`（或 `WebContentsView`）把 nginx 上的追查 Sankey 載進一個 Electron 視窗。

兩個用途：

1. **參考實作**——未來真正的 host 端要怎麼寫，看 [`main.js`](main.js) 就好。
2. **測試檯**——host 端的設定我們控制不到，這裡用環境變數把「host 設錯」的各種情況
   直接重現出來，用來驗證 [根 README 的「被 Electron 鑲嵌時」](../README.md) 那一章
   列的因應方式真的有效。

## 跑起來

```sh
cd electron && npm install     # 只需要一次；會抓 Electron 執行檔（約 100MB+）
make electron                  # 在 repo 根目錄跑，會自動帶上 SANKEY_URL
```

或直接 `npm start`（預設目標 `http://localhost:8080`）。**要先 `make up` 把 nginx 起起來**，
不然會看到 fallback 頁；起好之後在視窗裡按 `F5` 就會載進來。

⚠️ **在 VS Code 的整合終端機裡跑會沒有視窗**：VS Code 自己是 Electron，會把
`ELECTRON_RUN_AS_NODE=1` 傳給子行程，Electron 的執行檔就會退化成一個普通的 Node
（`electron --version` 會印出 Node 的版本而不是 v44.x）。`make electron` 已經用
`env -u ELECTRON_RUN_AS_NODE` 擋掉了；直接跑 `npm start` 的話要自己加：

```sh
env -u ELECTRON_RUN_AS_NODE npm start
```

第一次 `npm install` 若遇到 `~/.npm/_cacache` 的 EACCES（本機環境的舊問題），
用 `npm install --cache /tmp/npm-cache` 繞過，或 `sudo chown -R 501:20 ~/.npm` 永久修。

快捷鍵：`F5` / `Cmd+R` 重載目標 URL、`F12` 開 DevTools（獨立視窗）。

## 開關

全部有預設值，什麼都不設就是「一個設定正確的 host」。

| 環境變數 | 值 | 模擬的 host 設定 | 預期看到 |
|---|---|---|---|
| `SANKEY_URL` | 任意 URL | host 指到哪 | 預設 `http://localhost:8080` |
| `VIEW_API` | `browserview`（預設）/ `webcontentsview` | 用舊 API 還是新 API | **兩者行為應完全一致** |
| `GUARD` | `on`（預設）/ `off` | 有沒有設 `will-navigate` 白名單 | `off` 時拖 `.json` 進去**應該什麼都不發生**（網頁端自己擋）；真的跳成 `file://` 就是網頁的防線壞了 |
| `SESSION` | `persist`（預設）/ `temp` | 是不是用非持久 session | 現在**應無差異**（網頁不再寫 localStorage）；留著驗這點與未來的 cookie |
| `CSP` | `off`（預設）/ `strict` / `trusted-types` | host 用 `onHeadersReceived` 注入 CSP | 兩者**圖都應正常**（套件沒有 innerHTML、樣式走 CSSOM）；圖不見就是套件回歸 |
| `EMBED` | `view`（預設）/ `iframe` | host 用 view 還是 `<iframe>` | `iframe` 時被 `X-Frame-Options: DENY` 擋成空白 |

例：

```sh
GUARD=off npm start                       # 驗網頁端的拖放防線（拖 .json 進去應該沒反應）
VIEW_API=webcontentsview npm start        # 驗證換 API 對網頁端零影響
CSP=trusted-types npm start               # 驗證 Trusted Types 下圖照畫（套件沒有 innerHTML）
EMBED=iframe npm start                    # 重現 iframe 被擋
SANKEY_URL=http://127.0.0.1:8080 npm start  # 不同 origin（同源 /api/ 代理仍然生效）
```

## 為什麼 `electron/` 不在 npm workspaces 裡

根 [`Dockerfile`](../Dockerfile) 的 build 階段只 `COPY` 三份 manifest
（root、`app`、`packages/trace-sankey`）就跑 `npm ci`。一旦這個目錄變成 workspace，
`package-lock.json` 會多一個它讀不到的節點、`npm ci` 直接失敗；就算補上 `COPY`，
Electron 的 postinstall 也會在**每次 docker build** 下載上百 MB 的執行檔——
而部署根本不需要它。所以這裡自己 `npm install`，並在 `.dockerignore` 排除。

## 為什麼 `main.js` 是 CommonJS

repo 其他地方是純 ESM，這支刻意不跟：Electron 的文件與範例一律 CJS，
而且日後要加 preload 時，`sandbox` 預設開著的 preload 只吃 CJS。
先統一成 CJS 比之後 ESM/CJS 混用好維護。
