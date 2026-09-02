# CLAUDE.md — 給 LLM 的專案說明

這份文件寫給要在本 repo 工作的 LLM。讀完你應該知道：這專案在做什麼、不做什麼、程式怎麼分工、
關鍵演算法在哪、以及動手改東西前必須知道的陷阱。行號會漂移，引用以「檔名 + 函式名」為準。

## 1. 這是什麼

**網路交換器 interface counter 增量的追查視覺化工具**（內部自稱「追查 Sankey / Trace Sankey」；
repo 名 `sankey-panel` 只是倉庫名）。使用情境：你在某台 switch 的某條 interface 上看到流量速率
增加了 Δ bps，逐跳追查這股增量從哪來／往哪去，把追查結果記成一份規範格式的 JSON，本工具把它
畫成一張**守恆的 Sankey 圖**。

核心平衡式（每台 switch 都成立）：

```
已知 in ＋ 其他輸入 ＝ 已追查 out ＋ 其他輸出
```

背景：一跳可能有多條 uplink，下游看到的 out 增加可以大於你追進來的那條 in（A→B 10G、B→C 20G）。
多出來的量不是憑空生的，一律用「其他輸入／其他輸出」殘差色塊補齊，讓圖視覺守恆。

**設計哲學（貫穿整個 git 史）**：圖上只放**實際量測值**，不放任何推估。曾經有「可歸因」欄
（按比例攤分推算多少量能歸到追查起點），因為真實流量沒有等比攤分的性質、且推估值跟實際值
在圖上分不出來，已整個移除（commit `5499b24`）。所有數字是「速率的差」，顯示一律帶 `+` 號
（`fmtDelta`），避免被誤讀成當下吞吐量。

**明確不做**（README）：不自動偵測 switch/counter、不掃網、無帳號無資料庫、追來源不做
左右鏡射、殘差不畫成穿越全圖的 sink 河、未追對端不畫成完整 switch 盒。`pruning` 欄位只是
註記，工具**不會**幫使用者截斷資料。（規劃中：前後端分離後追查 JSON 改由 API 提供；
目前 app 還是吃內建範例，接點標在 `app/src/App.jsx` 的 TODO。）

## 2. 架構與技術棧

npm workspaces monorepo-lite，三個部分：

- **`packages/trace-sankey/`——核心套件**。零依賴、純 ESM、**無 build step**（package.json 的
  exports 直接指 `src/`）。`build()`/`render()` 是純函式（`render(model)` 回傳 SVG 字串、
  無任何 DOM 量測），Node 也能跑（SSR 安全）；`mount()`/`createZoom()`/`createTooltip()`
  需要瀏覽器。**沒有 d3、沒有任何第三方**；SVG 是字串陣列 `out.push('<path .../>')` 拼起來。
  程式風格沿用手寫 ES5（`var`、`function`，唯 import/export 是 ESM），改碼請維持。
  react 是 optional peerDependency，只有 `trace-sankey/react` 子路徑會載到。
- **`app/`——Vite + React 使用端**。只有「圖 + 顯示門檻」加圖例與縮放工具列；全部接線都在
  `App.jsx` 一支。`npm install`（repo 根目錄）後 `make dev` 或 `npm run dev --workspace app`。
  開發時 Vite 直接吃套件 src/（workspace symlink），改套件存檔即熱更新，**沒有 ?v= 快取紀律了**。
- **`tools/trace_sankey.py`——Python CLI**。與 model.js 邏輯一一鏡像，只需要 python3
  （`--plotly` 是唯一可選相依；語法需 3.10+）。Mermaid 匯出現在**只有 CLI 有**
  （網頁版 exports.js 已隨舊靜態頁移除）。

全專案文件、UI、JS 註解為**繁體中文**；Python CLI 訊息為英文。深色主題。
Makefile：`make dev`（=`serve`）/ `draw FILE=x.json` / `mermaid KIND=sankey|flow` /
`html`（plotly）/ `check`（跑遍 samples/*.json）/ `golden DIR=…`（對拍 dump）/ `clean`。

## 3. 目錄結構

```
packages/trace-sankey/
  package.json            exports："."（主入口）、"./react"、"./samples"、"./style.css"
  src/model.js            JSON 驗證 → 合併 hop → 建邊（含顯示門檻）→ 排欄/破環 → 殘差
  src/render.js           版面計算 + SVG 字串組裝 + hop 摘要表（summary；app 目前沒用）
  src/zoom.js             createZoom() 工廠：縮放平移（只改 <g class="zoom-layer"> 的 transform）
  src/tooltip.js          createTooltip()：tooltip 元素掛 body、對 .band 綁 hover
  src/mount.js            mount(el, doc, opts)：build → render → zoom → tooltip 接成一個實例
  src/react.js            <TraceSankey> 薄殼（純 JS createElement，不用 JSX → 套件不需 build）
  src/samples.js          9 個內建範例（純資料；最後一個 dci-uturn 是 IIFE 程式化產生）
  src/index.js            主入口 re-export
  styles/trace-sankey.css 圖表與 tooltip 樣式；CSS 變數 scope 在 .trace-sankey，不進 :root
  types/index.d.ts        手寫型別（JS 原始碼不轉 TS）
app/                      Vite + React 使用端：App.jsx（全部 UI 接線）、app.css（頁面版面）
samples/*.json            同一批範例的檔案版（CLI 與 make check 用；與 src/samples.js 重複維護，見 §11）
stress/                   縮放平移壓力測試資料 + gen.py。刻意不放 samples/（make check 會 glob 它）
tools/trace_sankey.py     CLI：文字報告 / --mermaid / --plotly / --json；與 model.js 一一鏡像
tools/golden.mjs          對拍工具：dump 所有範例的 render()/summary() 輸出，重構前後 diff -r
Makefile                  入口指令
README.md                 使用說明 + 輸入 JSON 契約 + 驗證錯誤對照表 + 畫法定案
```

沒有 CI、lint、test 框架。**程式註解就是主要文件**：幾乎每個非顯而易見的決策都有中文註解
解釋「為什麼不是別的做法」，改碼時請延續這個慣例。

## 4. 資料流管線

```
doc（app：內建範例，未來從 API fetch）
  → <TraceSankey doc minBps>（react.js）
    → mount(el, doc, {minBps, onModel, onError, onZoom})（mount.js）
      → build(doc, {minBps})     失敗 → onError(errors)，app 畫錯誤 UI；成功 ↓
      → onModel(model)           app 拿去拼圖例、隱藏統計 pill
      → render(model)            SVG 字串 → chart.innerHTML（key 沒變且 svg 還在就跳過）
      → tooltip.bind(chart)      每條 .band 綁 tooltip
      → zoom.attach(el)          綁縮放平移
```

mount `update()` 的重要順序約束（都是 app.js 時代踩過的坑，搬進套件後仍然成立）：

- 重畫判斷 key = `JSON.stringify(doc) + '\n' + minBps`，沒變**且 `chart.querySelector('svg')`
  還在**才沿用既有 SVG（保縮放）。**門檻一定要在鍵裡**，不然改門檻不會重畫；svg 存在檢查
  對應「錯誤後復原」的路徑。
- build 失敗：清空 chart、`zoom.detach()`、`lastKey = null`、呼叫 `onError`。mount **不畫**
  錯誤 UI——文案是使用端的責任。
- 容器要**先有高度再 mount／update**（zoom 的 fit 用容器實際大小算）；尺寸變了呼叫
  `refresh()`。app 用 flex column 讓圖吃滿剩餘高度，所以不再需要舊版量 DOM 的 `sizeChart()`。
- `destroy()` 必須冪等：React StrictMode 開發模式會故意 mount→unmount→mount 一輪。

app 端約束（`App.jsx`）：門檻重畫 debounce 200ms、提示文字不 debounce；`cleanMin()` 把負數／
小數／亂打的字一律當 0。**資料來源整個關在 `useTraceDoc.js`**（POC：開檔＋拖放＋localStorage
續存，沿用舊鍵 `trace-sankey/custom`；壞檔只設 error 不動現有 doc）——未來 iframe 鑲嵌＋
API 取數時只改這個檔（替換法在檔頭註解），App 的圖零改動。開檔 input 的 `value` 每次要清空
（同檔連選兩次也要觸發）；拖放的 `hasFiles`／depth 計數兩個防呆別拆。
舊版 query string／分頁／編輯器仍為移除狀態。

## 5. 輸入 JSON 契約（濃縮版；完整版在 README.md）

單位一律 **bps**（10 Gbps 寫 `10000000000`）。網頁與 CLI 吃同一份契約。

```jsonc
{
  "kind": "destination" | "source",        // 選填；否則看 investigation.direction（out→source）；預設 destination
  "investigation": {                        // 必填
    "switchId": "...",                      // 必填，必須存在於 hops
    "iface": "...", "deltaBps": 1e10,       // 必填；deltaBps > 0
    "direction": "in" | "out", "note": ""   // 選填
  },
  "pruning": { "topN": 3, "minShare": 0.1 },// 選填，純註記
  "hops": [{
    "switchId": "...",                      // 必填；同 id 多次出現 → 合併成一個盒子（hopCount++）
    "label": "...", "role": "node",         // 選填非空字串；繪製只認 "node"(天藍虛線盒)與 "pod"(中繼 pod)，
                                            //   其他值（samples 用 core/border 等當註記）畫成一般 switch
    "namespace": "kube-system",             // role:"pod" 的中繼 hop 必填、其餘選填非空字串
    "tier": "border",                       // 選填非空字串；同 tier 鎖同一欄（見 §6 排欄）
    "otherInBps": 0, "otherOutBps": 0,      // 選填，必須 ≥ 0；不給就由平衡式自動補
    "outputs": [ /* 追終點模式用 */ ],       // port: iface(switch hop 必填；role node/pod 的 hop 可省略，
    "inputs":  [ /* 追來源模式用 */ ]        //   但要給 peerSwitchId/peerId)、deltaBps(必填≥0)、
                                            //   peerSwitchId / peerId、peerIface、peerKind(自由字串，
                                            //   只有 "pod" 有語意→pod 中繼卡＋自動匯進 ns 終點)、
                                            //   namespace(peerKind:"pod" 且對端不在 hops 時必填)
  }]
}
```

對端接不接下去：看 `peerSwitchId`（沒有就 `peerId`）**在 hops 裡找不找得到同 id 的那一跳**——
找得到就接成下一台，找不到就畫成灰色「追查終止」葉卡。`peerIface` 只由 port 自己決定，沒填留空不猜。

範例節點代號都是網路設備角色縮寫：`bdr`=border router、`dci`=DC interconnect、`spn`=spine、
`tor`=top-of-rack、`core`/`agg`/`edge`=核心/匯聚/接入層、`fw`=防火牆。iface 命名照 Juniper 慣例
（`et-*`=100/40G、`xe-*`=10G、`ae0`=LAG）與 Linux（`bond0`、`eno1`）。

兩個 tier 範例的差別：`dci-tier` 全部 hop 同一個 tier → 邊全是同欄 lateral 弧帶、無回流；
`dci-uturn` 分三個 tier 且 dci 層回打 bdr 層 → 觸發多數決回流帶（見下）。

## 6. model.js：`build(doc, opts)` 演算法

匯出：`build` / `validate` / `direction` / `fmtBps` / `fmtDelta` / `gbps`。

`opts.minBps` 是**顯示門檻**（bps）：只留增量**大於**它的帶子，`0`／沒給＝不過濾，行為與沒有這個
功能時逐欄位相同。門檻是使用者在 UI 上調的**顯示**選項，不是資料的一部分——不進 JSON 契約、
不影響 `validate()`；CLI 沒有對應旗標。跟 `pruning.topN/minShare` 是兩件事：那兩個是
「上游已截斷過」的註記，程式從不拿它們過濾。

build 分七步（門檻散在步驟 2、4b、6 三處，用 ★ 標）：

1. **合併 hop**：以 `switchId` 為鍵；port 以 `iface|peer` 為鍵累加 `deltaBps`；`tier` 先到先贏
   （衝突只發警告）；`otherInBps/otherOutBps` 累加。
2. **建邊**：**一律照封包方向左→右**。destination 模式讀 `outputs`、`mkEdge(n, peer)`；
   source 模式讀 `inputs`、`mkEdge(peer, n)`（方向反接，畫布方向不變）。對端不在 hops → `mkLeaf`。
   **pod 葉再自動接一條到 ns 終點節點**（`nsFor`；`kind:'leaf'`+`role:'ns'`、id `ns-N` 流水號、
   全圖同 ns 合一個），pod→ns 邊值＝pod 自己的 deltaBps（重新分組非推估）；source 模式反接
   （ns→pod，ns 落最左）。proxy pod（列進 hops 的 role:"pod"）**不接** ns，接了會重複計量。
   ★ **門檻過濾排在建邊之前**：沒過門檻的 port 直接 `return`，不建邊也不建 leaf——先濾再建才不會
   留下沒有邊的孤兒葉卡；pod 葉的 ns 邊接在建葉之後，所以也一併不生。濾掉的量記進 `dropIn`／
   `dropOut`（destination 記 out 側、source 記 in 側；對端是 hop 才記對端），步驟 6 併回殘差。
3. **錨卡** `__anchor__`：destination 接 root 左邊、source 接 root 右邊；`anchorEdge.isAnchor = true`。
   ★ 錨邊在過濾之後才建，所以**追查起點永遠保留**——濾掉它整張圖就沒有錨了。
4. **掛邊**：`e.id = 'e'+i`，push 進節點的 `outEdges/inEdges`。
   ★ **4b 移除孤立節點**：過門檻後身上一條邊都不剩的整台移除（`order` 過濾 + `delete nodes[id]`，
   名字記進 `filteredNodes`）。**一定要排在步驟 5 之前**：排欄與正規化都吃 `order`，留著不存在的
   節點會多出空欄。leaf 只在留邊時才建、anchor 與 root 都掛著 anchorEdge，所以移掉孤立節點不會
   再孤立出別的，掃一輪就夠。
5. **排欄**（最複雜的區塊，5a–5g）：
   - 每個節點分群：有 `tier` → `'t:'+tier`（整群當超級節點），否則自成一群。
     **群內邊不參與排欄**——這就是「同層互連不被拆成兩欄」的機制。
   - **5a** 聚合群組間每方向總流量 `gflow`。
   - **5b 流量多數決破環**：兩群之間雙向都有流量＝環，總量小的方向整組 `gdropped`（退出排欄，
     畫成回流帶）；平手依 `groupIds` 出現順序決勝（確定性但依賴 hops 順序）。
   - **5c SCC 破殘環**：三群以上的環，用手寫 **Kosaraju**（`sccOf`）找 SCC，反覆移除環上流量
     最小的群組邊。註解說明為何不用 Kahn：「光看排不進誰會把環的下游也圈進來，誤刪無辜的邊」。
   - **5d 最長路徑**：破環後的群組 DAG 上 Bellman-Ford 式鬆弛，上限 `groupIds.length+2` 輪。
   - **5e** `e.backward = from.col > to.col`（回流帶）。
   - **5f** `e.lateral = from.col === to.col`（同欄弧帶）。
   - **5g** `subOrder`：tier 群內 Kahn 拓樸排序。**純排版用**（render 靠它把同欄生產者排在
     消費者上面，弧帶才不互穿），不參與任何數值計算。群內有環就照發現順序補完，不警告。
6. **殘差**：`eps = max(in,out)*0.005 + 1`（counter 浮點雜訊門檻，存 `n.resEps`）。
   兩個 other 都給 → 照顯式值畫，gap 超過 eps 只發詳細警告；只給一個 → 另一個由平衡式補；
   都沒給 → 差額全塞給缺的那側。負值在 `validate()` 就擋掉（負殘差會讓 `thick()` 算出負高度破圖）。
   ★ 算之前先把 `dropIn`／`dropOut` **加進顯式的** `otherInBps`／`otherOutBps`。沒顯式給值的
   （`null`）**不要碰**：`tracedIn`／`tracedOut` 已經因為邊被拿掉而變小，平衡式會自動把缺口補成
   殘差；顯式值不加就會誤觸「兩個都給又湊不出平衡式」那則警告。這一步就是門檻仍然守恆的原因。
   殘差色塊本身**不受門檻管**，照舊只看 `resEps`。
7. **正規化欄位**：col 全部減 minCol。

回傳 `{ok, dir, investigation, pruning, minBps, filtered:{edges,bps}, filteredNodes,
nodes, nodeMap, edges, anchorEdge, root, warnings, maxCol}`。門檻濾掉東西時另發一則警告寫出
隱藏了幾條帶、幾台、共多少量。

**render.js 不必為門檻改任何東西**：它吃的是 `model.nodes`／`model.edges`，節點與邊被移除後
自動跟上（CLI 的 Mermaid 輸出沒有門檻，見 §9）。

## 7. render.js：版面與繪製

匯出：`render` / `summary` / `esc`。核心是 `layout(model)`：

- **全圖共用一把比例尺**：`maxVal = max(所有邊, 所有殘差)`，`thick(v) = max(THICK_MIN=3, v * THICK_MAX/maxVal)`，
  `THICK_MAX = 86`。殘差跟青帶同一把尺，比例才讀得出來。
- **殘差門檻** `resIn/resOut`：只有 `> n.resEps` 才畫。**同一門檻三處共用**：render.js 的圖、
  summary 表、CLI（各自有一份實作，要同步改）。注意門檻是「相對該台自己流量」，
  粗細卻是全圖 maxVal 比例——小 hop 的真殘差可能只有 3px，那是對的。
- **backNear** 判定：`backward && from.col - to.col === 1`。只跨一欄的回流走「走廊短帶」：
  out 掛 source **左**緣、in 掛 target **右**緣（相向），用一般 `ribbon` 反向畫；
  跨兩欄以上才繞圖底外圍 lane（`backwardRibbon`，等寬 stroke 路徑，逐條分 lane 錯開）。
- **port 槽位順序**（`leftSlots`/`rightSlots`）：一般邊 → lateral（兩端都掛右緣，弧帶活在欄右
  間隙）→ backNear → 跨多欄回流；**殘差是真槽位，push 在最外側**——`place()` 依順序指派 cy，
  插中間會把下面所有帶子往下推、憑空製造交叉。
- **欄位 y**：先算 `__pref`（跨欄上游 `__cy` 平均）；只被同欄餵的節點沿 `subOrder` 繼承
  lateral 上游的 `__pref`；排序後堆疊，整欄對齊上游重心。
- **三種路徑產生器**：`ribbon`（標準雙貝茲變厚度帶）、`lateralRibbon`（同欄馬蹄弧，凸出量
  `bulge` 依跨距內外圈錯開）、`backwardRibbon`（等寬圓角迴路）。

`render(model)` 的繪製順序＝z-order：defs 漸層（**留在 zoom-layer 外面**）→ `<g class="zoom-layer">`
→ 欄位標題 → **帶（先畫，壓在盒子下）** → 帶上數字 → 盒子 → **殘差色塊（最後畫）**。
每條帶有 `class="band"`（回流加 `band-back`，繞圖底的再加 `band-loop`，同欄加 `band-lat`）、
`data-tip="<JSON>"`（給 tooltip）與原生 `<title>`。lateral 帶另輸出 `.lat-arrow` 三角形指流向——
**必須是 band 的兄弟節點**（包進去會打斷 `.band:hover` 與 tooltip 綁定）且 `pointer-events:none`。
meta 裡 `backward: e.backward || undefined`——stringify 丟掉 undefined，沒回流的圖輸出不變。

**套件的 public 契約**（README 也要記）：render 產出的 `<g class="zoom-layer">` 是 zoom 的
hook；每條 `.band` 上的 `data-tip` JSON 是 tooltip 的資料通道——不掛套件 tooltip 的使用者
可以自己讀它。改這兩個等於改對外 API。

## 8. zoom / mount / react / CSS 關鍵決策（改壞會回退歷史 bug）

- **hover 高亮純靠 CSS**（`.band:hover` 換 fill；`band-loop` 因 `fill:none` 改加深 stroke）。
  **JS 只管 tooltip**。不要改回 JS 換色——mouseleave 沒觸發（觸控、游標衝出視窗、拖曳吃事件）
  帶子就永久卡在高亮色（commit `4a752b9` 修過）。
- zoom **只改 `<g class="zoom-layer">` 的 transform**；listener 只綁一次在容器
  （不會被重畫掉的元素），每次 `attach()` 只抽換內部狀態 `st`，否則重畫一次疊一組 listener。
  同一 layer 重 attach 沿用縮放；換了圖才 `initial()`＝fit 但**絕不放大超過 1:1**。
  放大上限用「螢幕實際倍率」不是相對 fit（超大圖 fit 可能只有 0.17%）。
  `ctm()` 有兩個 null 防護：容器 `display:none` 時 `getScreenCTM()` 是 null；寬高 0 時 `a=0`。
  **工廠版新增的責任**：`createZoom()` 一個實例管一個容器，`dispose()` 必須把 wrap 上五個
  pointer/wheel listener 與 window resize 全解掉——React StrictMode 的雙重掛載就是現成的測法。
- **tooltip 元素掛在 `document.body`**（`position:fixed`）：掛進圖的容器會被 `overflow:hidden`
  裁掉。`mount.destroy()` 要把它移掉，不然 StrictMode 會在 body 累積孤兒元素。
- **專注模式刻意不用 Fullscreen API**：tooltip 在容器外，全螢幕只繪製該子樹會讓 tooltip 消失。
  用 `body.chart-focus` class 純 CSS 實作（在 app 端）。
- **顏色是雙份定義**：`styles/trace-sankey.css` 的 CSS 變數（scope 在 `.trace-sankey`，
  `--cyan #22d3ee`、`--amber #f59e0b`、`--rose #fb7185`、`--gray #94a3b8`）與 render.js
  字串裡的硬編碼十六進位（漸層 defs）**沒有連動**。改配色要多處一起改；app/src/app.css 的
  頁面色票是第三份（圖例會用到同色）。SVG 只有 text 用 class。
- `.trace-sankey .chart svg{display:block;width:100%;height:100%}` 是 fit 計算的隱性前提；
  `.chart svg text{pointer-events:none}`——帶上數字不能擋 hover。這兩條在套件 CSS 裡，別動。
- react.js：callback props 存 ref（identity 變了不重掛）；`useImperativeHandle` 回傳的是
  轉呼叫殼，因為它跑在 mount effect 之前、當下實例還是 null。
- 快捷鍵（app 端）：`+`/`-` 縮放、`0` fit、`1` 1:1、`f` 專注、`Esc` 離開；在輸入框內不攔。

## 9. Python CLI（tools/trace_sankey.py）

與 model.js **一一鏡像**（合併→建邊→錨→排欄含多數決+SCC→殘差），差異：英文訊息、無 subOrder
（那是純排版用）、**無顯示門檻**（那是網頁 UI 的顯示選項，不是資料處理；`minBps=0` 時
model.js 的輸出與沒有門檻時逐欄位相同，殘差算式仍然等價，所以這邊不必跟）。用法：`trace_sankey.py FILE`（文字報告）、`--mermaid sankey|flow`、
`--plotly out.html`、`--json`（印解好的模型）、`-` 讀 stdin；warnings 一律進 stderr。

**Mermaid sankey-beta 畫不了環**：回流邊降級成 `%%` 註解——Mermaid Sankey 輸出會遺失回流量、
不守恆，這是已知限制不是 bug。flowchart 輸出則保留回流邊。（Mermaid 匯出只在 CLI；
網頁版的 exports.js 已隨舊靜態頁移除，要復活去 git 歷史挖。）

## 10. 開發慣例與驗證

- Commit message 慣例：先寫「為什麼舊做法是錯的」再寫改法（繁體中文）。
- 重構的驗證黃金標準：**既有 samples 的輸出 byte-identical**。工具是 `tools/golden.mjs`：
  改前 `node tools/golden.mjs dump /tmp/a`、改後 dump `/tmp/b`、`diff -r`——它會把所有範例
  （內建 + samples/ + stress/）的 `render()`/`summary()` 輸出各跑 minBps 0 與 5e8 兩組。
  另跑 `make check`（Python CLI 是獨立鏡像，順便當迴歸哨兵）；互動行為用 playwright 對
  dev server 實測（含 StrictMode 下 body 只留一個 tooltip、同值 update 不洗縮放）。
- 「守恆」的定義：同一台左右兩側**色塊厚度總和**相等。但每列有最小高度 `ROW_H 24` 與間距
  `ROW_GAP 9`，**兩疊的視覺總高度不會剛好一樣——這是預期行為，不是 bug**（最常被誤報的點）。

## 11. 已知怪癖與陷阱（動手前必讀；均為現況陳述，除非被要求不要修）

1. **`samples/*.json` 與 `packages/trace-sankey/src/samples.js` 是重複維護的同一批資料**：
   網頁只讀 samples.js，CLI/make check 只讀 samples/。改一邊忘了另一邊不會有任何警告。
2. 顯式給了 `otherInBps` 和 `otherOutBps` 但湊不出平衡式時，圖照顯式值畫、該台不守恆，只警告不擋。
   顯示門檻濾掉的量會**先加進這兩個顯式值再比對**，所以開門檻不會憑空生出這則警告。
3. `role` 是**刻意的自由字串**（只驗「給了就非空字串」）：繪製只認 `'node'` 與 `'pod'`，其他值
   （samples 實際用了 `core`/`border`/`spine`/`tor` 當註記）一律當一般 switch 畫、不發警告
   （內建範例自己就會觸發，警告會變噪音）。
4. 多數決平手時依 hops 陣列出現順序決勝；tier 衝突先到先贏；port 合併時 peerKind/namespace
   衝突也採先到值（有警告）——結果依賴輸入順序（但確定性）。
5. **ns 分組與 ns 終點只作用於 pod 卡**（`kind:'leaf' && role:'pod'`；validate 保證它必有 ns）：
   render 的欄內排序讓同 ns 相鄰、槽位跟著對端 y 重排（node 與 ns 終點兩側都重排）；
   pod 流量自動匯進 `role:'ns'` 的終點節點（見 §6 步驟 2）。中繼 pod（列進 hops）的 ns
   只是盒副標、不接 ns 終點。ns 色盤 5 色依首次出現順序取用、超過循環，
   同一份 JSON 內顏色穩定、跨檔案不保證。
6. `colCaption` 用 `col[0].col` 印「第 N 跳」，destination 模式下 anchor 佔 col 0，
   第一台 switch 顯示「第 1 跳」——編號不從 0 開始。source 模式 ns 終點佔 col 0 時，
   pod 欄從「第 1 跳」起算——同樣是相對欄號、不是輸入裡的跳數。
7. 規模上限：`stress/05-huge.json`（1365 台、5.4 萬個 SVG 元素）滾輪每格約 130ms；
   超深樹會把幾千個葉直堆成一欄（viewBox 高 42 萬）。要撐這種量需要視野裁剪（未做）。
8. **顯示門檻是「大於」不是「大於等於」**：`deltaBps` 剛好等於門檻的帶子會被濾掉。門檻只作用於
   hop 的 port，`pod → ns` 那條沿用 pod 自己的值（已經過門檻了）、錨邊完全豁免，兩者都不列入
   「隱藏了幾條帶」的計數。門檻是看圖的設定不是資料的設定：不進 JSON 契約、不影響 validate。
9. **npm 的 `.npm/_cacache` 曾有 root 擁有的舊檔**（本機環境問題）：`npm install` 若 EACCES，
   用 `npm install --cache <別的目錄>` 繞過，或 `sudo chown -R 501:20 ~/.npm` 永久修。
10. `summary()`（hop 摘要表）還在 render.js 照常匯出並被 golden 對拍，但目前 app 沒有使用——
    是刻意保留的 API，不是死碼。
