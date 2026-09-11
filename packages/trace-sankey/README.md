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
  className="my-chart"    // 容器高度由你的 CSS 決定，元件不設高度
  onModel={model => …}    // 每次 build 成功（拼圖例、警告用）
  onError={errors => …}   // build 失敗（字串陣列；元件不畫錯誤 UI）
  onZoom={scale => …}     // 螢幕實際倍率（1 = 原始大小；量不到時 null）
/>
```

- `ref` 拿到 `{ refresh(), model, zoom: { fit(), actual(), zoomBy(f), refresh(), isPanning() } }`。
  容器尺寸變了呼叫 `refresh()`。`zoomStep`（主入口匯出）是工具列／快捷鍵的一格倍率。
- 改 `minBps`／`channels` 縮放保留；換一份**內容不同**的 `doc` 才重新 fit（內容相同的新物件視同沒換）。
- 沒有 React 框架的頁面一樣用 `createRoot(el).render(<TraceSankey doc={…}/>)` 掛。
- 同一頁可以掛多張，各自的縮放、tooltip、漸層互不干擾。

只要 SVG 字串（Node 也能跑，沒有 DOM 依賴）：

```js
import { build } from 'trace-sankey';
import { render, summary } from 'trace-sankey/static';   // 這條子路徑才會載到 react-dom/server
const model = build(wireJson, { minBps: 0, channels: 'both' });
if (model.ok) fs.writeFileSync('out.svg', render(model));
```

自己接版面／互動：`layout(model)`（主入口）回 `Geometry`，`<TraceSvg model geo headless idPrefix/>`
（`/react`）是純渲染的 `<svg>`；`useTraceModel(doc, opts)`／`useStableDoc(doc)` 是對應的 hooks。

## 子路徑

| 路徑 | 內容 | 載到 |
|---|---|---|
| `trace-sankey` | `build`／`validate`／`layout`／`summary`／`fmt*`／常數／`createZoom`／型別 | 不載 React |
| `trace-sankey/react` | `TraceSankey`、`TraceSvg`、`useTraceModel`、`useStableDoc` | `react`、`react-dom/client` |
| `trace-sankey/static` | `render`（`renderToStaticMarkup`）、`summary`、`esc` | `react-dom/server` |
| `trace-sankey/samples` | 內建範例（純資料） | — |
| `trace-sankey/style.css` | 圖與 tooltip 的樣式；CSS 變數 scope 在 `.trace-sankey`，不進 `:root` | — |

## DOM 契約（自己接互動時可依賴）

- 容器：`div.trace-sankey.chart-wrap > div.chart > svg`；拖曳中 wrap 加 `is-panning`。
- `<g class="zoom-layer">` 是縮放的掛點：它的 `transform` 由套件 imperative 設定，不是 React prop。
- 每條 `.band` 與每張卡片的 `<g>` 都有 `data-tip`（JSON）：帶是 `{from,to,fi,ti,bps,anchor,…}`
  （storage 資料才有 `unit/channel/tier/attr/extra`），卡是 `{node:1,title,rows:[[k,v],…]}`，數字已格式化。
- 帶子 hover 高亮純靠 CSS（`.band:hover`），tooltip 是 portal 到 `body` 的 `div.trace-sankey-tooltip`。
- 漸層 id 帶每個實例自己的前綴（`useId`），hover 用的漸層由 `<svg>` 上的 CSS 變數
  `--gband-h`／`--gband-back-h`／`--gband-w-h` 指定；headless 輸出的 id 是 `gband`／`gband-h`／…。
- 顏色：`styles/trace-sankey.css` 的變數（`--cyan`／`--amber`／`--rose`／`--gray`／`--orange`）與
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
