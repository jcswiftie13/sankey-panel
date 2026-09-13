# trace-sankey

網路交換器 interface counter 增量／儲存 I/O 流量的追查 Sankey 圖。吃一份 cytoscape-style 的
wire JSON（`elements.nodes / elements.edges`），畫成每台都守恆的 Sankey：

```
已知 in ＋ 其他輸入 ＝ 已追查 out ＋ 其他輸出
```

圖上只放實際量測值，不做任何推估攤分。輸入 JSON 的完整契約與驗證錯誤對照表見
repo 根目錄的 README「輸入 JSON 規格」。

## 安裝

```sh
npm install trace-sankey react react-dom
```

peer：`react`、`react-dom` `>= 18`。TypeScript 型別隨套件出貨（`dist/*.d.ts`）。

## 用法

```jsx
import { TraceSankey } from 'trace-sankey/react';
import 'trace-sankey/style.css';

<TraceSankey
  ref={ref}
  doc={wireJson}          // 必填：追查 JSON
  minBps={0}              // 顯示門檻（bps）：只留值大於它的帶子；0＝不過濾
  channels="both"         // storage 資料：'both'／'read'／'write'
  layout="flat"           // 'node'：k8s node 外框（pod 欄依所在 node 分區；資料要有 pod-node 邊）
  roots={null}            // 參考面板的 root 選擇 {ontap_cluster,node,aggr,svm,pod}；省略＝no-flow 全保留
  pathHighlight           // hover 卡片亮整條上下游路徑、其餘變淡
  onNodeClick={(id, node) => …}   // 可定位的卡被點到（有給才標成 .clickable）
  focus={false}           // 專注模式：body.chart-focus ＋ 重算縮放
  className="my-chart"    // 容器高度由你的 CSS 決定，元件不設高度
  onModel={model => …}    // 每次 build 成功（拼圖例、警告用）
  onError={errors => …}   // build 失敗（字串陣列；元件不畫錯誤 UI）
  onZoom={scale => …}     // 螢幕實際倍率（1 = 原始大小；量不到時 null）
/>
```

- `ref` 拿到 `{ refresh(), model, zoom: { fit(), actual(), zoomBy(f), refresh(), isPanning() } }`。
  容器尺寸變了呼叫 `refresh()`。`zoomStep`（主入口匯出）是工具列／快捷鍵的一格倍率。沒有 setter：props 驅動。
- 改 `minBps`／`channels`／`layout`／`roots` 縮放保留；換一份**內容不同**的 `doc` 才重新 fit（內容相同的新物件視同沒換）。
- `onNodeClick` 只對可定位的卡回呼（`locatable()`：k8s node 外框、hop 除了 `netapp-svm`、葉 pod），與參考面板的
  Locate 規則相同；namespace／application／owner／錨卡／host 葉不會。
- `focus` 只讓容器去框、加 `body.chart-focus`；你自己的工具列要藏，對那個 class 加規則。
- 沒有 React 框架的頁面一樣用 `createRoot(el).render(<TraceSankey doc={…}/>)` 掛。
- 同一頁可以掛多張，各自的縮放、tooltip、漸層互不干擾。

只要 SVG 字串（Node 也能跑，沒有 DOM 依賴）：

```js
import { build, flowTables } from 'trace-sankey';
import { render, summary } from 'trace-sankey/static';   // 這條子路徑才會載到 react-dom/server
const model = build(wireJson, { minBps: 0, channels: 'both', layout: 'node' });
if (model.ok) fs.writeFileSync('out.svg', render(model));
if (model.ok) fs.writeFileSync('tables.html', flowTables(model).html);   // 參考面板的三張表（純函式，主入口）
```

自己接版面／互動：`layout(model)`（主入口）回 `Geometry`（含 k8s node 外框的 `wrappers`），
`<TraceSvg model geo headless idPrefix clickable/>`（`/react`）是純渲染的 `<svg>`；
`useTraceModel(doc, opts)`／`useStableDoc(doc)`／`useStableJson(v)` 是對應的 hooks，
`useHighlight(wrapRef, model, enabled, isPanning)`／`useNodeClick(wrapRef, model, cb, isPanning)`／`useFocus(on, refresh)`
是互動層的三個 hook（都靠下面的 DOM 契約，不靠 DOM 順序）。

## 子路徑

| 路徑 | 內容 | 載到 |
|---|---|---|
| `trace-sankey` | `build`／`validate`／`layout`／`summary`／`flowTables`／`locatable`／`fmt*`／常數／`createZoom`／型別 | 不載 React |
| `trace-sankey/react` | `TraceSankey`、`TraceSvg`、`useTraceModel`、`useStableDoc`／`useStableJson`、`useHighlight`、`useNodeClick`、`useFocus` | `react`、`react-dom/client` |
| `trace-sankey/static` | `render`（`renderToStaticMarkup`）、`summary`、`flowTables`、`esc` | `react-dom/server` |
| `trace-sankey/samples` | 內建範例（純資料） | — |
| `trace-sankey/style.css` | 圖與 tooltip 的樣式；CSS 變數 scope 在 `.trace-sankey`，不進 `:root` | — |

## DOM 契約（自己接互動時可依賴）

- 容器：`div.trace-sankey.chart-wrap > div.chart > svg`；拖曳中 wrap 加 `is-panning`。
- `<g class="zoom-layer">` 是縮放的掛點：它的 `transform` 由套件 imperative 設定，不是 React prop。
- 每條 `.band` 有 `data-e`（它是 `model.edges` 的第幾條）；每張卡片與 k8s node 外框的 `<g>` 有 `data-n`（節點 id）：
  路徑高亮與點擊回呼靠這兩個屬性把 DOM 對回 model。
- 每條 `.band` 與每張卡片的 `<g>` 都有 `data-tip`（JSON）：帶是 `{from,to,fi,ti,bps,anchor,…}`
  （有值才出現 `unit/channel/tier/attr/extra/derived`），卡是 `{node:1,title,rows:[[k,v],…]}`，數字已格式化。
- 值為 0 的帶（有量測、量是 0）帶 `band-zero`（虛線＋半透明）；歸屬線是 `band-own`、回流是 `band-back`／`band-loop`。
- 帶子 hover 高亮純靠 CSS（`.band:hover`），tooltip 是 portal 到 `body` 的 `div.trace-sankey-tooltip`。
- 路徑高亮：容器加 `.hl-on`、路徑上的帶與卡加 `.lit`（其餘由 CSS 變淡）；有 `onNodeClick` 時可定位的卡帶 `.clickable`；
  專注模式是 `body.chart-focus`。狀態只在 class 上，樣式全在 `style.css`。
- 漸層 id 帶每個實例自己的前綴（`useId`），hover 用的漸層由 `<svg>` 上的 CSS 變數
  `--gband-h`／`--gband-back-h`／`--gband-w-h` 指定；headless 輸出的 id 是 `gband`／`gband-h`／…。
- 顏色：`styles/trace-sankey.css` 的變數（`--cyan`／`--amber`／`--rose`／`--gray`／`--orange`／`--green`）與
  SVG 裡的十六進位是兩份沒有連動的定義，改配色要一起改。

## CSP

套件沒有 `innerHTML`、樣式走 CSSOM：`style-src 'self'`（沒有 `'unsafe-inline'`）與
`require-trusted-types-for 'script'` 下都正常。

## 開發

```sh
npm run build      # tsc → dist/
npm run typecheck
```

`exports` 的 `default` 指 `dist/`，`development` 條件指 `src/*.ts`（Vite dev 會挑後者，改檔即熱更新）。
