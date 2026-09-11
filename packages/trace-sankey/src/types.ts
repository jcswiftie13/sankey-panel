/* 型別：wire JSON 契約與 build() 的輸出。原始碼是 TS，這裡只放介面；契約細節見 README「輸入 JSON 規格」。 */

/* ---------- 輸入：cytoscape-style wire JSON ---------- */

export interface WireInvestigation {
  /** 必須是 hop 型節點（switch／node／pod／netapp-*／pvc）的 id */
  node_id: string;
  iface: string;
  /** 必須 > 0，bps */
  delta_bps: number;
  direction?: 'in' | 'out';
  note?: string;
}

export interface WireUsage {
  /** 兩欄各自獨立；非有限數或負數就丟該欄，絕不填 0 */
  used_bytes?: number;
  capacity_bytes?: number;
}

/** 無鄰居 interface 上查到的 client（ARP／MAC table／DHCP／CMDB）。
    三個欄位都選填，但至少要有 ip 或 hostname，否則該筆靜默丟棄。
    認不得的鍵忽略——之後加 mac／vlan 不必改契約。 */
export interface WireClient {
  ip?: string;
  hostname?: string;
  owner?: string;
  [k: string]: unknown;
}

export interface WireNodeData {
  /** 必填、不可重複 */
  id: string;
  /** 必填。hop 型：switch／node／pod／netapp-node／netapp-aggr／netapp-svm／pvc；
      群組型（只當 parent）：namespace／application／cluster／storage-cluster／controller；
      其他任何值畫成「追查終止」葉卡 */
  type: string;
  /** 卡片標題，缺就用 id */
  name?: string;
  /** 群組鏈：pod 的 application／namespace 由此推導 */
  parent?: string;
  /** 純字串對應表。認得的鍵：namespace、tier（同欄鎖）、ontap_cluster */
  labels?: Record<string, string>;
  /** normal／warning／critical；其他值視同沒有（中性框） */
  status?: string;
  usage?: WireUsage;
  health?: string;
  hardware?: { model?: string; [k: string]: unknown };
  perf?: { cpu_busy_pct?: number; total_ops?: number; total_latency_us?: number; total_bytes_per_sec?: number };
  alerts?: Array<{ name: string; severity?: string; [k: string]: unknown }>;
  /** 我們的擴充：這個 port 上掛了誰。只有葉卡會畫到卡面上，其他型別只進 tooltip。
      不是陣列是驗證錯誤 */
  clients?: WireClient[];
  /** 我們的擴充：顯式殘差，≥ 0；不給就由平衡式自動補 */
  other_in_bps?: number;
  other_out_bps?: number;
  [k: string]: unknown;
}

export interface WireIoMetrics {
  /** switch 追查：速率增量（bps）。有它就是一條無通道的帶 */
  delta_bps?: number;
  /** storage：絕對速率（bytes/s）。各自存在就各一條帶（read／write 通道） */
  read_bytes_per_sec?: number;
  write_bytes_per_sec?: number;
  read_ops?: number;
  write_ops?: number;
  read_latency_us?: number;
  write_latency_us?: number;
  max_iops?: number;
  max_bytes_per_sec?: number;
  /** 有 rate 鍵＝RED 家族（trace 呼叫邊），整個 metrics 忽略 */
  rate?: number;
  [k: string]: unknown;
}

export interface WireEdgeData {
  /** 必填、不可重複 */
  id: string;
  /** 只有 network-flow／storage-flow 會畫，其他 type 整條忽略 */
  type: string;
  /** 一律封包方向 */
  source: string;
  target: string;
  /** 認得的鍵：source_iface、target_iface、tier（pod-node 忽略）、attribution */
  labels?: Record<string, string>;
  metrics?: WireIoMetrics;
}

export interface WireGraph {
  apiVersion?: string;
  clusters?: string[];
  /** 省略時看 investigation.direction（out → source）；預設 destination */
  kind?: 'destination' | 'source';
  /** 選填；沒給就沒有錨卡、不查 root */
  investigation?: WireInvestigation;
  elements: {
    nodes: Array<{ data: WireNodeData }>;
    edges: Array<{ data: WireEdgeData }>;
  };
}

/* ---------- build 的輸出 ---------- */

export type Channel = 'read' | 'write';
export type RateUnit = 'bps' | 'bytesPerSec';

export interface TraceNode {
  id: string;
  label: string;
  kind: 'node' | 'leaf' | 'anchor';
  /** hop：= type；葉：'leaf'／'pod'／'ns'／'app'／'owner'；錨：'anchor' */
  role: string | null;
  namespace: string | null;
  status?: 'normal' | 'warning' | 'critical' | null;
  /** 顯示單位（跟著身上的邊） */
  unit?: RateUnit;
  col: number;
  inEdges: TraceEdge[];
  outEdges: TraceEdge[];
  /** 其他欄位（殘差、tier、subOrder、usage、info…）視為內部實作，別依賴 */
  [key: string]: unknown;
}

export interface TraceEdge {
  id: string;
  fromId: string;
  toId: string;
  /** 該邊的值（單位見 unit） */
  bps: number;
  unit: RateUnit;
  /** storage 資料的 read／write 帶；switch 追查與推導邊是 null */
  channel: Channel | null;
  isAnchor?: boolean;
  /** 逆著多數流量方向（畫成回流帶） */
  backward?: boolean;
  /** 同欄互連（畫成右側弧帶） */
  lateral?: boolean;
  /** 歸屬線：port 上掛著多個 owner，量停在 port，這條邊只表達歸屬，bps 恆 0 */
  owns?: boolean;
  [key: string]: unknown;
}

export interface TraceModelOk {
  ok: true;
  dir: 'destination' | 'source';
  investigation: WireInvestigation | null;
  channels: 'both' | Channel;
  minBps: number;
  /** 被顯示門檻濾掉的帶數與總量 */
  filtered: { edges: number; bps: number };
  /** 被顯示門檻整台移除的節點名 */
  filteredNodes: string[];
  nodes: TraceNode[];
  nodeMap: Record<string, TraceNode>;
  edges: TraceEdge[];
  anchorEdge: TraceEdge | null;
  root: TraceNode | null;
  warnings: string[];
  maxCol: number;
}

export interface TraceModelError {
  ok: false;
  errors: string[];
}

export type TraceModel = TraceModelOk | TraceModelError;

export interface BuildOptions {
  /** 顯示門檻：只留值大於它的帶子；0＝不過濾 */
  minBps?: number;
  /** storage 資料只看其中一個通道；被藏的通道併進其他輸入／其他輸出。無通道的邊不受影響 */
  channels?: 'both' | Channel;
}

