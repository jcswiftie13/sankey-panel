/* 步驟 3：追查起點錨卡（有 investigation 才有）：追終點在最左，追來源在最右。
   錨邊在門檻／通道過濾之後才建，所以追查起點永遠保留。回傳錯誤字串＝整個 build 失敗。 */
import type { BuildCtx, TraceNode } from './types.js';
import { mkEdge } from './edges.js';

export const addAnchor = (ctx: BuildCtx): string | null => {
  const { inv, dir, nodes, order, edges } = ctx;
  if (!inv) return null;
  const root = nodes[inv.node_id];
  if (!root || root.kind !== 'node') {
    return 'investigation.node_id「' + inv.node_id + '」不是可畫的 hop（只被 pod-node 邊碰到的 k8s node 不畫）。';
  }
  root.isRoot = true;
  root.noFlow = false;          /* 錨邊就是它的流量 */
  const anchor: TraceNode = {
    id: '__anchor__', label: '追查起點', kind: 'anchor', role: 'anchor',
    iface: inv.iface, note: inv.note || '', dirLabel: dir === 'destination' ? 'in' : 'out',
    inEdges: [], outEdges: [], col: 0
  };
  nodes[anchor.id] = anchor; order.push(anchor.id);
  const ap = { bps: inv.delta_bps, unit: 'bps' as const, channel: null };
  const anchorEdge = dir === 'destination'
    ? mkEdge(anchor, root, inv.iface, inv.iface, ap)
    : mkEdge(root, anchor, inv.iface, inv.iface, ap);
  anchorEdge.isAnchor = true;
  edges.push(anchorEdge);
  ctx.root = root;
  ctx.anchorEdge = anchorEdge;
  return null;
};
