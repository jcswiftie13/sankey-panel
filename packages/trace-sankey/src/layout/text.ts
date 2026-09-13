/* 版面與繪製共用的純函式：文字截斷、卡片尺寸、殘差門檻。全部不碰 DOM——render 必須是純函式、Node 也要能跑。 */
import type { NodeUsage, TraceNode, TraceWrapper } from '../model/types.js';
import { fmtBytes } from '../model/format.js';
import { CARD_BASE, CLIENT_COLS, CLIENT_GAP, CLIENT_PAD, HEADER_H, LEAF_W, LINE_H, NODE_W } from './constants.js';
import type { ClientCol } from './constants.js';

export const esc = (s: unknown): string =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);

/* SVG 沒有 text-overflow，長字串會直接戳出卡外：卡面文字自己截。
   以半形 1、CJK（含全形標點）2 估寬——不精確，但 .leaf-sub 是等寬感的 10px 小字，
   估寬夠用且不必量 DOM（render() 必須是純函式、Node 也要能跑）。完整值一律進 tooltip。 */
export const clip = (v: unknown, budget: number): string => {
  const s = String(v == null ? '' : v);
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    w += s.charCodeAt(i) > 0x2e7f ? 2 : 1;
    if (w > budget) return s.slice(0, i) + '…';
  }
  return s;
};

export const clientCols = (n: TraceNode): ClientCol[] => {
  const cs = n.clients;
  if (!cs || !cs.length) return [];
  return CLIENT_COLS.filter((col) => cs.some((c) => c[col.key]));
};
/* 卡寬：欄寬總和＋欄距＋左右 padding，並以 LEAF_W 為下限（只有 ip 一欄時不要變成細長條） */
export const clientW = (n: TraceNode): number => {
  /* owner 是自由字串（部門＋姓名＋分機都可能在裡面），LEAF_W 截得太兇。
     欄寬下限本來就是 NODE_W，加寬到這個值不會把後面的欄推開。 */
  if (n.role === 'owner') return NODE_W;
  const cols = clientCols(n);
  if (!cols.length) return LEAF_W;
  let w = CLIENT_PAD * 2 + CLIENT_GAP * (cols.length - 1);
  for (const col of cols) w += col.w;
  return Math.max(LEAF_W, w);
};
/* 一列一台，每格各自截斷；沒有值的格子留空（不要補「—」，空白本身就讀得出來） */
export const clientRows = (n: TraceNode): string[][] => {
  const cols = clientCols(n);
  if (!cols.length) return [];
  return n.clients!.map((c) => cols.map((col) => (c[col.key] ? clip(c[col.key], col.budget) : '')));
};

/* 卡高（統一版式）：名字行之後有幾行屬性 */
export const cardH = (lines: number): number => CARD_BASE + LINE_H * lines + 13;
/* 帶 namespace 的葉多一行資訊（ns 標示），卡要高一階；沒 ns 的 pod 跟一般葉一樣高。
   有 clients 時多的是：name 那行（只有真的給了 name 才有）、表頭一行、每台一行。 */
export const leafH = (n: TraceNode): number => {
  if (n.role === 'owner') return cardH(2);                 /* 量一行、台數／port 數一行 */
  if (n.role === 'app') return cardH(n.namespace ? 3 : 2); /* ns、pod 數、合計 */
  if (n.role === 'ns') return cardH(2);                    /* pod 數、合計 */
  const cols = clientCols(n);
  if (!cols.length) return cardH(n.namespace ? 2 : 1);     /* ns、iface · 量 */
  return 70 + (n.namespace ? 14 : 0) + (n.named ? 14 : 0) + 14 + n.clients!.length * 14;
};

/* hop 盒的標題區：型別標＋名字固定 HEADER_H，屬性行（ns／ontap_cluster／usage）每行 LINE_H */
export const hasUsage = (n: TraceNode | TraceWrapper): boolean =>
  !!(n.usage && n.usage.used_bytes != null && n.usage.capacity_bytes != null);
export const hopLineCount = (n: TraceNode): number =>
  (n.namespace ? 1 : 0) + (n.ontapCluster ? 1 : 0) + (hasUsage(n) ? 1 : 0);
export const headerH = (n: TraceNode): number => HEADER_H + LINE_H * hopLineCount(n);

/* 殘差門檻用 model 算好的 resEps：小於 counter 浮點雜訊的殘差不畫，也不佔版面。
   注意這是「相對這台自己流量」的判斷，粗細卻是全圖 maxVal 的比例——
   小 hop 的真殘差可能過得了門檻但只有 THICK_MIN 這麼細，那是對的。 */
export const resIn = (n: TraceNode): number =>
  n.kind === 'node' && n.otherIn! > (n.resEps || 0) ? n.otherIn! : 0;
export const resOut = (n: TraceNode): number =>
  n.kind === 'node' && n.otherOut! > (n.resEps || 0) ? n.otherOut! : 0;

export const typeWord = (n: TraceNode | TraceWrapper): string => {
  if (n.kind === 'anchor') return '追查起點';
  if (n.kind === 'wrapper') return 'node';
  if (n.role === 'ns') return 'namespace';
  if (n.role === 'app') return 'application';
  if (n.role === 'owner') return 'owner';
  if (n.kind === 'leaf') return n.type || 'host';
  return n.role;
};
export const usageText = (u: NodeUsage | null | undefined): string => {
  if (!u) return '';
  const used = u.used_bytes, cap = u.capacity_bytes;
  if (used != null && cap != null) {
    return fmtBytes(used) + ' / ' + fmtBytes(cap) + (cap > 0 ? '（' + Math.round(used / cap * 100) + '%）' : '');
  }
  return used != null ? '已用 ' + fmtBytes(used) : '容量 ' + fmtBytes(cap!);
};
