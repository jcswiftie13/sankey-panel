/* 步驟 1：掃邊（1a）與掃節點（1b）。 */
import type { AggEdge, BuildCtx, TraceNode, WireNodeData } from './types.js';
import { AUTO_TIER, classOf, clientsOf, extraOf, FLOW_TYPES, infoOf, statusOf, usageOf, WEIGHT_KEYS, weightOf } from './classify.js';
import { isObj, num, SEP, str } from './util.js';
import { isRequestedRoot } from './roots.js';

/* 1a. 掃邊：加總同鍵、記錄誰被 flow 邊碰到。方向計數（contOut/contIn）不看 metrics——
   「有沒有往下走的邊」是拓樸事實，不是量測事實。 */
export const scanEdges = (ctx: BuildCtx): void => {
  const { warnings, flowTouch, podNodeTouch, drawTouch, contOut, contIn, agg, aggOrder } = ctx;
  let unmeasured = 0;
  const units = new Set<string>();
  for (const ed of ctx.doc.elements.edges) {
    const d = ed.data;
    if (FLOW_TYPES.indexOf(d.type) < 0) continue;
    const lab = d.labels || {};
    if (lab.tier === 'pod-node') {
      /* 擺放資訊而已，永遠不畫成帶；記下來是為了認出「只被它碰到的 k8s node」，
         以及 layout:'node' 時知道哪個 pod 在哪台 node 上（不看 metrics，參考面板也是） */
      podNodeTouch.add(d.source); podNodeTouch.add(d.target);
      let pods = ctx.k8sPods.get(d.target);
      if (!pods) ctx.k8sPods.set(d.target, (pods = []));
      pods.push(d.source);
      continue;
    }
    flowTouch.add(d.source); flowTouch.add(d.target);
    contOut.set(d.source, (contOut.get(d.source) || 0) + 1);
    contIn.set(d.target, (contIn.get(d.target) || 0) + 1);
    if (isObj(d.metrics)) {
      for (const k of WEIGHT_KEYS) {
        if (num(d.metrics[k]) && d.metrics[k] < 0) {
          warnings.push('邊「' + d.id + '」的 ' + k + ' 是負數（' + d.metrics[k] + '），視同沒有量測、不畫。');
        }
      }
    }
    const chans = weightOf(d.metrics);
    if (!chans.length) { unmeasured++; continue; }
    for (const ch of chans) {
      drawTouch.add(d.source); drawTouch.add(d.target);
      units.add(ch.unit);
      const sif = str(lab.source_iface) ? lab.source_iface : '';
      const tif = str(lab.target_iface) ? lab.target_iface : '';
      const key = [d.source, d.target, sif, tif, ch.channel || ''].join(SEP);
      let a = agg[key];
      if (!a) {
        a = agg[key] = {
          src: d.source, tgt: d.target, sif, tif, channel: ch.channel, unit: ch.unit,
          bps: 0, tier: str(lab.tier) ? lab.tier : null,
          attribution: str(lab.attribution) ? lab.attribution : null, extra: extraOf(d.metrics)
        } satisfies AggEdge;
        aggOrder.push(key);
      } else if (a.unit !== ch.unit) {
        warnings.push('邊「' + d.id + '」與同一對端點的另一條邊單位不同（' + a.unit + ' 與 ' + ch.unit +
          '），採先出現的 ' + a.unit + '。');
      }
      a.bps += ch.value;
    }
  }
  if (unmeasured) warnings.push(unmeasured + ' 條 flow 邊沒有可用的量測值（metrics 缺、非數字或屬於 RED 家族），不畫。');
  if (units.has('bps') && units.has('bytesPerSec')) {
    warnings.push('同一張圖混用了 delta_bps（bps）與 read/write_bytes_per_sec（bytes/s），帶寬比例尺跨單位沒有意義。');
  }
};

/* hop 盒。物件字面值的鍵序就是 model.json 的鍵序，別重排。 */
const mkHop = (ctx: BuildCtx, d: WireNodeData): TraceNode => {
  const lab = d.labels || {};
  const n: TraceNode = {
    id: d.id, label: str(d.name) ? d.name : d.id, role: d.type, kind: 'node',
    tier: str(lab.tier) ? lab.tier : (AUTO_TIER.indexOf(d.type) >= 0 ? d.type : null),
    namespace: d.type === 'pod' ? ctx.raw.nsOfPod(d.id) : (str(lab.namespace) ? lab.namespace : null),
    ontapCluster: str(lab.ontap_cluster) ? lab.ontap_cluster : null,
    otherInBps: num(d.other_in_bps) ? d.other_in_bps : null,
    otherOutBps: num(d.other_out_bps) ? d.other_out_bps : null,
    noFlow: !ctx.drawTouch.has(d.id),
    status: statusOf(d.status), usage: usageOf(d.usage), info: infoOf(d), clients: clientsOf(d),
    inEdges: [], outEdges: [], col: 0
  };
  if (n.noFlow && (n.otherInBps != null || n.otherOutBps != null)) {
    ctx.warnings.push(n.label + '：沒有任何可畫的 flow 邊（no-flow 卡），給了 other_in_bps／other_out_bps 也不畫，已歸零。');
    n.otherInBps = n.otherOutBps = null;
  }
  return n;
};

/* 1b. 掃節點：群組跳過；葉型與葉 pod 等到第一條存活邊才建（lazy，門檻濾掉就不會留孤兒卡）；
   其餘建 hop 盒。回傳錯誤字串＝整個 build 失敗。 */
export const scanNodes = (ctx: BuildCtx): string | null => {
  const { nodes, order, flowTouch, podNodeTouch, roots, raw } = ctx;
  const isProxyPod = (id: string): boolean =>
    ((ctx.dir === 'destination' ? ctx.contOut : ctx.contIn).get(id) || 0) > 0;
  /* roots 給了才套參考面板的保留規則：沒被畫到的 hop 只在「是 root」或「完全沒被任何邊碰到」時保留。
     沒給 roots 就全保留（我們的超集）。 */
  const keepNoFlow = (d: WireNodeData): boolean => {
    if (!roots) return true;
    return isRequestedRoot(d, roots, raw.nsOfPod) || (!flowTouch.has(d.id) && !podNodeTouch.has(d.id));
  };
  for (const nd of ctx.doc.elements.nodes) {
    const d = nd.data, cls = classOf(d.type);
    if (cls !== 'hop') continue;
    if (d.type === 'pod' && !isProxyPod(d.id)) {
      /* 葉 pod 是 lazy 建的（第一條存活邊）；參考面板「root 一律畫」：被選成 root 卻沒有任何
         可畫的邊的 pod，等邊都建完再補成 no-flow 卡（步驟 2 之後） */
      if (roots && isRequestedRoot(d, roots, raw.nsOfPod)) ctx.rootLeafPods.push(d.id);
      continue;
    }
    /* k8s node 只被 pod-node 邊碰到＝參考面板的「Node layout 外框」：flat 不畫；node 收起來，
       等 pod 都建好再變成外框（不是圖節點，見步驟 6b） */
    if (d.type === 'node' && !flowTouch.has(d.id) && podNodeTouch.has(d.id)) {
      if (ctx.layout === 'node') ctx.k8sRaw.push(d);
      continue;
    }
    if (!ctx.drawTouch.has(d.id) && !keepNoFlow(d)) continue;
    const n = mkHop(ctx, d);
    nodes[d.id] = n; order.push(d.id);
  }
  if (!order.length && !ctx.k8sRaw.length && !ctx.rootLeafPods.length) return '圖上沒有任何可畫的節點。';
  return null;
};
