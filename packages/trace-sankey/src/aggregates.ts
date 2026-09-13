/* 圖外資訊的共用彙總：namespace 小計。

   為什麼要抽出來：summary() 與 flowTables() 都印這張小計，原本各自算一次——
   summary 讀 ns 終點卡的 bps／podCount，flowTables 自己掃葉 pod 重新加總。
   兩邊的註解都寫著「這是單一事實來源」，實際上在 roots ＋ no-flow pod 的組合下已經對不上
   （storage 範例 ＋ roots ＋ channels:'write'：flowTables 說 namespace prod 有 4 個 pod、
   ns 卡說 2 個；門檻拉到 5e8 時圖上連 ns 卡都沒有，flowTables 卻還印著一列 prod 4 pods／0）。

   兩個數字都是對的，只是回答不同的問題：
   - 圖的 ns 終點卡是**推導節點**——每個葉 pod 自動再接一條邊匯進去，值就是 pod 自己的量測值。
     所以它的 podCount 是「有邊匯進來的 pod 數」；完全沒有邊的 no-flow pod 根本不與它相連。
   - 表是「把 model 裡的節點列成清單」，所以圖上畫成 no-flow 卡的 pod 也算它存在。
   問題只在兩者都叫「pod 數」、都放在叫「namespace 小計」的標題下。所以這裡**兩個都給、
   名字自己說清楚**，兩張表都讀這一份——資訊不丟，而且不可能再漂移。 */
import type { RateUnit, TraceModelOk } from './model/types.js';
import { fmtRate } from './model/format.js';

export interface NsAgg {
  namespace: string;
  /** 計量 pod 數：有邊匯進 ns 終點卡的（＝ns 卡的 podCount，穿過 app 卡算過） */
  pods: number;
  /** 全部 pod 數：圖上屬於這個 ns 的葉 pod，含完全沒有邊的 no-flow 卡 */
  podsTotal: number;
  /** 量測總和（＝ns 終點卡的 bps）。整個 ns 都是 no-flow 卡時沒有 ns 卡，這裡是 0 */
  total: number;
  unit: RateUnit;
}

/** 照 total 降冪、平手照名字——與 flowTables 的 application 小計同一個排法 */
export const namespaceAggs = (model: TraceModelOk): NsAgg[] => {
  const byNs = new Map<string, NsAgg>();
  const touch = (namespace: string, unit: RateUnit): NsAgg => {
    let a = byNs.get(namespace);
    if (!a) byNs.set(namespace, (a = { namespace, pods: 0, podsTotal: 0, total: 0, unit }));
    return a;
  };
  /* 全部 pod 數：掃葉 pod。proxy pod（有往下走的邊）是 kind:'node' 不是葉，本來就不該算進來 */
  for (const n of model.nodes) {
    if (n.kind !== 'leaf' || n.role !== 'pod' || !n.namespace) continue;
    touch(n.namespace, n.unit || 'bps').podsTotal++;
  }
  /* 計量 pod 數與量：直接讀 ns 終點卡，不重算（build 已經穿過 app 卡數好了） */
  for (const n of model.nodes) {
    if (n.role !== 'ns') continue;
    const a = touch(n.label, n.unit || 'bps');
    a.pods = n.podCount || 0;
    a.total = n.bps || 0;
    a.unit = n.unit || a.unit;
  }
  return [...byNs.values()].sort((a, b) => (b.total - a.total) || a.namespace.localeCompare(b.namespace));
};

/* 小計要印的量。計量 pod 數是 0 就印「—」而不是 0——那個 ns 在圖上只有 no-flow 卡，
   我們**沒有量到任何東西**，不是量到 0（全 repo 的規則：缺值不是零，見 README）。
   兩張表共用這一個判斷，不然一邊印 0 一邊印 — 又是新的漂移。 */
export const nsTotalText = (a: NsAgg): string => (a.pods ? fmtRate(a.total, a.unit) : '—');
