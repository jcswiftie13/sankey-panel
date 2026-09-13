/* layout() 的輸出：model 本身不動，版面另外放在以 id 為鍵的 Map 裡。
   欄位名沿用舊版直接寫在節點／邊上的那套（x1／y1／t1、backT…），路徑產生器與卡片只改讀取來源。 */
import type { TraceEdge, TraceNode, TraceWrapper } from '../model/types.js';

export type SlotRole = 'in' | 'out' | 'back-out' | 'lat-out' | 'lat-in' | 'back-in';

/** 盒子左右兩側的一個 port 槽位：一般邊、橫向邊、回流邊，或殘差色塊（res）。cy 由 place() 指派。 */
export interface Slot {
  edge?: TraceEdge;
  role?: SlotRole;
  iface?: string;
  /** 殘差槽：'in'／'out'；bps 是殘差量 */
  res?: 'in' | 'out';
  bps?: number;
  /** 視覺厚度（已含 THICK_MIN 下限；歸屬線是 OWN_T） */
  t: number;
  cy: number;
}

export interface NodeGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 垂直中心（y + h/2） */
  cy: number;
  leftSlots: Slot[];
  rightSlots: Slot[];
}

export interface EdgeGeom {
  /** 視覺厚度 */
  t: number;
  /** 只跨一欄的回流：走兩欄之間的走廊，不繞圖底 */
  backNear: boolean;
  x1: number; y1: number; t1: number;
  x2: number; y2: number; t2: number;
  /** 橫向弧帶的凸出量 */
  bulge?: number;
  /** 跨多欄回流帶的迴路幾何 */
  backT?: number; backY?: number; backXD?: number; backXU?: number;
}

/** layout:'node' 的 k8s node 外框的版面：model.wrappers 本身不動，座標另存這裡 */
export interface WrapperGeom {
  wrapper: TraceWrapper;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Geometry {
  width: number;
  height: number;
  /** 每欄的節點（已依版面排序；pod 欄在 layout:'node' 時依外框分區） */
  cols: TraceNode[][];
  colX: number[];
  /** 外框（依 label 排序）；flat 或沒有外框時是空陣列 */
  wrappers: WrapperGeom[];
  /** 外框所在的 pod 欄；-1＝沒有外框 */
  podCol: number;
  /** namespace → 顏色（依首次出現順序取自 NS_COLORS） */
  nsColor: Record<string, string>;
  nodes: Map<string, NodeGeom>;
  edges: Map<string, EdgeGeom>;
}
