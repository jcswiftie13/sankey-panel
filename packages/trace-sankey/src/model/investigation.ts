/* 追查起點的解析層：節點形式（起點節點的 data.investigation，沒有 node_id）與 deprecated 的
   頂層形式（doc.investigation，帶 node_id）都正規化成同一個 {node_id, iface, delta_bps, direction, note}。
   validate()／direction()／步驟 3 都吃它，之後的步驟不知道契約改過。
   起點放進 elements 裡是為了同一份文件丟 cytoscape 也看得到起點；頂層仍接受但 build 會發 deprecated 警告，
   兩處都給是驗證錯誤（不猜哪一份對）。 */
import type { WireInvestigation } from './types.js';
import { classOf } from './classify.js';
import { isObj, num, str } from './util.js';

export type InvestigationSource = 'top' | 'node';

export interface ResolvedInvestigation {
  inv: WireInvestigation | null;
  source: InvestigationSource | null;
  errors: string[];
}

/* 兩種寫法共用的欄位驗證；path 是錯誤文案裡的路徑前綴 */
export const checkInvFields = (inv: Record<string, any>, path: string, errs: string[]): void => {
  if (!str(inv.iface)) errs.push(path + '.iface 必填。');
  if (!num(inv.delta_bps) || inv.delta_bps <= 0) errs.push(path + '.delta_bps 必須是正數（bps）。');
  if (inv.direction != null && inv.direction !== 'in' && inv.direction !== 'out') {
    errs.push(path + '.direction 只能是 "in" 或 "out"。');
  }
  if (inv.note != null && typeof inv.note !== 'string') errs.push(path + '.note 必須是字串。');
};

export const resolveInvestigation = (doc: unknown): ResolvedInvestigation => {
  const errs: string[] = [];
  let inv: WireInvestigation | null = null, source: InvestigationSource | null = null;
  const d = isObj(doc) ? doc : {};
  const top = d.investigation;
  if (top != null) {
    if (!isObj(top)) errs.push('investigation 必須是物件。');
    else {
      if (!str(top.node_id)) errs.push('investigation.node_id 必填。');
      checkInvFields(top, 'investigation', errs);
      if (!errs.length) { inv = top as WireInvestigation; source = 'top'; }
    }
  }
  const el = d.elements;
  const nodes: unknown[] = isObj(el) && Array.isArray(el.nodes) ? el.nodes : [];
  const found: { i: number; d: Record<string, any> }[] = [];
  nodes.forEach((nd, i) => {
    if (!isObj(nd) || !isObj(nd.data) || nd.data.investigation == null) return;
    found.push({ i, d: nd.data });
  });
  if (found.length > 1) {
    errs.push('有 ' + found.length + ' 個節點帶 data.investigation（' + found.map((f) => f.d.id).join('、') +
      '），追查起點只能有一個。');
  } else if (found.length === 1) {
    const f = found[0], path = 'nodes[' + f.i + '].data.investigation', ni = f.d.investigation;
    if (!isObj(ni)) errs.push(path + ' 必須是物件。');
    else {
      checkInvFields(ni, path, errs);
      if (classOf(f.d.type) !== 'hop') {
        errs.push(path + '：這個節點的 type 是 ' + f.d.type + '，追查起點必須是 hop 型（switch／node／pod／netapp-*／pvc）。');
      }
      if (top != null) {
        errs.push('頂層 investigation 與 ' + path + ' 兩處都給了，請只留節點那一份（頂層已 deprecated）。');
      } else if (!errs.length) {
        inv = { node_id: f.d.id, iface: ni.iface, delta_bps: ni.delta_bps, direction: ni.direction, note: ni.note };
        source = 'node';
      }
    }
  }
  if (errs.length) inv = null;
  return { inv, source, errors: errs };
};
