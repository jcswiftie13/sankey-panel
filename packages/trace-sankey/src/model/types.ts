/* 型別：wire JSON 契約、build() 的輸出、以及 build() 各步驟共用的內部狀態。契約細節見 README「輸入 JSON 規格」。 */

/* ---------- 輸入：cytoscape-style wire JSON ---------- */

/** 追查起點，寫在起點節點的 data.investigation 上（節點自己就是起點，所以沒有 node_id）。
    全圖最多一個、節點必須是 hop 型（switch／node／pod／netapp-*／pvc）。 */
export interface WireNodeInvestigation {
  iface: string;
  /** 必須 > 0，bps */
  delta_bps: number;
  direction?: 'in' | 'out';
  note?: string;
}

/** 頂層形式（deprecated）：多一個 node_id。build 仍接受並發警告；與節點形式兩處都給是驗證錯誤。
    也是 resolveInvestigation() 正規化後的形狀，model.investigation 一律長這樣。 */
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
  /** 追查起點寫在起點節點上（全圖最多一個、必須 hop 型） */
  investigation?: WireNodeInvestigation;
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
  /** 信封欄位（參考 repo 的後端回應帶這兩欄）：給了驗型別、build 原樣帶出，不影響畫圖 */
  apiVersion?: string;
  clusters?: string[];
  /** 省略時看 investigation.direction（out → source）；預設 destination */
  kind?: 'destination' | 'source';
  /** @deprecated 起點請寫在起點節點的 data.investigation（見 WireNodeData）。仍接受，build 會發警告；
      與節點形式兩處都給是驗證錯誤。沒有起點就沒有錨卡、不查 root */
  investigation?: WireInvestigation;
  elements: {
    nodes: Array<{ data: WireNodeData }>;
    edges: Array<{ data: WireEdgeData }>;
  };
}

/* ---------- build 的輸出 ---------- */

export type Channel = 'read' | 'write';
export type RateUnit = 'bps' | 'bytesPerSec';

export interface NodeInfo {
  health?: string;
  model?: string;
  perf?: Record<string, number>;
  alerts?: string[];
}
export interface NodeUsage { used_bytes?: number; capacity_bytes?: number }
export interface NodeClient { ip: string | null; hostname: string | null; owner: string | null }

/** 圖上的一個節點。kind 決定畫法：'node'＝hop 盒、'leaf'＝終點卡（role 再分 leaf／pod／ns／app／owner）、
    'anchor'＝追查起點卡。各 kind 只用到自己那一組欄位；沒有做成 discriminated union 是因為
    build() 各步驟會在同一個物件上陸續補欄位（步驟 3 的 isRoot、5 的 col／subOrder、6 的殘差）。 */
export interface TraceNode {
  id: string;
  label: string;
  kind: 'node' | 'leaf' | 'anchor';
  /** hop：= type；葉：'leaf'／'pod'／'ns'／'app'／'owner'；錨：'anchor' */
  role: string;
  /** 錨卡沒有這個鍵 */
  namespace?: string | null;
  col: number;
  inEdges: TraceEdge[];
  outEdges: TraceEdge[];
  /* hop 與葉共有 */
  tier?: string | null;
  ontapCluster?: string | null;
  status?: Status | null;
  usage?: NodeUsage | null;
  info?: NodeInfo | null;
  clients?: NodeClient[] | null;
  /** 顯示單位（跟著身上的邊）；步驟 6 才有 */
  unit?: RateUnit;
  /** layout:'node'：這個葉 pod 被哪台 k8s node 外框包住（wrapper 的 id）；步驟 6b 才有 */
  k8sNode?: string;
  /* hop */
  otherInBps?: number | null;
  otherOutBps?: number | null;
  noFlow?: boolean;
  isRoot?: boolean;
  subOrder?: number;
  tracedIn?: number;
  tracedOut?: number;
  otherIn?: number;
  otherOut?: number;
  totalIn?: number;
  totalOut?: number;
  resEps?: number;
  /* 葉 */
  type?: string;
  named?: boolean;
  iface?: string;
  localIface?: string;
  peerKind?: string;
  bps?: number;
  podCount?: number;
  ownerLinked?: boolean;
  /** app 卡：全 app 共用的 app→ns 邊，每個通道一條（鍵 ''＝無通道、'read'、'write'） */
  nsEdges?: Record<string, TraceEdge>;
  /* owner 卡 */
  owner?: string;
  clientCount?: number;
  portCount?: number;
  meteredPorts?: number;
  /* 錨卡 */
  note?: string;
  dirLabel?: 'in' | 'out';
}

export interface TraceEdge {
  /** 步驟 4 才編號（'e' + 序號） */
  id: string;
  fromId: string;
  toId: string;
  fromIface: string;
  toIface: string;
  /** 該邊的值（單位見 unit） */
  bps: number;
  unit: RateUnit;
  /** storage 資料的 read／write 帶；switch 追查與推導邊是 null */
  channel: Channel | null;
  tier: string | null;
  attribution: string | null;
  extra: Record<string, number> | null;
  namespace: string | null;
  /** pod→app→ns 或葉→owner 的推導邊（同一筆量的重新分組，不是量測）。
      推導邊的 tier 是參考面板的欄對詞：pod-application／application-namespace／pod-namespace */
  derived?: boolean;
  /** 歸屬線：port 上掛著多個 owner，量停在 port，這條邊只表達歸屬，bps 恆 0 */
  owns?: boolean;
  isAnchor?: boolean;
  /** 破環時退出排欄的邊（步驟 5d） */
  dropped?: boolean;
  /** 逆著多數流量方向（畫成回流帶） */
  backward?: boolean;
  /** 同欄互連（畫成右側弧帶） */
  lateral?: boolean;
}

/** 參考面板的 root 選擇；每個鍵是名字陣列，pod 寫成「namespace/name」 */
export interface StorageRoots {
  ontap_cluster?: string[];
  node?: string[];
  aggr?: string[];
  svm?: string[];
  pod?: string[];
}

/** layout:'node' 的 k8s node 外框。不是圖節點：不進 nodes／nodeMap、沒有邊、不排欄、不算殘差。 */
export interface TraceWrapper {
  id: string;
  label: string;
  role: 'node';
  kind: 'wrapper';
  /** node 自己與成員 pod 的最差值 */
  status: Status | null;
  /** 成員葉 pod 的 id（門檻／通道濾掉的不算） */
  podIds: string[];
  /** 沒有成員（被選成 root 才會留下）：畫成空外框 */
  noFlow: boolean;
  info: NodeInfo | null;
  usage: NodeUsage | null;
}

export interface TraceModelOk {
  ok: true;
  dir: Direction;
  /** 正規化後的起點（不論輸入寫在節點還是頂層），沒有就 null */
  investigation: WireInvestigation | null;
  channels: Channels;
  layout: 'flat' | 'node';
  wrappers: TraceWrapper[];
  /** 正規化後的 roots（每個鍵都有陣列）；沒給就 null */
  roots: Required<StorageRoots> | null;
  /** 信封欄位原樣帶出（沒給就 null） */
  apiVersion: string | null;
  clusters: string[] | null;
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
  channels?: Channels;
  /** 'flat'（預設）不畫 k8s node；'node' 把只被 pod-node 邊碰到的 k8s node 畫成包住它 pod 的外框
      （參考面板的 Layout: Node）。資料要有 tier:"pod-node" 的邊 */
  layout?: 'flat' | 'node';
  /** 參考面板的 root 選擇。省略＝現行超集（no-flow hop 全保留）；給了（含空物件）＝參考規則。
      root 只用來保留、絕不用來過濾 */
  roots?: StorageRoots | null;
}


/* ---------- 內部：build() 各步驟共用的狀態 ---------- */

export type Direction = 'destination' | 'source';
export type Channels = 'both' | Channel;
export type Status = 'normal' | 'warning' | 'critical';

/** weightOf() 拆出來的一個通道：switch 追查是一條無通道的 bps；storage 是 read／write 各一條 */
export interface Weight { value: number; unit: RateUnit; channel: Channel | null }

/** 1a 加總後的一條邊（同 source／target／iface／channel 合一） */
export interface AggEdge {
  src: string; tgt: string; sif: string; tif: string;
  channel: Channel | null; unit: RateUnit; bps: number;
  tier: string | null; attribution: string | null; extra: Record<string, number> | null;
}

/** 步驟 0 的 id 索引 + parent 鏈查詢 */
export interface RawIndex {
  get(id: string): WireNodeData | null;
  ancestorOf(id: string, type: string): WireNodeData | null;
  appOf(id: string): WireNodeData | null;
  nsOfPod(id: string): string | null;
}

/** 從步驟 1a 一路傳到步驟 7 的可變狀態；每個 step 模組吃它、改它。
    表分兩種：只做 membership 的用 Set／Map；會被迭代、輸出、或鍵序有意義的維持 plain object
    （nodes 就是輸出的 nodeMap，鍵是原始 id）。 */
export interface BuildCtx {
  doc: WireGraph;
  dir: Direction;
  inv: WireInvestigation | null;
  /** 起點寫在哪：'top' 會發 deprecated 警告 */
  invSource: 'top' | 'node' | null;
  minBps: number;
  channels: Channels;
  layout: 'flat' | 'node';
  roots: Required<StorageRoots> | null;
  warnings: string[];
  raw: RawIndex;
  /* 1a */
  flowTouch: Set<string>;
  podNodeTouch: Set<string>;
  drawTouch: Set<string>;
  contOut: Map<string, number>;
  contIn: Map<string, number>;
  agg: Record<string, AggEdge>;
  aggOrder: string[];
  /** k8s node id → 它上面的 pod id（照 pod-node 邊出現順序） */
  k8sPods: Map<string, string[]>;
  /* 1b／2 */
  nodes: Record<string, TraceNode>;
  order: string[];
  edges: TraceEdge[];
  dropIn: Record<string, number>;
  dropOut: Record<string, number>;
  /** layout:'node' 時只被 pod-node 邊碰到的 k8s node，等 pod 建好再變成外框 */
  k8sRaw: WireNodeData[];
  /** 被選成 root 卻沒有任何可畫的邊的葉 pod，步驟 2 之後補成 no-flow 卡 */
  rootLeafPods: string[];
  filteredCount: number;
  filteredBps: number;
  hiddenChannel: number;
  /* 3 */
  root: TraceNode | null;
  anchorEdge: TraceEdge | null;
  /* 4b */
  filteredNodes: string[];
  /* 6b */
  wrappers: TraceWrapper[];
}
