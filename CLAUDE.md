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

**明確不做**（`index.html` 畫法說明第 6 節、README）：不自動偵測 switch/counter、不掃網、
無帳號無資料庫無後端、不上傳 JSON（`FileReader` 純本機讀，存 `localStorage`）、追來源不做
左右鏡射、殘差不畫成穿越全圖的 sink 河、未追對端不畫成完整 switch 盒。`pruning` 欄位只是
註記，工具**不會**幫使用者截斷資料。

## 2. 技術棧與硬性約束

- **零依賴、零 build step**。純手寫 ES5 風格 JS（`var`、IIFE、`'use strict'`），六支傳統
  `<script>` 依序載入（`index.html` 底部）：samples → model → render → zoom → exports → app。
  **刻意不用 ES module、不用 fetch**，為了 `file://` 直接開也能用。改碼請維持這個風格。
- **沒有 d3、沒有任何第三方**。SVG 是字串陣列 `out.push('<path .../>')` 拼起來 `innerHTML` 進去。
- 全域命名空間：`window.TraceModel` / `TraceRender` / `TraceZoom` / `TraceExports` / `TraceSamples`。
- **快取紀律**：`index.html` 所有資源網址帶 `?v=N`（目前 `?v=2`）。**改完 js/css 必須手動把
  版本號 +1**（file:// 沒有 header 可送，這是唯一手段）。dev server 一律用
  `tools/serve.py`（每個回應 `no-store` 並砍掉條件式請求 header，永不回 304）；
  **不要**用 `python -m http.server`，它會讓瀏覽器沿用舊 JS（commit `489ba89` 修過的坑）。
- 唯一相依是 `python3`（標準函式庫）；CLI 的 `--plotly` 是唯一可選相依。本機為 Python 3.14，
  CLI 語法需 3.10+（`str | None`）。
- 全專案文件、UI、JS 註解為**繁體中文**；Python CLI 訊息為英文。深色主題。
- Makefile：`make serve`（127.0.0.1:8765）/ `open` / `demo`（file://）/ `draw FILE=x.json` /
  `mermaid KIND=sankey|flow` / `html`（plotly）/ `check`（跑遍 samples/*.json）/ `clean`。

## 3. 目錄結構

```
index.html            單頁應用：版面 + 五個分頁（圖 / JSON / Mermaid Sankey / Mermaid Flowchart / 畫法說明）
assets/css/app.css    全部樣式：CSS 變數色票、SVG text class、hover 高亮、圖例、響應式
assets/js/samples.js  8 個內建範例（純資料；最後一個 dci-uturn 是 IIFE 程式化產生）
assets/js/model.js    JSON 驗證 → 合併 hop → 建邊 → 排欄/破環 → 殘差    → TraceModel
assets/js/render.js   版面計算 + SVG 字串組裝 + hop 摘要表               → TraceRender
assets/js/zoom.js     縮放平移（只改 <g class="zoom-layer"> 的 transform）→ TraceZoom
assets/js/exports.js  Mermaid sankey-beta / flowchart 匯出                → TraceExports
assets/js/app.js      UI 接線：query string 狀態、分頁、開檔/拖放、編輯器、tooltip、快捷鍵
samples/*.json        同一批範例的檔案版（CLI 與 make check 用；與 samples.js 重複維護，見 §9）
stress/               縮放平移壓力測試資料 + gen.py 產生器。刻意不放 samples/（make check 會 glob 它）
tools/serve.py        no-cache dev server（存在理由見 §2）
tools/trace_sankey.py CLI：文字報告 / --mermaid / --plotly / --json；與 model.js 邏輯一一鏡像
Makefile              入口指令
README.md             使用說明 + 輸入 JSON 契約 + 驗證錯誤對照表 + 畫法定案
```

沒有 package.json、node_modules、CI、lint、test 框架。**程式註解就是主要文件**：幾乎每個
非顯而易見的決策都有中文註解解釋「為什麼不是別的做法」，改碼時請延續這個慣例。

## 4. 資料流管線

```
JSON（FileReader / localStorage / samples.js）
  → app.js currentDoc()
  → TraceModel.build(doc)        失敗 {ok:false, errors} → 印在圖區；成功 → model
  → TraceRender.render(model)    SVG 字串 → chart.innerHTML
  → TraceRender.summary(model)   hop 數字表 + warnings → 圖下方
  → TraceExports.mermaid*(model) 兩個 <pre>
  → TraceZoom.attach(chartWrap)  綁縮放平移
  → app.js bindTips()            每條 .band 綁 tooltip
```

app.js `draw()` 的重要順序約束：
- `lastKey`（`state.sample + '\n' + raw`）沒變就**不重畫 SVG**，切分頁回來才保得住縮放狀態。
- `sizeChart()` **一定要在 `Z.attach()` 之前**呼叫——fit 需要用圖區的最終高度計算。
- 圖畫不出來時走 `chartGone()`：`Z.detach()` + 收縮放工具列 + `lastKey = null`。
- UI 狀態 = query string（`?sample=&tab=`），控制項是真 `<a href>`（無 JS 也能切換）；
  document 層攔 click 後 `history.pushState`。縮放狀態**刻意不進** query string。
- localStorage 鍵：`trace-sankey/custom`（原始 JSON 文字）、`trace-sankey/custom-name`
  （檔名；有檔名＝從檔案載入、沒有＝編輯器貼上）。開檔與編輯器共用 `applyRaw()` 同一條驗證路徑。

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
    "label": "...", "role": "switch|node|pod",  // 選填；role:"node" 畫虛線盒（k8s node）、"pod" 是葉
    "tier": "border",                       // 選填非空字串；同 tier 鎖同一欄（見 §6 排欄）
    "otherInBps": 0, "otherOutBps": 0,      // 選填，必須 ≥ 0；不給就由平衡式自動補
    "outputs": [ /* 追終點模式用 */ ],       // port: iface(必填)、deltaBps(必填≥0)、
    "inputs":  [ /* 追來源模式用 */ ]        //       peerSwitchId / peerId、peerIface、peerKind、namespace
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

## 6. model.js：`TraceModel.build(doc)` 演算法

匯出：`build` / `validate` / `direction` / `fmtBps` / `fmtDelta` / `gbps`。build 分七步：

1. **合併 hop**：以 `switchId` 為鍵；port 以 `iface|peer` 為鍵累加 `deltaBps`；`tier` 先到先贏
   （衝突只發警告）；`otherInBps/otherOutBps` 累加。
2. **建邊**：**一律照封包方向左→右**。destination 模式讀 `outputs`、`mkEdge(n, peer)`；
   source 模式讀 `inputs`、`mkEdge(peer, n)`（方向反接，畫布方向不變）。對端不在 hops → `mkLeaf`。
3. **錨卡** `__anchor__`：destination 接 root 左邊、source 接 root 右邊；`anchorEdge.isAnchor = true`。
4. **掛邊**：`e.id = 'e'+i`，push 進節點的 `outEdges/inEdges`。
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
7. **正規化欄位**：col 全部減 minCol。

回傳 `{ok, dir, investigation, pruning, nodes, nodeMap, edges, anchorEdge, root, warnings, maxCol}`。

## 7. render.js：版面與繪製

匯出：`render` / `summary` / `esc`。核心是 `layout(model)`：

- **全圖共用一把比例尺**：`maxVal = max(所有邊, 所有殘差)`，`thick(v) = max(THICK_MIN=3, v * THICK_MAX/maxVal)`，
  `THICK_MAX = 86`。殘差跟青帶同一把尺，比例才讀得出來。
- **殘差門檻** `resIn/resOut`：只有 `> n.resEps` 才畫。**同一門檻三處共用**：render.js、
  exports.js（各自有一份實作，要同步改）、summary 表。注意門檻是「相對該台自己流量」，
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

## 8. zoom.js / app.js / CSS 關鍵決策（改壞會回退歷史 bug）

- **hover 高亮純靠 CSS**（`.band:hover` 換 fill；`band-loop` 因 `fill:none` 改加深 stroke）。
  **JS 只管 tooltip**。不要改回 JS 換色——mouseleave 沒觸發（觸控、游標衝出視窗、拖曳吃事件）
  帶子就永久卡在高亮色（commit `4a752b9` 修過）。
- zoom **只改 `<g class="zoom-layer">` 的 transform**；listener 只綁一次在 `.chart-wrap`
  （不會被重畫掉的元素），每次 `attach()` 只抽換內部狀態 `st`，否則重畫一次疊一組 listener。
  同一 layer 重 attach（切分頁回來）沿用縮放；換圖才 `initial()`＝fit 但**絕不放大超過 1:1**。
  放大上限用「螢幕實際倍率」不是相對 fit（超大圖 fit 可能只有 0.17%）。
  `ctm()` 有兩個 null 防護：分頁 `display:none` 時 `getScreenCTM()` 是 null；容器寬高 0 時 `a=0`。
- **專注模式刻意不用 Fullscreen API**：`#tooltip` 在 `.chart-wrap` 外，全螢幕只繪製該子樹會讓
  tooltip 消失。用 `body.chart-focus` class 純 CSS 實作。
- **顏色是雙份定義**：`app.css` 的 CSS 變數（`--cyan #22d3ee`、`--amber #f59e0b`、
  `--rose #fb7185`、`--gray #94a3b8`、`--bg #0b1017`）與 render.js/exports.js 字串裡的硬編碼
  十六進位**沒有連動**。改配色要多處一起改。SVG 只有 text 用 class。
- `.chart svg text{pointer-events:none}`——帶上數字不能擋 hover。
- 快捷鍵（chart 分頁）：`+`/`-` 縮放、`0` fit、`1` 1:1、`f` 專注、`Esc` 離開；在輸入框內不攔。

## 9. Python CLI（tools/trace_sankey.py）

與 model.js **一一鏡像**（合併→建邊→錨→排欄含多數決+SCC→殘差），差異：英文訊息、無 subOrder
（那是純排版用）。用法：`trace_sankey.py FILE`（文字報告）、`--mermaid sankey|flow`、
`--plotly out.html`、`--json`（印解好的模型）、`-` 讀 stdin；warnings 一律進 stderr。

**Mermaid sankey-beta 畫不了環**：回流邊在 exports.js 與 CLI 都降級成 `%%` 註解——
Mermaid Sankey 輸出會遺失回流量、不守恆，這是已知限制不是 bug。flowchart 輸出則保留回流邊。

## 10. 開發慣例與驗證

- Commit message 慣例：先寫「為什麼舊做法是錯的」再寫改法（繁體中文）。
- 重構的驗證黃金標準：**既有 samples 的輸出 byte-identical / 節點座標逐字元相同**
  （常用 CLI `--json` 對拍）；跑 `make check`；互動行為用 playwright 實測。
- 「守恆」的定義：同一台左右兩側**色塊厚度總和**相等。但每列有最小高度 `ROW_H 24` 與間距
  `ROW_GAP 9`，**兩疊的視覺總高度不會剛好一樣——這是預期行為，不是 bug**（最常被誤報的點）。

## 11. 已知怪癖與陷阱（動手前必讀；均為現況陳述，除非被要求不要修）

1. **`samples/*.json` 與 `assets/js/samples.js` 是重複維護的同一批資料**：網頁只讀 samples.js，
   CLI/make check 只讀 samples/。改一邊忘了另一邊不會有任何警告。
2. 顯式給了 `otherInBps` 和 `otherOutBps` 但湊不出平衡式時，圖照顯式值畫、該台不守恆，只警告不擋。
3. `role` 欄位**沒有被驗證**：render 只認 `'node'`（虛線盒）與 `'pod'`，其他值（samples 實際用了
   `core`/`border`/`spine`/`tor`）一律當一般 switch 畫。README 說 role 是 switch|node|pod，與實情不符。
4. 多數決平手時依 hops 陣列出現順序決勝；tier 衝突先到先贏——結果依賴輸入順序（但確定性）。
5. `model.js` `mkLeaf` 裡有個死三元式：`(d === 'destination' ? p.iface : p.iface)` 兩分支相同。
6. `colCaption` 用 `col[0].col` 印「第 N 跳」，destination 模式下 anchor 佔 col 0，
   第一台 switch 顯示「第 1 跳」——編號不從 0 開始。
7. 規模上限：`stress/05-huge.json`（1365 台、5.4 萬個 SVG 元素）滾輪每格約 130ms；
   超深樹會把幾千個葉直堆成一欄（viewBox 高 42 萬）。要撐這種量需要視野裁剪（未做）。
8. `app.js` 以 `setCode('')` 靠 falsy 走清空分支（參數名其實是 `model`），可讀性差但是刻意的現狀。
