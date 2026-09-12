/* 手寫型別（原始碼是 JS，不轉 TS）。契約細節見 README「輸入 JSON 規格」。 */

/* ---------- 輸入：cytoscape-style wire JSON ---------- */

/** 追查起點，寫在起點節點的 data.investigation。節點本身就是起點所以沒有 node_id；
    放在 elements 裡面，同一份文件丟 cytoscape 也拿得到。全圖最多一個節點帶它。 */
export interface WireNodeInvestigation {
  iface: string;
  /** 必須 > 0，bps */
  delta_bps: number;
  direction?: 'in' | 'out';
  note?: string;
}
/** 頂層形式（deprecated）：多一個 node_id 指向起點節點 */
export interface WireInvestigation extends WireNodeInvestigation {
  /** 必須是 hop 型節點（switch／node／pod／netapp-*／pvc）的 id */
  node_id: string;
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
  /** 我們的擴充：追查起點。只有 hop 型節點能帶，全圖最多一個 */
  investigation?: WireNodeInvestigation;
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
  /** 信封欄位（參考 repo 後端回應帶的）：選填，給了就驗型別、build 原樣帶出，不影響畫圖 */
  apiVersion?: string;
  /** 只列 K8s cluster 名稱（不含 ONTAP cluster）；同上 */
  clusters?: string[];
  /** 省略時看起點的 direction（out → source）；預設 destination */
  kind?: 'destination' | 'source';
  /** @deprecated 起點請寫在起點節點的 data.investigation（見 WireNodeInvestigation）。頂層形式仍接受，
      build 會發警告；兩處都給是驗證錯誤。沒給就沒有錨卡、不查 root */
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
  /** 推導邊（pod→app→ns、port→owner）：同一筆量測重新分組，不是後端量的一條 flow */
  derived?: boolean;
  /** 推導邊的欄對：'pod-application' | 'application-namespace' | 'pod-namespace'；後端邊是 labels.tier 原值 */
  tier?: string | null;
  [key: string]: unknown;
}

export interface TraceModelOk {
  ok: true;
  dir: 'destination' | 'source';
  /** 正規化後的起點（不論輸入寫在節點 data 還是 deprecated 的頂層），沒有就是 null */
  investigation: WireInvestigation | null;
  /** 信封欄位原樣帶出；輸入沒給就是 null */
  apiVersion: string | null;
  clusters: string[] | null;
  layout: 'flat' | 'node';
  /** layout:'node' 才會有內容 */
  wrappers: TraceWrapper[];
  /** 正規化後的 roots（五個鍵都在）；沒給就是 null */
  roots: Required<StorageRoots> | null;
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

/** 參考面板的 root 選擇（{@link https://github.com/akira-core/kube-state-graph-frontend} 的 StorageGraphRoots）。
    只用來「保留」no-flow 節點，絕不用來過濾。 */
export interface StorageRoots {
  /** 涵蓋該 ONTAP cluster 底下的 netapp-node／aggr／svm */
  ontap_cluster?: string[];
  /** 同時比對 NetApp controller 與 k8s node 的名字 */
  node?: string[];
  aggr?: string[];
  svm?: string[];
  /** `<namespace>/<pod>` */
  pod?: string[];
}

/** layout:'node' 的 k8s node 外框：不是圖節點（沒有邊、不排欄、不算殘差），只包住 pod 欄裡它的 pod */
export interface TraceWrapper {
  id: string;
  label: string;
  role: 'node';
  kind: 'wrapper';
  /** node 自己與成員 pod 的最差值；都沒有就 null（中性框） */
  status: 'normal' | 'warning' | 'critical' | null;
  /** 成員葉 pod 的 id（門檻／通道濾掉的不算） */
  podIds: string[];
  /** 沒有成員（只因為是 root 才畫） */
  noFlow: boolean;
  [key: string]: unknown;
}

export interface BuildOptions {
  /** 顯示門檻：只留值大於它的帶子；0＝不過濾 */
  minBps?: number;
  /** storage 資料只看其中一個通道；被藏的通道併進其他輸入／其他輸出。無通道的邊不受影響 */
  channels?: 'both' | Channel;
  /** 'flat'（預設）不畫 k8s node；'node' 把只被 pod-node 邊碰到的 k8s node 畫成 pod 欄的外框 */
  layout?: 'flat' | 'node';
  /** 沒給＝所有 no-flow hop 都保留；給了（含空物件）＝只保留 root 與完全沒被任何邊碰到的 */
  roots?: StorageRoots | null;
}

/* ---------- 純函式（Node 也能跑） ---------- */

/** 驗證 + 分類節點 + 加總同鍵的邊（含顯示門檻／通道）+ 排欄破環 + 殘差。失敗回 {ok:false, errors}。 */
export function build(doc: unknown, opts?: BuildOptions): TraceModel;
/** 只驗證；空陣列＝合法 */
export function validate(doc: unknown): string[];
export function direction(doc: WireGraph): 'destination' | 'source';
/** 4000000000 → "4 Gbps" 之類的人類可讀格式 */
export function fmtBps(bps: number): string;
/** 同 fmtBps 但帶 + 號（增量永遠顯示成差值） */
export function fmtDelta(bps: number): string;
/** SI 1000 進位、3 位有效數字：700000000000 → "700 GB" */
export function fmtBytes(bytes: number): string;
/** 依單位選尺：bps 走 fmtDelta（帶號），bytesPerSec 走 fmtBytes + "/s"（不帶號） */
export function fmtRate(value: number, unit: RateUnit): string;
/** 同 fmtRate 但 bps 也不帶號 */
export function fmtAmount(value: number, unit: RateUnit): string;
export function gbps(bps: number): number;
export const HOP_TYPES: string[];
export const GROUP_TYPES: string[];
export const FLOW_TYPES: string[];
export const TYPE_LABEL: Record<string, string>;
/** 完整 SVG 字串（<svg …>…</svg>）；樣式要另外載 trace-sankey/style.css */
export function render(model: TraceModelOk): string;
/** hop 數字摘要表 + warnings 的 HTML 字串 */
export function summary(model: TraceModelOk): string;
export function esc(s: unknown): string;

/* ---------- 瀏覽器互動層 ---------- */

export interface ZoomInstance {
  /** wrap 內要有 svg 與 <g class="zoom-layer">；同一 layer 重 attach 沿用縮放 */
  attach(wrap: HTMLElement, opts?: {
    onPanStart?: () => void;
    onPanEnd?: () => void;
    /** 螢幕實際倍率（1 = 原始大小）；量不到（display:none）時是 null */
    onChange?: (screenScale: number | null) => void;
  }): boolean;
  detach(): void;
  /** 徹底收掉：解綁全部 listener，之後這個實例不能再用 */
  dispose(): void;
  refresh(): void;
  fit(): void;
  actual(): void;
  zoomBy(factor: number): void;
  step: number;
  isPanning(): boolean;
}

export function createZoom(): ZoomInstance;
/** 工具列／快捷鍵的一格倍率（= 實例的 step） */
export const zoomStep: number;

export interface TooltipInstance {
  /** 綁 .band 與帶 data-tip 的卡片 <g> */
  bind(container: HTMLElement, isPanning?: () => boolean): void;
  hide(): void;
  destroy(): void;
}

export function createTooltip(): TooltipInstance;

export interface MountOptions extends BuildOptions {
  /** 每次 build 成功（拿 warnings/filtered/edges 拼圖例、統計） */
  onModel?: (model: TraceModelOk) => void;
  /** build 失敗（mount 不畫錯誤 UI，文案是使用端的事） */
  onError?: (errors: string[]) => void;
  /** 縮放倍率變化（螢幕實際倍率；量不到時 null） */
  onZoom?: (screenScale: number | null) => void;
  /** 滑到卡片亮整條上下游路徑、其餘變淡（預設關）。掛載時決定 */
  pathHighlight?: boolean;
  /** 點擊卡片。只有可定位的卡會綁：hop（netapp-svm 除外）、葉 pod、k8s node 外框；
      namespace／application／owner／錨卡／host 葉不綁（參考面板 Locate 的 locatable 規則） */
  onNodeClick?: (id: string, node: TraceNode | TraceWrapper) => void;
}

export interface MountInstance {
  /** 回傳 build 結果（含 ok:false）。同 doc 同選項的重複呼叫不重畫、縮放保留。 */
  update(doc?: unknown, opts?: BuildOptions): TraceModel;
  setMinBps(minBps: number): TraceModel;
  setChannels(channels: 'both' | Channel): TraceModel;
  setLayout(layout: 'flat' | 'node'): TraceModel;
  setRoots(roots: StorageRoots | null): TraceModel;
  /** 專注模式：toggle body.chart-focus（純 CSS，不用 Fullscreen API）並 refresh 縮放 */
  focus(on: boolean): void;
  isFocused(): boolean;
  /** 最近一次成功 build 的 model（失敗後是 null） */
  readonly model: TraceModelOk | null;
  zoom: Pick<ZoomInstance, 'fit' | 'actual' | 'zoomBy' | 'refresh' | 'step' | 'isPanning'>;
  /** 容器尺寸變了呼叫這個 */
  refresh(): void;
  /** 冪等；解綁 listener、移除 body 上的 tooltip、清空容器 */
  destroy(): void;
}

/** 容器要先有高度再 mount（fit 用容器實際大小算）；高度由使用端 CSS 決定 */
export function mount(el: HTMLElement, doc: unknown, opts?: MountOptions): MountInstance;
