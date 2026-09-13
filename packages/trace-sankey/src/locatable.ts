/* 哪些卡可以「定位」（onNodeClick 的目標）：照參考面板的 locatable 規則——k8s node 外框、
   hop 盒（SVM 除外：參考面板沒有 SVM 頁）、葉 pod。ns／app／owner／錨卡是推導出來的，沒有可去的頁。
   cards.tsx 靠它決定要不要加 .clickable，useNodeClick 靠它決定要不要呼叫回呼——兩邊必須同一份。 */
import type { TraceNode, TraceWrapper } from './model/types.js';

export const locatable = (n: TraceNode | TraceWrapper): boolean => {
  if (n.kind === 'wrapper') return true;
  if (n.kind === 'node') return n.role !== 'netapp-svm';
  if (n.kind === 'leaf') return n.role === 'pod';
  return false;
};
