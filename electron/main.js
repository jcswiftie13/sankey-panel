/* 追查 Sankey 的 Electron 測試殼。
   用途有兩個：
     1. 給未來真正的 host 端當參考實作（BrowserView 指向 nginx 的最小可跑版本）。
     2. 當「host 設錯會怎樣」的測試檯——下面那組環境變數可以刻意重現各種
        我們控制不到的 host 設定，用來驗證 README「被 Electron 鑲嵌時」那一章
        列的因應方式真的有效。

   為什麼這支是 CommonJS，跟 repo 其他地方（純 ESM）不一樣：
   Electron 的文件與範例一律是 CJS，而且日後若要加 preload，sandbox 預設開著的
   preload 只吃 CJS——先統一成 CJS 比之後 ESM/CJS 混用好維護。

   為什麼 electron/ 不進根 package.json 的 workspaces：見 electron/README.md。 */
const { app, BrowserWindow, BrowserView, WebContentsView, session } = require('electron');
const path = require('node:path');

/* ── 開關（全部有預設值，直接 npm start 就是「設定正確的 host」） ───────────── */
const TARGET   = process.env.SANKEY_URL || 'http://localhost:8080';  /* 對齊 Makefile 的 PORT ?= 8080 */
const VIEW_API = (process.env.VIEW_API || 'browserview').toLowerCase();
const GUARD    = (process.env.GUARD    || 'on').toLowerCase();       /* off = 不擋導航（重現拖放跳走） */
const SESSION  = (process.env.SESSION  || 'persist').toLowerCase();  /* temp = 非持久 session */
const CSP      = (process.env.CSP      || 'off').toLowerCase();      /* strict | trusted-types */
const EMBED    = (process.env.EMBED    || 'view').toLowerCase();     /* iframe = 改用 <iframe> 嵌 */

/* 白名單比的是 origin，不是硬編字串：README 已寫明「改 port 就等於換 origin」，
   硬編 http://localhost:8080 會讓 make up PORT=9000 之後整個殼變成一片空白。 */
const ORIGIN = new URL(TARGET).origin;

function originOf(u) {
  try { return new URL(u).origin; } catch (e) { return null; }
}

/* EMBED=iframe 時外殼頁本身是 file://，要放行；其餘一律只准目標 origin */
function allowedUrl(u) {
  if (u.startsWith('file://')) return EMBED === 'iframe';
  return originOf(u) === ORIGIN;
}

/* 注入 CSP：模擬會用 onHeadersReceived 硬加一份 CSP 的 host。
   多份 CSP 在 Chromium 是「每一份都要通過」，所以這裡加的會跟 nginx 送的取交集。 */
const CSP_POLICY = {
  /* 少了 style-src 的 'unsafe-inline'：套件本身不需要它（React 用 CSSOM 設樣式），
     圖與 tooltip 應該正常；被擋的只會是頁面自己的 inline style（若有） */
  strict: "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'",
  /* Trusted Types：套件沒有 innerHTML（SVG 是 React 元件、tooltip 是 portal），圖應該正常——
     這是迴歸測試：圖不見＝套件又用了 innerHTML */
  'trusted-types': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; require-trusted-types-for 'script'",
};

/* ── view 的兩種掛法 ─────────────────────────────────────────────────────────
   BrowserView（Electron 30 起 deprecated，但多數既有 host 還在用）與
   WebContentsView（30+ 的正式替代品）對「被載入的網頁」完全等價：都是獨立的
   top-level WebContents、同一個 origin、發一樣的 HTTP，也都不是 frame。
   兩者都有 setBounds()/webContents，所以外面只需要一份程式碼。 */
function attachView(win, ses) {
  const prefs = {
    session: ses,
    contextIsolation: true,   /* 以下三個都是現行預設值，但這是載入遠端頁面的殼， */
    nodeIntegration: false,   /* 寫出來當契約，免得誰哪天「順手」打開 */
    sandbox: true,
  };
  if (VIEW_API === 'browserview') {
    const view = new BrowserView({ webPreferences: prefs });
    win.setBrowserView(view);
    return { contents: view.webContents, setBounds: b => view.setBounds(b) };
  }
  if (VIEW_API === 'webcontentsview') {
    if (!WebContentsView) throw new Error('WebContentsView 需要 Electron 30 以上');
    const view = new WebContentsView({ webPreferences: prefs });
    win.contentView.addChildView(view);
    return { contents: view.webContents, setBounds: b => view.setBounds(b) };
  }
  /* 不認得的值直接死，不要靜默 fallback——不然你以為在測 A 其實在測 B */
  throw new Error('VIEW_API 只能是 browserview 或 webcontentsview，收到：' + VIEW_API);
}

function load(view) {
  if (EMBED === 'iframe') {
    /* 模擬「host 用 <iframe> 而不是 view 來嵌」：這時 nginx 的
       X-Frame-Options: DENY 就會生效，畫面應該是一片空白 */
    view.contents.loadFile(path.join(__dirname, 'embed.html'), { query: { u: TARGET } });
  } else {
    view.contents.loadURL(TARGET);
  }
}

function createWindow() {
  /* 非持久 session：partition 名稱不以 persist: 開頭就是純記憶體的，
     關掉 app 後 localStorage 與 cookie 全消失。JSON 改由 API 查之後網頁已經
     不寫 localStorage，所以這個開關現在**應該看不出差異**（見 README §4）；
     留著是為了驗證那一點，以及未來加認證 cookie 時重現「每次開 app 都要重登」 */
  const ses = SESSION === 'temp'
    ? session.fromPartition('host-temp-' + Date.now())
    : session.defaultSession;

  if (CSP_POLICY[CSP]) {
    ses.webRequest.onHeadersReceived((details, cb) => {
      cb({ responseHeaders: Object.assign({}, details.responseHeaders, {
        'Content-Security-Policy': [CSP_POLICY[CSP]],
      }) });
    });
  }

  const win = new BrowserWindow({
    width: 1440, height: 900, backgroundColor: '#0b1017',
    title: '追查 Sankey（Electron 測試殼）',
  });
  const view = attachView(win, ses);

  /* bounds 同步：刻意不用 BrowserView 的 setAutoResize()——WebContentsView 沒有
     那個方法，手動做才能讓兩條路徑走同一份程式碼。
     用 getContentBounds() 不是 getBounds()：後者含視窗外框，會多出黑邊。 */
  function fit() {
    const b = win.getContentBounds();
    view.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
  }
  fit();
  win.on('resize', fit);

  const c = view.contents;

  /* 導航白名單。GUARD=off 就是「host 忘了設」的樣子——這正是網頁端那道
     preventDefault 防線的測試條件：GUARD=off 時拖一個 .json 進視窗，**應該什麼都不發生**。
     真的整頁跳去 file://…json 就代表 App.jsx 的拖放 effect 壞了或被刪了（見根 README §1）。
     will-frame-navigate 是給 EMBED=iframe 模式用的（子 frame 不走 will-navigate）。 */
  if (GUARD === 'on') {
    c.on('will-navigate', (ev, url) => { if (!allowedUrl(url)) ev.preventDefault(); });
    c.on('will-frame-navigate', (ev) => { if (!allowedUrl(ev.url)) ev.preventDefault(); });
  }
  c.setWindowOpenHandler(() => ({ action: 'deny' }));

  /* 連不上時給一頁看得懂的說明，而不是 Chromium 的預設錯誤頁。
     errorCode -3 是 ABORTED（正常導航被取代也會發），忽略掉。
     failedFallback 防呆：fallback 頁自己載失敗時不要無限迴圈。 */
  let failedFallback = false;
  c.on('did-fail-load', (ev, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || failedFallback) return;
    failedFallback = true;
    c.loadFile(path.join(__dirname, 'fallback.html'), { query: { u: TARGET, e: desc || String(code) } });
  });
  c.on('did-finish-load', () => { failedFallback = false; });

  /* 焦點在 view 上時鍵盤事件不會走視窗的 Menu，所以用 before-input-event。
     F5 重載的是「目標 URL」而不是 contents.reload()——後者從 fallback 頁只會
     重載 fallback 自己，永遠回不去。 */
  c.on('before-input-event', (ev, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    const key = (input.key || '').toLowerCase();
    if (input.key === 'F5' || (mod && key === 'r')) {
      ev.preventDefault();
      failedFallback = false;
      load(view);
    } else if (input.key === 'F12' || (mod && input.alt && key === 'i')) {
      ev.preventDefault();
      /* 一定要 detach：docked 的 DevTools 會去擠 view 的版面 */
      if (c.isDevToolsOpened()) c.closeDevTools();
      else c.openDevTools({ mode: 'detach' });
    }
  });

  load(view);
  return win;
}

app.whenReady().then(() => {
  console.log('[shell] 目標 =', TARGET,
    '| VIEW_API =', VIEW_API, '| GUARD =', GUARD,
    '| SESSION =', SESSION, '| CSP =', CSP, '| EMBED =', EMBED);
  try {
    createWindow();
  } catch (err) {
    /* 開關給錯就直接退掉。不 catch 的話 Electron 只會印一則
       UnhandledPromiseRejectionWarning、然後留著一個開著的空視窗，
       看起來會像是「網頁壞了」——那是最難查的一種失敗。 */
    console.error('[shell] 啟動失敗：' + err.message);
    app.exit(1);
    return;
  }
  /* macOS：dock 圖示被點且沒有視窗時重開一個 */
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
