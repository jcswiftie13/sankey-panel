/* wire JSON 的契約驗證：空陣列＝合法。錯誤文案是使用端橫幅直接印的，改字要對 README 的對照表。 */
import type { Direction, WireGraph, WireNodeData } from './types.js';
import { classOf, FLOW_TYPES } from './classify.js';
import { resolveInvestigation } from './investigation.js';
import { isObj, isStringMap, num, str } from './util.js';

export const direction = (doc: WireGraph): Direction => {
  if (doc.kind === 'source') return 'source';
  if (doc.kind === 'destination') return 'destination';
  const inv = isObj(doc) ? resolveInvestigation(doc).inv : null;
  if (inv && inv.direction === 'out') return 'source';
  return 'destination';
};

export const validate = (doc: unknown): string[] => {
  const errs: string[] = [];
  if (!isObj(doc)) return ['最外層必須是 JSON 物件。'];
  if (doc.kind != null && doc.kind !== 'destination' && doc.kind !== 'source') {
    errs.push('kind 只能是 "destination" 或 "source"。');
  }
  /* 信封欄位（參考 repo 的後端回應帶 apiVersion 與 clusters）：列進契約但不強制。給了就驗型別、
     build 原樣帶出；參考前端也不讀這兩欄（Clusters 圖例從 type:"cluster" 節點派生）。 */
  if (doc.apiVersion != null && typeof doc.apiVersion !== 'string') errs.push('apiVersion 必須是字串。');
  if (doc.clusters != null && !(Array.isArray(doc.clusters) && doc.clusters.every((c: unknown) => typeof c === 'string'))) {
    errs.push('clusters 必須是字串陣列。');
  }
  const ri = resolveInvestigation(doc);
  errs.push(...ri.errors);
  const inv = ri.inv;
  const el = doc.elements;
  if (!isObj(el)) { errs.push('缺少 elements（必須是物件，含 nodes 與 edges 陣列）。'); return errs; }
  if (!Array.isArray(el.nodes)) errs.push('elements.nodes 必須是陣列。');
  if (!Array.isArray(el.edges)) errs.push('elements.edges 必須是陣列。');
  if (errs.length) return errs;

  /* 鍵加前綴避開 __proto__ 之類的原型鍵 */
  const byId: Record<string, WireNodeData> = {};
  (el.nodes as unknown[]).forEach((nd, i) => {
    if (!isObj(nd) || !isObj(nd.data)) { errs.push('nodes[' + i + '] 必須是 { data: {...} } 物件。'); return; }
    const d = nd.data;
    if (!str(d.id)) errs.push('nodes[' + i + '].data.id 必填（非空字串）。');
    if (!str(d.type)) errs.push('nodes[' + i + '].data.type 必填（非空字串）。');
    if (str(d.id)) {
      if (byId['k:' + d.id]) errs.push('nodes[' + i + '].data.id「' + d.id + '」重複。');
      else byId['k:' + d.id] = d as WireNodeData;
      /* build() 自己合成的 ns／app／owner 卡與錨卡跟輸入節點共用同一張表：撞名會靜默把
         輸入那台蓋掉（圖少一台、沒有警告），React 也會抱 key 重複。在這裡擋掉。 */
      if (/^(ns|app|owner)-\d+$/.test(d.id) || d.id === '__anchor__') {
        errs.push('nodes[' + i + '].data.id「' + d.id + '」是保留字（ns-N／app-N／owner-N／__anchor__ 是圖上自動合成的節點 id）。');
      }
    }
    if (d.name != null && typeof d.name !== 'string') errs.push('nodes[' + i + '].data.name 必須是字串。');
    if (d.parent != null && !str(d.parent)) errs.push('nodes[' + i + '].data.parent 必須是非空字串。');
    if (d.labels != null && !isStringMap(d.labels)) {
      errs.push('nodes[' + i + '].data.labels 必須是字串對字串的物件。');
    }
    if (d.usage != null && !isObj(d.usage)) errs.push('nodes[' + i + '].data.usage 必須是物件。');
    /* 我們自己的擴充欄位，比照 other_in_bps 要驗型別；陣列內認不得的項目則靜默丟棄（比照 alerts） */
    if (d.clients != null && !Array.isArray(d.clients)) errs.push('nodes[' + i + '].data.clients 必須是陣列。');
    /* 負的殘差會讓 thick() 算出負高度，SVG 直接破圖：擋在驗證這一關 */
    for (const k of ['other_in_bps', 'other_out_bps']) {
      if (d[k] != null && (!num(d[k]) || d[k] < 0)) {
        errs.push('nodes[' + i + '].data.' + k + ' 必須是非負數（bps）。');
      }
    }
  });

  const dir = direction(doc as WireGraph);
  const edgeIds = new Set<string>();
  (el.edges as unknown[]).forEach((ed, i) => {
    if (!isObj(ed) || !isObj(ed.data)) { errs.push('edges[' + i + '] 必須是 { data: {...} } 物件。'); return; }
    const d = ed.data;
    for (const k of ['id', 'type', 'source', 'target']) {
      if (!str(d[k])) errs.push('edges[' + i + '].data.' + k + ' 必填（非空字串）。');
    }
    if (str(d.id)) {
      if (edgeIds.has(d.id)) errs.push('edges[' + i + '].data.id「' + d.id + '」重複。');
      edgeIds.add(d.id);
    }
    if (d.labels != null && !isStringMap(d.labels)) {
      errs.push('edges[' + i + '].data.labels 必須是字串對字串的物件。');
    }
    const s = str(d.source) ? byId['k:' + d.source] : null;
    const t = str(d.target) ? byId['k:' + d.target] : null;
    if (str(d.source) && !s) errs.push('edges[' + i + '].data.source「' + d.source + '」在 nodes 裡找不到。');
    if (str(d.target) && !t) errs.push('edges[' + i + '].data.target「' + d.target + '」在 nodes 裡找不到。');
    /* 只有會畫的 flow 邊才管端點型別：其他 type 的邊整條忽略，接到群組也無所謂 */
    if (FLOW_TYPES.indexOf(d.type) < 0 || (d.labels && d.labels.tier === 'pod-node')) return;
    for (const [side, n] of [['source', s], ['target', t]] as const) {
      if (n && classOf(n.type) === 'group') {
        errs.push('edges[' + i + '].data.' + side + '「' + n.id + '」是群組節點（type: ' + n.type +
          '），不能當 flow 邊的端點；群組只能透過 parent 鏈表達。');
      }
    }
    /* 葉卡是「追查終止」：不能再往下走。追終點往下＝當 source；追來源往下（往上游）＝當 target */
    const up = dir === 'destination' ? s : t;
    if (up && classOf(up.type) === 'leaf') {
      errs.push('edges[' + i + ']：「' + up.id + '」（type: ' + up.type + '）不是 hop 型節點，畫成追查終止葉卡，' +
        '不能再有往下走的 flow 邊；要接下去請改用 hop 型 type（switch／node／pod／netapp-*／pvc）。');
    }
  });

  /* 節點形式的起點就是那個節點，存在與型別已在 resolveInvestigation 驗過；這裡只剩頂層形式要查 id */
  if (inv && ri.source === 'top') {
    const root = byId['k:' + inv.node_id];
    if (!root) errs.push('investigation.node_id「' + inv.node_id + '」在 nodes 裡找不到。');
    else if (classOf(root.type) !== 'hop') {
      errs.push('investigation.node_id「' + inv.node_id + '」的 type 是 ' + root.type +
        '，追查起點必須是 hop 型（switch／node／pod／netapp-*／pvc）。');
    }
  }
  return errs;
};
