/* 手寫型別（原始碼是 JS，不轉 TS）。契約細節見 README「輸入 JSON 規格」。 */

/** 單位一律 bps（10 Gbps 寫 10000000000）。 */
export interface TracePort {
  /** switch hop 必填；role node/pod 的 hop 可省略（但要給 peerSwitchId/peerId） */
  iface?: string;
  /** 必填，≥ 0 */
  deltaBps: number;
  /** 對端在 hops 裡找得到同 id → 接成下一台；找不到 → 灰色「追查終止」葉卡 */
  peerSwitchId?: string;
  peerId?: string;
  peerIface?: string;
  /** 自由字串；只有 "pod" 有語意（pod 中繼卡＋自動匯進 namespace 終點） */
  peerKind?: string;
  /** peerKind:"pod" 且對端不在 hops 時必填 */
  namespace?: string;
}

export interface TraceHop {
  switchId: string;
  label?: string;
  /** 自由字串；繪製只認 "node"（天藍虛線盒）與 "pod"（中繼 pod），其他值畫成一般 switch */
  role?: string;
  /** role:"pod" 的中繼 hop 必填 */
  namespace?: string;
  /** 同 tier 鎖同一欄 */
  tier?: string;
  /** 選填，必須 ≥ 0；不給就由平衡式自動補 */
  otherInBps?: number;
  otherOutBps?: number;
  /** 追終點（destination）模式用 */
  outputs?: TracePort[];
  /** 追來源（source）模式用 */
  inputs?: TracePort[];
}

export interface TraceInvestigation {
  /** 必須存在於 hops */
  switchId: string;
  iface: string;
  /** 必須 > 0 */
  deltaBps: number;
  direction?: 'in' | 'out';
  note?: string;
}

export interface TraceDoc {
  /** 省略時看 investigation.direction（out → source）；預設 destination */
  kind?: 'destination' | 'source';
  investigation: TraceInvestigation;
  /** 純註記（宣告上游已截斷過），程式不拿它過濾 */
  pruning?: { topN?: number; minShare?: number };
  hops: TraceHop[];
}

/* ---------- build 的輸出 ---------- */

export interface TraceNode {
  id: string;
  label: string;
  kind: 'hop' | 'leaf' | 'anchor';
  role: string | null;
  namespace: string | null;
  col: number;
  inEdges: TraceEdge[];
  outEdges: TraceEdge[];
  /** 其他欄位（殘差、tier、subOrder…）視為內部實作，別依賴 */
  [key: string]: unknown;
}

export interface TraceEdge {
  id: string;
  from: TraceNode;
  to: TraceNode;
  bps: number;
  isAnchor?: boolean;
  /** 逆著多數流量方向（畫成回流帶） */
  backward?: boolean;
  /** 同欄互連（畫成右側弧帶） */
  lateral?: boolean;
  [key: string]: unknown;
}

export interface TraceModelOk {
  ok: true;
  dir: 'destination' | 'source';
  investigation: TraceInvestigation;
  pruning: { topN?: number; minShare?: number } | null;
  minBps: number;
  /** 被顯示門檻濾掉的帶數與總量 */
  filtered: { edges: number; bps: number };
  /** 被顯示門檻整台移除的節點名 */
  filteredNodes: string[];
  nodes: TraceNode[];
  nodeMap: Record<string, TraceNode>;
  edges: TraceEdge[];
  anchorEdge: TraceEdge;
  root: TraceNode;
  warnings: string[];
  maxCol: number;
}

export interface TraceModelError {
  ok: false;
  errors: string[];
}

export type TraceModel = TraceModelOk | TraceModelError;

/* ---------- 純函式（Node 也能跑） ---------- */

/** 驗證 + 合併 hop + 建邊（含顯示門檻）+ 排欄破環 + 殘差。失敗回 {ok:false, errors}。 */
export function build(doc: unknown, opts?: { minBps?: number }): TraceModel;
/** 只驗證；空陣列＝合法 */
export function validate(doc: unknown): string[];
export function direction(doc: TraceDoc): 'destination' | 'source';
/** 4000000000 → "4 Gbps" 之類的人類可讀格式 */
export function fmtBps(bps: number): string;
/** 同 fmtBps 但帶 + 號（增量永遠顯示成差值） */
export function fmtDelta(bps: number): string;
export function gbps(bps: number): number;
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
  bind(container: HTMLElement, isPanning?: () => boolean): void;
  hide(): void;
  destroy(): void;
}

export function createTooltip(): TooltipInstance;

export interface MountOptions {
  /** 顯示門檻（bps）：只留增量大於它的帶子；0＝不過濾 */
  minBps?: number;
  /** 每次 build 成功（拿 warnings/filtered/edges 拼圖例、統計） */
  onModel?: (model: TraceModelOk) => void;
  /** build 失敗（mount 不畫錯誤 UI，文案是使用端的事） */
  onError?: (errors: string[]) => void;
  /** 縮放倍率變化（螢幕實際倍率；量不到時 null） */
  onZoom?: (screenScale: number | null) => void;
}

export interface MountInstance {
  /** 回傳 build 結果（含 ok:false）。同 doc 同門檻的重複呼叫不重畫、縮放保留。 */
  update(doc?: unknown, opts?: { minBps?: number }): TraceModel;
  setMinBps(minBps: number): TraceModel;
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
