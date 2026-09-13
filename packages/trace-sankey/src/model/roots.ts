/* roots：參考面板的 root 選擇（{ontap_cluster,node,aggr,svm,pod} 各字串陣列）。
   沒給＝現行超集（所有 no-flow hop 都保留）；給了（含空物件）＝參考 deriveSankey 的規則：
   no-flow hop 只在「是 root」或「完全沒被任何邊碰到」時保留。root 只用來「保留」、絕不用來過濾。 */
import type { StorageRoots, WireNodeData } from './types.js';
import { str } from './util.js';

export const ROOT_KINDS = ['ontap_cluster', 'node', 'aggr', 'svm', 'pod'] as const;

export const normRoots = (r: StorageRoots): Required<StorageRoots> => {
  const out = {} as Required<StorageRoots>;
  for (const k of ROOT_KINDS) {
    const v = (r as Record<string, unknown>)[k];
    out[k] = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  }
  return out;
};

/* 照抄參考 deriveSankey.isRequestedRoot：ontap_cluster 涵蓋底下的 node／aggr／svm；
   pod 比對「namespace/name」；pvc 不是 root kind。 */
export const isRequestedRoot = (d: WireNodeData, roots: Required<StorageRoots>,
  nsOf: ((id: string) => string | null) | null): boolean => {
  const lab = d.labels || {}, name = str(d.name) ? d.name : d.id;
  const ns = nsOf ? nsOf(d.id) : (str(lab.namespace) ? lab.namespace : null);
  const inCluster = str(lab.ontap_cluster) && roots.ontap_cluster.indexOf(lab.ontap_cluster) >= 0;
  switch (d.type) {
    case 'netapp-node': return inCluster || roots.node.indexOf(name) >= 0;
    case 'netapp-aggr': return inCluster || roots.aggr.indexOf(name) >= 0;
    case 'netapp-svm': return inCluster || roots.svm.indexOf(name) >= 0;
    case 'node': return roots.node.indexOf(name) >= 0;
    case 'pod': return !!ns && roots.pod.indexOf(ns + '/' + name) >= 0;
    default: return false;
  }
};
