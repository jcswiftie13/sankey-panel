/* 型別分類與 wire 欄位的寬鬆讀取：認得的就收、認不得的靜默忽略，契約才能往前相容。 */
import type { NodeClient, NodeInfo, NodeUsage, Status, Weight, WireNodeData } from './types.js';
import { isObj, num, str } from './util.js';

/* hop 盒：畫成有槽位、算殘差的盒子。role = type 原樣保留（render 靠它決定虛線／副標）。 */
export const HOP_TYPES = ['switch', 'node', 'pod', 'netapp-node', 'netapp-aggr', 'netapp-svm', 'pvc'];
/* 群組：不直接畫，只透過 parent 鏈推導 application／namespace 終點卡 */
export const GROUP_TYPES = ['namespace', 'application', 'cluster', 'storage-cluster', 'controller'];
/* 只有這兩種邊會畫；其他 type（pod-to-node、pod-calls-pod…）整條忽略 */
export const FLOW_TYPES = ['network-flow', 'storage-flow'];
/* 儲存鏈的型別沒給 labels.tier 時自動以 type 當 tier 鎖同欄：參考面板的欄就是型別，
   FlexGroup 這種從 SVM 起頭、沒有上游 aggr 的路徑，純最長路徑會把那台 SVM 推到第 0 欄。
   刻意不含 switch／node／pod：那是舊 switch 追查資料的型別，行為要維持逐 byte 不變。 */
export const AUTO_TIER = ['netapp-node', 'netapp-aggr', 'netapp-svm', 'pvc'];
/* 欄標題用的型別名稱；沒列的直接印 type 字串 */
export const TYPE_LABEL: Record<string, string> = {
  'netapp-node': 'NetApp node', 'netapp-aggr': 'NetApp aggregate', 'netapp-svm': 'SVM',
  pvc: 'PVC', pod: 'pod', node: 'k8s node'
};
export const classOf = (type: string): 'hop' | 'group' | 'leaf' => {
  if (HOP_TYPES.indexOf(type) >= 0) return 'hop';
  if (GROUP_TYPES.indexOf(type) >= 0) return 'group';
  return 'leaf';
};

const STATUS_RANK: Record<string, number> = { normal: 0, warning: 1, critical: 2 };
/* 非法值視同沒有，不退成 normal */
export const statusOf = (v: unknown): Status | null =>
  typeof v === 'string' && STATUS_RANK[v] != null ? (v as Status) : null;
export const worstStatus = (list: (Status | null | undefined)[]): Status | null => {
  let w: Status | null = null;
  for (const s of list) {
    if (s != null && (w == null || STATUS_RANK[s] > STATUS_RANK[w])) w = s;
  }
  return w;
};

/* 邊權重 → 通道陣列。有 rate 鍵的是 RED 家族（trace 呼叫邊），整個忽略。
   delta_bps（switch 追查）是一條無通道的帶；read/write_bytes_per_sec 各自存在就各一條。
   absent ≠ 0：值為 0 是真讀數要畫，缺／非有限數／負數才是不畫（負數另外發警告，見 scanEdges）。 */
export const weightOf = (metrics: unknown): Weight[] => {
  if (!isObj(metrics) || metrics.rate !== undefined) return [];
  if (num(metrics.delta_bps) && metrics.delta_bps >= 0) {
    return [{ value: metrics.delta_bps, unit: 'bps', channel: null }];
  }
  const out: Weight[] = [];
  for (const ch of ['read', 'write'] as const) {
    const v = metrics[ch + '_bytes_per_sec'];
    if (num(v) && v >= 0) out.push({ value: v, unit: 'bytesPerSec', channel: ch });
  }
  return out;
};
export const WEIGHT_KEYS = ['delta_bps', 'read_bytes_per_sec', 'write_bytes_per_sec'];
/* tooltip 附加資訊：只收有限數字（不是權重，不影響守恆） */
const EXTRA_KEYS = ['read_ops', 'write_ops', 'read_latency_us', 'write_latency_us', 'max_iops', 'max_bytes_per_sec'];
export const extraOf = (metrics: unknown): Record<string, number> | null => {
  if (!isObj(metrics)) return null;
  let out: Record<string, number> | null = null;
  for (const k of EXTRA_KEYS) {
    if (num(metrics[k])) { out = out || {}; out[k] = metrics[k]; }
  }
  return out;
};
/* usage 兩欄各自獨立：非有限數或負數就丟該欄；兩欄都沒了就當沒有 usage。絕不填 0。 */
export const usageOf = (u: unknown): NodeUsage | null => {
  if (!isObj(u)) return null;
  let out: NodeUsage | null = null;
  for (const k of ['used_bytes', 'capacity_bytes'] as const) {
    if (num(u[k]) && u[k] >= 0) { out = out || {}; out[k] = u[k]; }
  }
  return out;
};

/* 節點 tooltip 用的附加資訊（health／hardware／perf／alerts）：只收有東西的鍵 */
export const infoOf = (d: WireNodeData): NodeInfo | null => {
  let out: NodeInfo | null = null;
  if (str(d.health)) { out = out || {}; out.health = d.health; }
  if (isObj(d.hardware) && str(d.hardware.model)) { out = out || {}; out.model = d.hardware.model; }
  if (isObj(d.perf)) {
    const perf: Record<string, unknown> = d.perf;
    for (const k of ['cpu_busy_pct', 'total_ops', 'total_latency_us', 'total_bytes_per_sec']) {
      const v = perf[k];
      if (num(v)) { out = out || {}; out.perf = out.perf || {}; out.perf[k] = v; }
    }
  }
  if (Array.isArray(d.alerts)) {
    const al: string[] = [];
    for (const a of d.alerts) {
      if (!isObj(a) || !str(a.name)) continue;
      al.push(str(a.severity) ? a.severity + ' ' + a.name : a.name);
    }
    if (al.length) { out = out || {}; out.alerts = al; }
  }
  return out;
};

/* 無鄰居 interface 上查到的 client（ARP／MAC table／DHCP／CMDB）：一個 port 一張葉卡，
   卡上列出它掛了誰。量測不到 per-client 流量，所以不做一 client 一張卡／一條帶。
   寬鬆處理比照 infoOf() 的 alerts：認不得的鍵忽略（之後後端加 mac／vlan 不會壞），
   ip 與 hostname 都沒有的項目靜默丟棄——只有 owner 在圖上認不出是哪台機器。 */
export const clientsOf = (d: WireNodeData): NodeClient[] | null => {
  if (!Array.isArray(d.clients)) return null;
  const out: NodeClient[] = [];
  for (const c of d.clients) {
    if (!isObj(c) || (!str(c.ip) && !str(c.hostname))) continue;
    out.push({
      ip: str(c.ip) ? c.ip : null,
      hostname: str(c.hostname) ? c.hostname : null,
      owner: str(c.owner) ? c.owner : null
    });
  }
  return out.length ? out : null;
};
