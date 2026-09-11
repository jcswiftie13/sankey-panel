/* 版面計算：純函式，吃 model 回 Geometry，不改 model。
   （舊版直接把 x／y／槽位寫在節點與邊上；改成另存 Map 之後 React 的 useMemo(() => layout(model))
   才是誠實的，onModel 交給使用端的 model 也不會被偷偷加欄位。） */
import type { TraceEdge, TraceModelOk, TraceNode } from '../model/types.js';
import type { EdgeGeom, Geometry, NodeGeom, Slot } from './geometry.js';
import {
  ANCHOR_W, BODY_MIN, BODY_PAD, COL_GAP, NODE_W, NS_COLORS, OWN_T,
  PAD_BOTTOM, PAD_SIDE, PAD_TOP, ROW_GAP, ROW_H, THICK_MAX, THICK_MIN, VGAP
} from './constants.js';
import { clientW, headerH, leafH, resIn, resOut } from './text.js';

const stackH = (slots: Slot[]): number => {
  if (!slots.length) return 0;
  return slots.reduce((s, x) => s + Math.max(x.t, ROW_H), 0) + (slots.length - 1) * ROW_GAP;
};
const place = (slots: Slot[], top: number, avail: number): void => {
  const h = stackH(slots);
  let cur = top + Math.max(0, (avail - h) / 2);
  for (const s of slots) {
    const sh = Math.max(s.t, ROW_H);
    s.cy = cur + sh / 2;
    cur += sh + ROW_GAP;
  }
};

/* 排欄用的暫存鍵（舊版的 __pref／__ord／__hasXParent／__nsPref／__nsIdx） */
interface SortKeys { pref: number; ord: number; hasXParent: boolean; nsPref: number | null; nsIdx: number }

export const layout = (model: TraceModelOk): Geometry => {
  const nodes = model.nodes, edges = model.edges;
  const gn = new Map<string, NodeGeom>();
  const ge = new Map<string, EdgeGeom>();
  const N = (id: string): NodeGeom => gn.get(id)!;
  const E = (e: TraceEdge): EdgeGeom => ge.get(e.id)!;

  /* namespace → 顏色：掃節點（葉與 hop 級 ns 都算）依首次出現順序取色 */
  const nsColor: Record<string, string> = {};
  for (const n of nodes) {
    if (n.namespace && nsColor[n.namespace] == null) {
      nsColor[n.namespace] = NS_COLORS[Object.keys(nsColor).length % NS_COLORS.length];
    }
  }

  /* 殘差跟青帶共用同一把比例尺，比例才讀得出來。殘差比所有邊都大時青帶會變細，
     那正是「沒追到的佔大多數」該有的觀感。 */
  let maxVal = 0;
  for (const e of edges) maxVal = Math.max(maxVal, e.bps);
  for (const n of nodes) maxVal = Math.max(maxVal, resIn(n), resOut(n));
  if (maxVal <= 0) maxVal = 1;
  const scale = THICK_MAX / maxVal;
  const thick = (v: number): number => Math.max(THICK_MIN, v * scale);

  /* 每條邊的視覺厚度。歸屬線（owns）沒有量測值、bps 恆 0，照 thick() 會拿到 THICK_MIN
     的實心帶，讀起來像一條很小的流量——固定給一條細線，語意上才是「只有歸屬、沒有量」。
     其餘邊 t === thick(e.bps)，沒有 owner 層的圖槽位逐 byte 不變。
     只跨一欄的回流（backNear）：兩欄之間的走廊共用、中間沒有盒子，port 掛相向的邊緣
     （source 左緣、target 右緣）就能整條畫在走廊裡，跟一般帶一樣短。
     跨兩欄以上的才需要繞圖底外圈。 */
  for (const e of edges) {
    ge.set(e.id, {
      t: e.owns ? OWN_T : thick(e.bps),
      backNear: !!e.backward && model.nodeMap[e.fromId].col - model.nodeMap[e.toId].col === 1,
      x1: 0, y1: 0, t1: 0, x2: 0, y2: 0, t2: 0
    });
  }
  const near = (e: TraceEdge): boolean => E(e).backNear;
  const slot = (e: TraceEdge, role: Slot['role'], iface: string): Slot => ({ edge: e, role, iface, t: E(e).t, cy: 0 });

  /* 每個節點的 port 槽位。橫向邊（同 tier 同欄互連）兩端都掛右側：
     弧帶整條活在欄右側的間隙，受端若從左邊進就得繞過整個盒子。 */
  for (const n of nodes) {
    /* 相鄰欄回流（backNear）：out 掛 source 左緣、in 掛 target 右緣（相向），
       槽位排最後（殘差之前）。跨多欄的回流維持 in 左緣、out 右緣、也排最後：
       迴路帶從盒子疊的最下方出入，往下繞出圖外時才不會跨過自己的其他帶。 */
    const leftSlots: Slot[] = n.inEdges.filter((e) => !e.lateral && !e.backward).map((e) => slot(e, 'in', e.toIface))
      .concat(n.inEdges.filter((e) => e.backward && !near(e)).map((e) => slot(e, 'in', e.toIface)))
      .concat(n.outEdges.filter((e) => near(e)).map((e) => slot(e, 'back-out', e.fromIface)));
    const rightSlots: Slot[] = n.outEdges.filter((e) => !e.lateral && !e.backward).map((e) => slot(e, 'out', e.fromIface))
      .concat(n.outEdges.filter((e) => e.lateral).map((e) => slot(e, 'lat-out', e.fromIface)))
      .concat(n.inEdges.filter((e) => e.lateral).map((e) => slot(e, 'lat-in', e.toIface)))
      .concat(n.inEdges.filter((e) => near(e)).map((e) => slot(e, 'back-in', e.toIface)))
      .concat(n.outEdges.filter((e) => e.backward && !near(e)).map((e) => slot(e, 'out', e.fromIface)));
    /* 殘差是真的槽位，排在已追查 port 之後（最外側），才會跟它們一起被 place() 置中。
       放最外側而不是插在中間：place() 依順序指派 cy，插中間會把下面所有帶子往下推、
       憑空製造交叉。 */
    const ri = resIn(n), ro = resOut(n);
    if (ri) leftSlots.push({ res: 'in', bps: ri, t: thick(ri), cy: 0 });
    if (ro) rightSlots.push({ res: 'out', bps: ro, t: thick(ro), cy: 0 });

    const lh = stackH(leftSlots), rh = stackH(rightSlots);
    let w: number, h: number;
    if (n.kind === 'node') {
      w = NODE_W;
      h = headerH(n) + Math.max(lh, rh, BODY_MIN) + BODY_PAD;
    } else if (n.kind === 'leaf') {
      w = clientW(n); h = Math.max(leafH(n), lh, rh);
    } else {
      w = ANCHOR_W; h = Math.max(66, lh, rh);
    }
    gn.set(n.id, { x: 0, y: 0, w, h, cy: 0, leftSlots, rightSlots });
  }

  /* 欄位 x */
  const cols: TraceNode[][] = [];
  for (const n of nodes) (cols[n.col] = cols[n.col] || []).push(n);
  let x = PAD_SIDE;
  const colX: number[] = [];
  for (let c = 0; c < cols.length; c++) {
    const list = cols[c] || [];
    const w = list.reduce((m, n) => Math.max(m, N(n.id).w), NODE_W);
    colX[c] = x;
    for (const n of list) N(n.id).x = x;
    x += w + COL_GAP;
  }
  const totalW = x - COL_GAP + PAD_SIDE;

  /* 欄位 y：先照上游中心排序，再整欄對齊上游重心 */
  const keys = new Map<string, SortKeys>();
  const K = (n: TraceNode): SortKeys => keys.get(n.id)!;
  /* 已排完的欄才有中心 y（舊版靠 typeof __cy === 'number' 判斷） */
  const cyOf = new Map<string, number>();
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci] || [];
    col.forEach((n, i) => {
      const parents = n.inEdges.filter((e) => {
        const p = model.nodeMap[e.fromId];
        return p.col < n.col && cyOf.has(p.id);
      });
      keys.set(n.id, {
        hasXParent: parents.length > 0,
        pref: parents.length
          ? parents.reduce((s, e) => s + cyOf.get(e.fromId)!, 0) / parents.length
          : i * 1e-3,
        ord: i, nsPref: null, nsIdx: 0
      });
    });
    /* 只被同欄餵的節點（如 dci）沒有跨欄父節點：pref 繼承橫向上游，
       平手時再靠 subOrder 落在生產者與消費者之間。照 subOrder 走可沿鏈傳遞。 */
    for (const n of col.slice().sort((a, b) => (a.subOrder || 0) - (b.subOrder || 0))) {
      if (K(n).hasXParent) continue;
      const lat = n.inEdges.filter((e) => e.lateral);
      if (lat.length) {
        K(n).pref = lat.reduce((s, e) => s + K(model.nodeMap[e.fromId]).pref, 0) / lat.length;
      }
    }
    /* pod 葉依 namespace 分組：同 ns 的 pod 共用「組平均 pref」當第一排序鍵，
       整組相鄰排列；組間平手再用 ns 首次出現序拆。組內仍照各自 pref（上游重心），
       跨 node 的同 ns pod 相鄰但各自貼近自己的上游。只有帶 ns 的 pod 葉會設
       nsPref——沒有 pod 的圖兩個新鍵全空，比較器退化成原本的三鍵，輸出不變。
       注意 source 模式 pod 在第 0 欄沒有跨欄上游、pref 是輸入順序：分組照文件順序聚攏。 */
    const nsAgg: Record<string, { s: number; c: number; idx: number }> = {};
    let nsSeq = 0;
    for (const n of col) {
      if (n.kind !== 'leaf' || n.role !== 'pod' || !n.namespace) continue;
      const a = nsAgg[n.namespace] || (nsAgg[n.namespace] = { s: 0, c: 0, idx: ++nsSeq });
      a.s += K(n).pref; a.c++;
    }
    for (const n of col) {
      if (n.kind !== 'leaf' || n.role !== 'pod' || !n.namespace) continue;
      const a = nsAgg[n.namespace];
      K(n).nsPref = a.s / a.c;
      K(n).nsIdx = a.idx;
    }
    col.sort((a, b) => {
      const A = K(a), B = K(b);
      const ka = A.nsPref != null ? A.nsPref : A.pref;
      const kb = B.nsPref != null ? B.nsPref : B.pref;
      return (ka - kb) || (A.nsIdx - B.nsIdx) || (A.pref - B.pref) ||
        ((a.subOrder || 0) - (b.subOrder || 0)) || (A.ord - B.ord);
    });
    let y = 0;
    for (const n of col) { N(n.id).y = y; y += N(n.id).h + VGAP; }
    const blockH = Math.max(0, y - VGAP);
    const prefAvg = col.reduce((s, n) => s + K(n).pref, 0) / (col.length || 1);
    const shift = col.length && ci > 0 ? (prefAvg - blockH / 2) : 0;
    for (const n of col) {
      const g = N(n.id);
      g.y += shift;
      cyOf.set(n.id, g.y + g.h / 2);
    }
  }

  /* 正規化 y（空模型：沒有 investigation 的圖被門檻濾光時，minY/maxY 給 0 免得算出 NaN viewBox） */
  let minY = nodes.length ? Infinity : 0, maxY = nodes.length ? -Infinity : 0;
  for (const n of nodes) { const g = N(n.id); minY = Math.min(minY, g.y); maxY = Math.max(maxY, g.y + g.h); }
  const dy = PAD_TOP - minY;
  for (const n of nodes) { const g = N(n.id); g.y += dy; g.cy = g.y + g.h / 2; }
  let totalH = (maxY + dy) + PAD_BOTTOM;

  /* pod 依 ns 分組後，欄內順序可能偏離 hop 上 port 的宣告順序，帶子會互穿。
     把「對端是帶 ns 的 pod 葉」的槽位依對端的 y 重排（寫回原本的索引位置，
     其他槽位含殘差槽原地不動）——只有 pod 葉邊會被重排，非 k8s 圖槽位順序逐 byte 不變。
     ns 終點也要重排：多台 node 的 pod 匯進同一個 ns，匯流帶照 pod 的 y 排才不互穿。 */
  const farOf = (sl: Slot): TraceNode => model.nodeMap[sl.role === 'in' ? sl.edge!.fromId : sl.edge!.toId];
  /* 依對端的 y 重排 want() 挑中的槽位，寫回原本的索引位置——其他槽位（含殘差槽）原地不動 */
  const reorderSlots = (slots: Slot[], want: (f: TraceNode) => unknown): void => {
    const idxs: number[] = [];
    slots.forEach((sl, i) => {
      if (!sl.edge || sl.edge.lateral || sl.edge.backward) return;
      if (want(farOf(sl))) idxs.push(i);
    });
    if (idxs.length < 2) return;
    const picked = idxs.map((i) => slots[i]);
    picked.sort((a, b) => N(farOf(a).id).y - N(farOf(b).id).y);
    idxs.forEach((i, k) => { slots[i] = picked[k]; });
  };
  for (const n of nodes) {
    if (n.kind !== 'node' && n.role !== 'ns' && n.role !== 'app') continue;
    for (const slots of [N(n.id).leftSlots, N(n.id).rightSlots]) {
      reorderSlots(slots, (f) => f.kind === 'leaf' && f.role === 'pod' && f.namespace);
    }
  }
  /* owner 層同理，而且更嚴重：port 葉的出邊順序是 clients 的出現順序、owner 卡的入邊順序是
     建邊順序，兩者都跟對端的 y 無關——一張 port 掛五個 owner 時歸屬線會整束交叉。
     兩端都依對端 y 重排。沒有 owner 層的圖不進這個迴圈，槽位順序逐 byte 不變。 */
  for (const n of nodes) {
    if (!n.ownerLinked && n.role !== 'owner') continue;
    for (const slots of [N(n.id).leftSlots, N(n.id).rightSlots]) {
      reorderSlots(slots, (f) => n.role === 'owner' || f.role === 'owner');
    }
  }

  /* port 中心點 */
  for (const n of nodes) {
    const g = N(n.id);
    const top = n.kind === 'node' ? g.y + headerH(n) : g.y;
    const avail = n.kind === 'node' ? g.h - headerH(n) - BODY_PAD : g.h;
    place(g.leftSlots, top, avail);
    place(g.rightSlots, top, avail);
    for (const s of g.leftSlots) {
      if (!s.edge) continue;                       /* 殘差槽沒有 edge */
      const eg = E(s.edge);
      if (s.role === 'back-out') { eg.x1 = g.x; eg.y1 = s.cy; eg.t1 = s.t; }
      else { eg.x2 = g.x; eg.y2 = s.cy; eg.t2 = s.t; }
    }
    for (const s of g.rightSlots) {
      if (!s.edge) continue;
      const eg = E(s.edge);
      if (s.role === 'lat-in' || s.role === 'back-in') { eg.x2 = g.x + g.w; eg.y2 = s.cy; eg.t2 = s.t; }
      else { eg.x1 = g.x + g.w; eg.y1 = s.cy; eg.t1 = s.t; }
    }
  }

  /* 橫向弧帶的凸出量：跨距短的在內圈、長的在外圈，弧才不會互相穿過 */
  const latByCol: Record<string, TraceEdge[]> = {};
  for (const e of edges) {
    if (!e.lateral) continue;
    const c = model.nodeMap[e.fromId].col;
    (latByCol[c] = latByCol[c] || []).push(e);
  }
  for (const c of Object.keys(latByCol)) {
    latByCol[c].sort((a, b) => Math.abs(E(a).y2 - E(a).y1) - Math.abs(E(b).y2 - E(b).y1));
    latByCol[c].forEach((e, i) => {
      const eg = E(e);
      eg.bulge = Math.min(56 + (eg.t1 + eg.t2) / 2 * 0.67 + 18 * i, COL_GAP - 26);
    });
  }

  /* 回流帶：繞經圖底下方外圍的等寬迴路。source 欄右側走廊下潛、貼圖底水平走、
     target 欄左側走廊上浮。逐條分 lane 往下疊，垂直段水平錯位，互不重疊。 */
  const backs = edges.filter((e) => e.backward && !near(e));
  backs.sort((a, b) =>
    (model.nodeMap[b.fromId].col - model.nodeMap[a.fromId].col) || (b.bps - a.bps));
  let backY = totalH - PAD_BOTTOM + 40;
  backs.forEach((e, i) => {
    const eg = E(e);
    eg.backT = Math.max(eg.t1, eg.t2);
    eg.backY = backY + eg.backT / 2;
    eg.backXD = eg.x1 + COL_GAP - 30 - i * 14;
    eg.backXU = Math.max(8, eg.x2 - 26 - i * 14);
    backY += eg.backT + 16;
  });
  if (backs.length) totalH = backY - 16 + PAD_BOTTOM;

  return { cols, colX, width: totalW, height: Math.max(totalH, 220), nsColor, nodes: gn, edges: ge };
};
