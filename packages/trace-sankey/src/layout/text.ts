/* 版面與繪製共用的純函式：文字截斷、卡片尺寸、殘差門檻、排序鍵。全部不碰 DOM——render 必須是純函式、Node 也要能跑。 */
import type { NodeUsage, TraceNode, TraceWrapper } from '../model/types.js';
import { fmtAmount, fmtBytes, fmtRate } from '../model/format.js';
import { sum } from '../model/util.js';
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

export const hasUsage = (n: TraceNode | TraceWrapper): boolean =>
  !!(n.usage && n.usage.used_bytes != null && n.usage.capacity_bytes != null);

/* ---------- 卡面的屬性行：一份清單，高度取長度、cards.tsx 迭代它來畫 ----------
   以前這兩件事各寫一次（這裡算行數、cards.tsx 一串 `if (cond) { push; ly += LINE_H }`），
   每一組都碰巧抄對，但那是兩份手抄。之後在卡面多加一行卻忘了改行數，卡的內容會超出算出的
   高度、分隔線與下方卡片的 y 全錯位，而且**沒有型別錯誤也沒有執行期例外**。
   `ns: true` 的那一行要染 namespace 色——顏色留給 cards.tsx 查 nsColor，這裡維持純文字。 */
export interface CardLine { key: string; text: string; ns?: true }

/* hop 盒標題區：型別標＋名字固定 HEADER_H，之後一行一個屬性 */
export const hopLines = (n: TraceNode): CardLine[] => {
  const out: CardLine[] = [];
  if (n.namespace) out.push({ key: 'ns', text: 'ns/' + n.namespace, ns: true });
  if (n.ontapCluster) out.push({ key: 'oc', text: n.ontapCluster });
  if (hasUsage(n)) out.push({ key: 'u', text: '使用 ' + usageText(n.usage) });
  return out;
};
export const headerH = (n: TraceNode): number => HEADER_H + LINE_H * hopLines(n).length;

/* 葉卡／pod 卡（沒有 clients 的版式）：ns?、iface · 量。
   root 一律畫：被選成 root 卻沒有任何可畫的邊的 pod 是 no-flow 卡，量那行印 no flow 而不是 0。 */
export const leafLines = (n: TraceNode): CardLine[] => {
  const out: CardLine[] = [];
  if (n.namespace) out.push({ key: 'ns', text: 'ns/' + n.namespace, ns: true });
  const ifc = n.iface || n.localIface || '';
  out.push({ key: 'amt', text: n.noFlow ? 'no flow' : (ifc ? ifc + ' · ' : '') + fmtAmount(n.bps!, n.unit!) });
  return out;
};

/* 群組終點卡（namespace／application）：application 卡面印所屬 ns
   （參考面板：application · ns/prod · 2 pods）；namespace 卡的 ns 就是自己，不重複印。 */
export const groupLines = (n: TraceNode): CardLine[] => {
  const out: CardLine[] = [];
  if (n.role === 'app' && n.namespace) out.push({ key: 'ns', text: 'ns/' + n.namespace, ns: true });
  out.push({ key: 'pods', text: n.podCount + ' 個 pod' });
  out.push({ key: 'sum', text: '合計 ' + fmtRate(n.bps!, n.unit!) });
  return out;
};

/* owner 終點卡：量與台數**分兩行**——擠成一行會讀成「這個量是這幾個 port 的總和」，
   而名下只要有一個 port 掛著多個 owner，那個 port 的量就沒有算進來。
   bps 為 0 不是「沒有流量」而是「量停在 port」，絕不印 0。 */
export const ownerLines = (n: TraceNode): CardLine[] => [
  { key: 'amt', text: n.bps! > 0
    ? fmtRate(n.bps!, n.unit!) + (n.meteredPorts! < n.portCount! ? '（部分 port）' : '')
    : '量停在 port' },
  { key: 'cnt', text: n.clientCount + ' 台 client · ' + n.portCount + ' 個 port' }
];

/* 卡高（統一版式）：名字行之後有幾行屬性 */
export const cardH = (lines: number): number => CARD_BASE + LINE_H * lines + 13;
/* 有 clients 的葉卡是表格版式，行高 CLIENT_ROW_H（14，不是 LINE_H）：
   name 行（只有真的給了 name 才有）、ns 行、表頭一行、每台一行；量那行算在 cardH(1) 的基底裡。
   這個計數與 LeafCard 的 ly 遞增必須是同一份——tools/test/cards.test.mjs 用「文字必須落在卡框內」
   把兩者綁住（結構怎麼寫都逃不掉）。 */
export const CLIENT_ROW_H = 14;
export const clientExtraRows = (n: TraceNode): number =>
  (n.named ? 1 : 0) + (n.namespace ? 1 : 0) + 1 + n.clients!.length;
export const leafH = (n: TraceNode): number => {
  if (n.role === 'owner') return cardH(ownerLines(n).length);
  if (n.role === 'app' || n.role === 'ns') return cardH(groupLines(n).length);
  const cols = clientCols(n);
  if (!cols.length) return cardH(leafLines(n).length);
  return cardH(1) + CLIENT_ROW_H * clientExtraRows(n);
};

/* 殘差門檻用 model 算好的 resEps：小於 counter 浮點雜訊的殘差不畫，也不佔版面。
   注意這是「相對這台自己流量」的判斷，粗細卻是全圖 maxVal 的比例——
   小 hop 的真殘差可能過得了門檻但只有 THICK_MIN 這麼細，那是對的。 */
export const resIn = (n: TraceNode): number =>
  n.kind === 'node' && n.otherIn! > (n.resEps || 0) ? n.otherIn! : 0;
export const resOut = (n: TraceNode): number =>
  n.kind === 'node' && n.otherOut! > (n.resEps || 0) ? n.otherOut! : 0;

/* 欄內流量排序（order:'flow'）用的「一個節點的流量」＝ max(入邊總和, 出邊總和)。
   - read＋write 一起加總（sum() 不分 channel），跟「守恆看色塊厚度總和」同一個定義。
   - **不含殘差**：殘差是「沒追到的量」，拿它決定誰排上面等於讓沒追到的東西主導版面。
   - 歸屬線（owns）的 bps 恆 0，加進去等於不加——owner 卡的量只來自整張卡獨佔的 port，這是對的。
   - hop 沒有 bps 欄位，但 tracedIn／tracedOut 的定義就是這兩個 sum，所以這個式子對
     hop／葉／pod／ns／app／owner／錨卡一律成立，不必為了排序在 model 上長新欄位。
   注意它是 O(邊數)：**絕不能在 comparator 裡呼叫**（sort 會叫 O(n log n) 次，
   stress/05-huge.json 有 1365 台）——一律先算進 Map。 */
export const flowOf = (n: TraceNode): number => Math.max(sum(n.inEdges), sum(n.outEdges));

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
