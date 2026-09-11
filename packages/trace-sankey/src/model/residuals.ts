/* 步驟 6：每台的守恆與殘差；葉的加總；app／ns 卡的 pod 數與 status。 */
import type { BuildCtx, TraceNode } from './types.js';
import { worstStatus } from './classify.js';
import { fmtAmount } from './format.js';
import { num, sum } from './util.js';

export const computeResiduals = (ctx: BuildCtx): void => {
  const { nodes, dir, dropIn, dropOut, warnings } = ctx;
  const ids = ctx.order;
  for (const id of ids) {
    const n = nodes[id];
    if (n.kind !== 'node') continue;
    /* 節點的顯示單位：跟著它身上的邊；沒有邊（no-flow）就 bps */
    const anyEdge = n.inEdges[0] || n.outEdges[0];
    n.unit = anyEdge ? anyEdge.unit : 'bps';
    if (n.noFlow) {
      /* 原始輸入就沒接到任何可畫的邊：只畫盒子，沒有槽位、沒有殘差 */
      n.tracedIn = n.tracedOut = n.otherIn = n.otherOut = n.totalIn = n.totalOut = 0;
      n.resEps = 1;
      continue;
    }
    /* 門檻濾掉的量先併進顯式殘差再算。沒顯式給值的（null）不用碰：tracedIn／tracedOut
       已經因為邊被拿掉而變小，下面的平衡式會自動把缺口補成殘差。顯式值不加就會誤觸
       「兩個都給又湊不出平衡式」那則警告。 */
    if (num(n.otherInBps)) n.otherInBps += dropIn[id] || 0;
    if (num(n.otherOutBps)) n.otherOutBps += dropOut[id] || 0;
    n.tracedIn = sum(n.inEdges);
    n.tracedOut = sum(n.outEdges);
    const left = n.tracedIn, right = n.tracedOut;
    const eps = Math.max(left, right) * 0.005 + 1;   /* 讀 counter 的浮點雜訊門檻 */
    let oi = n.otherInBps, oo = n.otherOutBps;
    if (num(oi) && num(oo)) {
      const gap = (left + oi) - (right + oo);
      if (Math.abs(gap) > eps) {
        warnings.push(n.label + '：other_in_bps／other_out_bps 兩個都給了但湊不出平衡式 —— ' +
          '已追查 in ' + fmtAmount(left, n.unit) + ' ＋ 其他輸入 ' + fmtAmount(oi, n.unit) + ' ＝ ' + fmtAmount(left + oi, n.unit) + '，' +
          '已追查 out ' + fmtAmount(right, n.unit) + ' ＋ 其他輸出 ' + fmtAmount(oo, n.unit) + ' ＝ ' + fmtAmount(right + oo, n.unit) + '，' +
          (gap > 0 ? '左邊多 ' : '右邊多 ') + fmtAmount(Math.abs(gap), n.unit) + '。' +
          '圖照顯式值畫，這台的左右色塊厚度不會相等；拿掉其中一個讓平衡式自動補就會守恆。');
      }
    } else if (num(oo)) {
      oi = Math.max(0, right + oo - left);
    } else if (num(oi)) {
      oo = Math.max(0, left + oi - right);
    } else {
      const d = right - left;
      oi = Math.max(0, d); oo = Math.max(0, -d);
    }
    /* 源頭豁免：一條入邊都沒有（也沒有被門檻／通道藏起來的入邊）、又沒顯式給 other_in_bps 的 hop，
       視為圖的源頭（netapp-node 的流量來自磁碟），不補「其他輸入」。只做入側：出側
       「沒列 outputs 就補其他輸出」是 README 明文的「node 當葉」情境，要保留。 */
    if (!n.inEdges.length && !dropIn[id] && !num(n.otherInBps)) oi = 0;
    n.otherIn = oi || 0;
    n.otherOut = oo || 0;
    n.totalIn = n.tracedIn + n.otherIn;
    n.totalOut = n.tracedOut + n.otherOut;
    n.resEps = eps;        /* 圖上小於這個值的殘差不畫，見 layout 的 resIn/resOut */
  }

  /* 葉的值＝該方向所有邊加總（單邊葉結果不變；多條邊接同一張葉卡就是總量）。
     app 先算再算 ns：ns 的 pod 數要穿過 app 卡。群組卡的 status ＝ 成員 pod 最差值，
     沒有任何成員有 status 就不給（維持中性框，不退成 normal）。 */
  const memberPods = (n: TraceNode): TraceNode[] => {
    const list = dir === 'destination' ? n.inEdges : n.outEdges;
    return list.map((e) => nodes[dir === 'destination' ? e.fromId : e.toId]);
  };
  for (const id of ids) {
    const n = nodes[id];
    if (n.kind !== 'leaf') continue;
    const side = dir === 'destination' ? n.inEdges : n.outEdges;
    n.bps = sum(side);
    n.unit = side[0] ? side[0].unit : 'bps';
    if (n.role === 'app') {
      const pods = memberPods(n);
      n.podCount = pods.length;
      n.status = worstStatus(pods.map((p) => p.status));
    }
  }
  for (const id of ids) {
    const n = nodes[id];
    if (n.kind !== 'leaf' || n.role !== 'ns') continue;
    const members = memberPods(n), statuses: (TraceNode['status'])[] = [];
    let cnt = 0;
    for (const m of members) {
      if (m.role === 'app') { cnt += m.podCount || 0; statuses.push(m.status); }
      else { cnt++; statuses.push(m.status); }
    }
    n.podCount = cnt;
    n.status = worstStatus(statuses);
  }
};
