/* 步驟 4：掛邊到節點；4b：過濾後身上一條邊都不剩的整台移除。 */
import type { BuildCtx } from './types.js';
import { fmtBps } from './format.js';

export const attachAndPrune = (ctx: BuildCtx): void => {
  const { nodes, edges, minBps, channels, filteredNodes } = ctx;
  /* 4. 掛邊到節點 */
  edges.forEach((e, i) => {
    e.id = 'e' + i;
    nodes[e.fromId].outEdges.push(e);
    nodes[e.toId].inEdges.push(e);
  });

  /* 4b. 過濾後身上一條邊都不剩的整台不顯示（no-flow 卡豁免：它本來就沒邊）。
     leaf 只在留邊時才建，anchor 與 root 都掛著 anchorEdge，所以移掉孤立節點不會再孤立出別的，
     掃一輪就夠。一定要排在步驟 5 之前：排欄與正規化都吃 order，留著不存在的節點會多出空欄。 */
  if (minBps > 0 || channels !== 'both') {
    ctx.order = ctx.order.filter((id) => {
      const n = nodes[id];
      if (n.noFlow) return true;
      if (n.inEdges.length || n.outEdges.length) return true;
      filteredNodes.push(n.label);
      delete nodes[id];
      return false;
    });
    /* 沒有 investigation 的圖可能被濾到一台不剩：那是顯示設定的結果，不是資料錯誤——
       回 ok:true 的空模型，render 畫空畫布＋說明，app 的門檻 pill 照樣顯示隱藏了多少。 */
  }
  if (ctx.filteredCount) {
    ctx.warnings.push('顯示門檻 > ' + fmtBps(minBps) + '：隱藏 ' + ctx.filteredCount + ' 條帶（共 ' +
      fmtBps(ctx.filteredBps) + '）' +
      (filteredNodes.length ? '，其中 ' + filteredNodes.length + ' 台整台不顯示（' +
        filteredNodes.join('、') + '）' : '') +
      '；這些量已併進其他輸入／其他輸出，每台仍然守恆。');
  }
};
