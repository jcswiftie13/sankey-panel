/* 圖外資訊：參考面板的三張表（Node flow summary／Application subtotal／Namespace subtotal）。
   summary() 是我們的 hop 平衡表，參考沒有那種表；這裡另給參考那三張的欄位，回傳結構化資料＋HTML，
   使用端要擺哪一張自己挑。所有數字都從 model 拿（跟圖同一份），有通道的資料 in／out 分 read／write 欄。
   缺的值印「—」，絕不印 0／0 B／unknown（缺值不是零）。
   節點列照圖上的順序（欄、再欄內 y）排，所以要有版面：沒給 geo 就自己 layout() 一次——純函式，
   同一個 model 算出來的順序一定相同。 */
import type { Channel, RateUnit, Status, TraceEdge, TraceModelOk, TraceNode, TraceWrapper } from './model/types.js';
import type { Geometry } from './layout/geometry.js';
import { fmtAmount as A, fmtRate as R } from './model/format.js';
import { sum } from './model/util.js';
import { STATUS_COLOR } from './layout/constants.js';
import { esc, usageText } from './layout/text.js';
import { sumCh, wrapperEdges } from './layout/tips.js';
import { layout } from './layout/layout.js';

export interface FlowRow {
  tier: string; label: string; id: string;
  /** 外框（k8s node）不是圖節點，沒有欄 */
  col: number | null;
  /** 依 channels 順序各一格；沒有通道就一格 */
  inflow: string[]; outflow: string[];
  usage: string | null; status: Status | null; health: string | null;
  /** 'derived'（推導值）、'no-flow' */
  notes: string[];
}
export interface AppRow { application: string; namespace: string | null; pods: number; total: number; totalText: string }
export interface NsRow { namespace: string; pods: number; total: number; totalText: string }
export interface FlowTables {
  channels: Channel[];
  nodes: FlowRow[];
  applications: AppRow[];
  namespaces: NsRow[];
  html: string;
}

const tierOf = (n: TraceNode | TraceWrapper): string => {
  if (n.kind === 'wrapper') return 'node';
  if (n.kind === 'node') return n.role;
  const word: Record<string, string> = { pod: 'pod', ns: 'namespace', app: 'application', owner: 'owner' };
  if (word[n.role]) return word[n.role];
  return n.type || 'host';
};

export const flowTables = (model: TraceModelOk, geo: Geometry = layout(model)): FlowTables => {
  const has = new Set<Channel>();
  for (const e of model.edges) if (e.channel) has.add(e.channel);
  const chs = (['read', 'write'] as Channel[]).filter((c) => has.has(c));
  const cols: (Channel | null)[] = chs.length ? chs : [null];
  const amounts = (list: TraceEdge[], unit: RateUnit): string[] =>
    cols.map((ch) => A(ch ? sumCh(list, ch) : sum(list), unit));

  const rows: FlowRow[] = [];
  const yOf = (n: TraceNode): number => geo.nodes.get(n.id)?.y ?? 0;
  for (const n of model.nodes.slice().sort((a, b) => (a.col - b.col) || (yOf(a) - yOf(b)))) {
    if (n.kind === 'anchor') continue;
    const info = n.info || {}, notes: string[] = [];
    if (n.role === 'ns' || n.role === 'app') notes.push('derived');
    if (n.noFlow) notes.push('no-flow');
    rows.push({
      tier: tierOf(n), label: n.label, id: n.id, col: n.col,
      inflow: amounts(n.inEdges, n.unit!), outflow: amounts(n.outEdges, n.unit!),
      usage: n.usage ? usageText(n.usage) : null,
      status: n.status || null, health: info.health || null,
      notes
    });
  }
  for (const w of model.wrappers) {
    const { inb, outb } = wrapperEdges(w, model);
    /* 外框的單位跟最後一個有單位的成員 pod（成員同一種資料，不會混） */
    let unit: RateUnit = 'bps';
    for (const id of w.podIds) { const u = model.nodeMap[id].unit; if (u) unit = u; }
    rows.push({
      tier: 'node', label: w.label, id: w.id, col: null,
      inflow: amounts(inb, unit), outflow: amounts(outb, unit),
      usage: w.usage ? usageText(w.usage) : null,
      status: w.status || null, health: (w.info || {}).health || null,
      notes: ['derived'].concat(w.noFlow ? ['no-flow'] : [])
    });
  }
  const apps: AppRow[] = model.nodes.filter((n) => n.role === 'app').map((n) => ({
    application: n.label, namespace: n.namespace || null, pods: n.podCount || 0, total: n.bps!, totalText: R(n.bps!, n.unit!)
  })).sort((a, b) => (b.total - a.total) || a.application.localeCompare(b.application));
  /* namespace 小計只算「帶 ns 的葉 pod 的入邊」：pod 唯一的出邊是推導邊，算出邊會重複 */
  const nsAgg = new Map<string, { namespace: string; pods: number; total: number; unit: RateUnit }>();
  for (const n of model.nodes) {
    if (n.kind !== 'leaf' || n.role !== 'pod' || !n.namespace) continue;
    let a = nsAgg.get(n.namespace);
    if (!a) nsAgg.set(n.namespace, (a = { namespace: n.namespace, pods: 0, total: 0, unit: n.unit! }));
    a.pods++; a.total += sum(n.inEdges);
  }
  const nss: NsRow[] = [...nsAgg.values()].map((a) => ({
    namespace: a.namespace, pods: a.pods, total: a.total, totalText: R(a.total, a.unit)
  })).sort((a, b) => (b.total - a.total) || a.namespace.localeCompare(b.namespace));

  const colHead = cols.map((ch) => (ch ? '（' + ch + '）' : ''));
  const dot = (st: Status | null): string => {
    if (!st) return '—';
    return '<span class="st-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' +
      STATUS_COLOR[st] + ';margin-right:6px"></span>' + esc(st);
  };
  const h = ['<h3>Node flow summary</h3><div class="tbl-wrap"><table><thead><tr><th>tier</th><th>node</th>'];
  for (const c of colHead) h.push('<th>in' + c + '</th>');
  for (const c of colHead) h.push('<th>out' + c + '</th>');
  h.push('<th>usage</th><th>status</th><th>health</th><th>notes</th></tr></thead><tbody>');
  for (const r of rows) {
    h.push('<tr><td>' + esc(r.tier) + '</td><td>' + esc(r.label) +
      (r.id !== r.label ? ' <span class="c-dim">' + esc(r.id) + '</span>' : '') + '</td>');
    for (const v of r.inflow) h.push('<td class="num">' + esc(v) + '</td>');
    for (const v of r.outflow) h.push('<td class="num">' + esc(v) + '</td>');
    h.push('<td class="num">' + (r.usage ? esc(r.usage) : '—') + '</td><td>' + dot(r.status) + '</td>' +
      '<td>' + (r.health ? esc(r.health) : '—') + '</td><td class="c-dim">' + esc(r.notes.join(' · ')) + '</td></tr>');
  }
  h.push('</tbody></table></div>');
  if (apps.length) {
    h.push('<h3>Application flow subtotal</h3><div class="tbl-wrap"><table><thead><tr>' +
      '<th>application</th><th>namespace</th><th>pods</th><th>total</th></tr></thead><tbody>');
    for (const a of apps) {
      h.push('<tr><td>' + esc(a.application) + '</td><td>' + (a.namespace ? esc(a.namespace) : '—') + '</td>' +
        '<td class="num">' + a.pods + '</td><td class="num">' + esc(a.totalText) + '</td></tr>');
    }
    h.push('</tbody></table></div>');
  }
  if (nss.length) {
    h.push('<h3>Namespace flow subtotal</h3><div class="tbl-wrap"><table><thead><tr>' +
      '<th>namespace</th><th>pods</th><th>total</th></tr></thead><tbody>');
    for (const a of nss) {
      h.push('<tr><td>' + esc(a.namespace) + '</td><td class="num">' + a.pods + '</td>' +
        '<td class="num">' + esc(a.totalText) + '</td></tr>');
    }
    h.push('</tbody></table></div>');
  }
  return { channels: chs, nodes: rows, applications: apps, namespaces: nss, html: h.join('') };
};
