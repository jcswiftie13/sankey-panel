/* 步驟 6b：layout:'node' 的 k8s node 外框。成員＝它上面「最後留在圖上」的葉 pod（門檻／通道濾掉的不算）。
   沒成員又不是 root 就不畫；是 root 就畫成空的 no-flow 外框。status 是 node 自己與成員 pod 的最差值
   （外框是這台 node 唯一畫出來的東西，node 自己 degraded 也得看得到）。外框不是圖節點：
   不進 nodes／order，沒有邊、不排欄、不算殘差；layout 只拿它決定 pod 欄的分區與畫框。 */
import type { BuildCtx, TraceWrapper } from './types.js';
import { infoOf, statusOf, usageOf, worstStatus } from './classify.js';
import { isRequestedRoot } from './roots.js';
import { str } from './util.js';

export const buildWrappers = (ctx: BuildCtx): void => {
  const { nodes, roots, raw } = ctx;
  const alive = new Set(ctx.order);
  for (const d of ctx.k8sRaw) {
    const members = (ctx.k8sPods.get(d.id) || []).filter((pid) => {
      const p = nodes[pid];
      return alive.has(pid) && p && p.kind === 'leaf' && p.role === 'pod';
    });
    const isRoot = roots ? isRequestedRoot(d, roots, raw.nsOfPod) : false;
    if (!members.length && !isRoot) continue;
    const w: TraceWrapper = {
      id: d.id, label: str(d.name) ? d.name : d.id, role: 'node', kind: 'wrapper',
      status: worstStatus([statusOf(d.status), ...members.map((pid) => nodes[pid].status)]),
      podIds: members, noFlow: !members.length, info: infoOf(d), usage: usageOf(d.usage)
    };
    for (const pid of members) nodes[pid].k8sNode = d.id;
    ctx.wrappers.push(w);
  }
};
