/* wire JSON（elements.nodes / elements.edges）-> 圖模型：分類節點、加總同鍵的邊、算殘差。
   圖上一律是實際量測值，不做推估攤分。契約見 README「輸入 JSON 規格」。

   build 分七步，每步一個檔、吃同一個 BuildCtx（順序就是這裡的呼叫順序，別搬）：
     0  index-raw   id 索引 + parent 鏈
     1a scan        掃邊：加總同鍵、方向計數
     1b scan        掃節點：建 hop 盒
     2  edges       建邊（★ 門檻／通道過濾在這裡）；葉、ns／app、owner 卡 lazy 建
     3  anchor      錨卡（過濾之後才建，追查起點永遠保留）
     4  prune       掛邊、編 id；4b ★ 移除孤立節點
     5  columns     排欄：tier 超級節點、多數決破環、SCC 破殘環、最長路徑、backward／lateral／subOrder
     6  residuals   ★ 濾掉的量併進殘差；每台守恆；葉加總；app／ns 的 pod 數與 status
     7  normalize   欄位正規化、組回傳物件 */
import type { BuildCtx, BuildOptions, TraceModel, WireGraph } from './types.js';
import { direction, validate } from './validate.js';
import { resolveInvestigation } from './investigation.js';
import { indexRaw } from './index-raw.js';
import { scanEdges, scanNodes } from './scan.js';
import { buildEdges } from './edges.js';
import { addAnchor } from './anchor.js';
import { attachAndPrune } from './prune.js';
import { assignColumns } from './columns.js';
import { computeResiduals } from './residuals.js';
import { assemble, normalizeColumns } from './normalize.js';

const makeCtx = (doc: WireGraph, opts?: BuildOptions): BuildCtx => ({
  doc,
  dir: direction(doc),
  ...(() => { const ri = resolveInvestigation(doc); return { inv: ri.inv, invSource: ri.source }; })(),
  /* 顯示門檻（bps）：只留增量大於它的帶子。0 ＝ 不過濾，行為與沒有這個功能時完全一樣。
     濾掉的量記在 dropIn／dropOut，步驟 6 併進殘差，每台照樣守恆。
     channels 走同一條路：只看 read 時 write 帶的量也併進殘差。 */
  minBps: Math.max(0, Number(opts && opts.minBps) || 0),
  channels: opts && (opts.channels === 'read' || opts.channels === 'write') ? opts.channels : 'both',
  warnings: [],
  raw: indexRaw(doc),
  flowTouch: new Set(), podNodeTouch: new Set(), drawTouch: new Set(),
  contOut: new Map(), contIn: new Map(),
  agg: {}, aggOrder: [],
  nodes: {}, order: [], edges: [],
  dropIn: {}, dropOut: {},
  filteredCount: 0, filteredBps: 0, hiddenChannel: 0,
  root: null, anchorEdge: null,
  filteredNodes: []
});

export const build = (doc: unknown, opts?: BuildOptions): TraceModel => {
  const errs = validate(doc);
  if (errs.length) return { ok: false, errors: errs };
  const ctx = makeCtx(doc as WireGraph, opts);
  if (ctx.invSource === 'top' && ctx.inv) {
    ctx.warnings.push('頂層 investigation 已 deprecated：請搬進起點節點「' + ctx.inv.node_id +
      '」的 data.investigation（不含 node_id），同一份文件丟 cytoscape 才看得到起點。');
  }
  scanEdges(ctx);
  const e1 = scanNodes(ctx);
  if (e1) return { ok: false, errors: [e1] };
  buildEdges(ctx);
  const e2 = addAnchor(ctx);
  if (e2) return { ok: false, errors: [e2] };
  attachAndPrune(ctx);
  assignColumns(ctx);
  computeResiduals(ctx);
  normalizeColumns(ctx);
  return assemble(ctx);
};
