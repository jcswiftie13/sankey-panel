/* 步驟 7：正規化欄位（最左＝0；空模型 minCol = 0），然後組回傳物件。
   回傳物件的鍵序就是 model.json 的鍵序，別重排。 */
import type { BuildCtx, TraceModelOk } from './types.js';
import { str } from './util.js';

export const normalizeColumns = (ctx: BuildCtx): void => {
  const { nodes } = ctx;
  const ids = ctx.order;
  let minCol = ids.length ? Infinity : 0;
  for (const id of ids) minCol = Math.min(minCol, nodes[id].col);
  for (const id of ids) nodes[id].col -= minCol;
  /* root 的 no-flow pod 卡沒有邊，最長路徑會把它排到第 0 欄；它該待在 pod 欄
     （layout:'node' 時才進得了它的 k8s node 外框）。有別的葉 pod 就跟著它們的欄，沒有就留原位。 */
  let podColMax = -1;
  for (const id of ids) {
    const n = nodes[id];
    if (n.kind === 'leaf' && n.role === 'pod' && !n.noFlow) podColMax = Math.max(podColMax, n.col);
  }
  if (podColMax >= 0) {
    for (const id of ids) {
      const n = nodes[id];
      if (n.kind === 'leaf' && n.role === 'pod' && n.noFlow) n.col = podColMax;
    }
  }
};

export const assemble = (ctx: BuildCtx): TraceModelOk => {
  const list = ctx.order.map((id) => ctx.nodes[id]);
  return {
    ok: true, dir: ctx.dir, investigation: ctx.inv, channels: ctx.channels,
    layout: ctx.layout, wrappers: ctx.wrappers, roots: ctx.roots,
    apiVersion: str(ctx.doc.apiVersion) ? ctx.doc.apiVersion : null,
    clusters: Array.isArray(ctx.doc.clusters) ? ctx.doc.clusters.slice() : null,
    minBps: ctx.minBps, filtered: { edges: ctx.filteredCount, bps: ctx.filteredBps },
    filteredNodes: ctx.filteredNodes,
    nodes: list, nodeMap: ctx.nodes, edges: ctx.edges, anchorEdge: ctx.anchorEdge,
    root: ctx.root, warnings: ctx.warnings,
    maxCol: list.reduce((m, n) => Math.max(m, n.col), 0)
  };
};
