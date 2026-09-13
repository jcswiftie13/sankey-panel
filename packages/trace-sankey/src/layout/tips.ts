/* tooltip 的資料與欄標題：全部只讀 model，不碰版面。
   帶的 data-tip 是套件對外契約的一部分（tooltip 讀它；golden 逐 byte 比）——
   鍵只在有值時出現（undefined 讓 JSON.stringify 丟掉），舊資料的輸出才不會變。 */
import type { Channel, RateUnit, TraceEdge, TraceModelOk, TraceNode, TraceWrapper } from '../model/types.js';
import { fmtBytes, fmtDelta, fmtRate } from '../model/format.js';
import { TYPE_LABEL } from '../model/classify.js';
import { fmtAmount } from '../model/format.js';
import { sum } from '../model/util.js';
import { resIn, resOut, typeWord, usageText } from './text.js';

export interface BandMeta {
  from: string; to: string; fi: string; ti: string; bps: number; anchor: boolean;
  backward?: true; owns?: true; ns?: string; clients?: string[];
  unit?: 'bytesPerSec'; channel?: string; tier?: string; attr?: string; extra?: Record<string, number>;
  /** 推導邊（pod→app→ns、葉→owner）：tooltip 要標「推導值」 */
  derived?: 1;
}
export interface NodeTip { node: 1; title: string; rows: [string, string][] }

/* 帶的 tooltip 要列的 client：取封包下游那一端的節點（追來源模式反過來），
   有 clients 就回 hostname／IP 的字串陣列。完整欄位在卡片自己的 tooltip 裡。 */
export const clientsMeta = (e: TraceEdge, model: TraceModelOk): string[] | null => {
  /* 往 owner 卡的邊剛好相反：owner 卡上沒有 clients，要列的是 port 那一端掛了誰 */
  const toOwner = model.nodeMap[e.toId].role === 'owner' || model.nodeMap[e.fromId].role === 'owner';
  const down = model.dir === 'destination' ? e.toId : e.fromId;
  const up = model.dir === 'destination' ? e.fromId : e.toId;
  const far = model.nodeMap[toOwner ? up : down];
  if (!far || !far.clients) return null;
  return far.clients.map((c) => (c.hostname || c.ip)!);
};

export const bandMeta = (e: TraceEdge, model: TraceModelOk): BandMeta => ({
  from: model.nodeMap[e.fromId].label, to: model.nodeMap[e.toId].label,
  fi: e.fromIface, ti: e.toIface, bps: e.bps, anchor: !!e.isAnchor,
  backward: e.backward || undefined,    /* stringify 會把 undefined 丟掉：沒回流的圖輸出不變 */
  owns: e.owns || undefined,            /* 同上：沒 owner 層的圖輸出不變 */
  ns: e.namespace || undefined,         /* 同上：沒 ns 的圖輸出不變 */
  /* 兩台以上 client 時卡片標題不是 client 身分（合成 id 或使用者給的 name），
     hover 這條帶要知道那頭掛了誰就靠這個鍵。同樣只在有值時出現。 */
  clients: clientsMeta(e, model) || undefined,
  /* storage 資料才有的鍵，同樣只在有值時出現：switch 追查資料的 data-tip 逐 byte 不變 */
  unit: e.unit === 'bytesPerSec' ? e.unit : undefined,
  channel: e.channel || undefined,
  tier: e.tier || undefined,
  attr: e.attribution || undefined,
  extra: e.extra || undefined,
  derived: e.derived ? 1 : undefined     /* 推導邊（pod→app→ns）：tooltip 要標「成員 pod 加總」 */
});

/* 帶的原生 <title>（headless 產 .svg 時唯一的 hover 資訊）。
   iface 在 k8s hop 上可空：只在有值時帶，避免「A → B：+8 Gbps」多出孤懸空格 */
export const bandTitle = (e: TraceEdge, meta: BandMeta): string =>
  meta.from + (e.fromIface ? ' ' + e.fromIface : '') + ' → ' +
  meta.to + (e.toIface ? ' ' + e.toIface : '') + '：' + fmtRate(e.bps, e.unit);

/* 節點身上有哪些通道（照 read、write 順序）：沒有通道的邊（switch 資料、推導邊）不算 */
const chList = (edges: TraceEdge[]): Channel[] => {
  const has = new Set<Channel>();
  for (const e of edges) if (e.channel) has.add(e.channel);
  return (['read', 'write'] as Channel[]).filter((c) => has.has(c));
};
export const channelsOf = (n: TraceNode): Channel[] => chList(n.inEdges.concat(n.outEdges));
/* k8s node 外框的邊＝成員 pod 邊的聯集 */
export const wrapperEdges = (w: TraceWrapper, model: TraceModelOk): { inb: TraceEdge[]; outb: TraceEdge[]; unit: RateUnit } => {
  let inb: TraceEdge[] = [], outb: TraceEdge[] = [];
  for (const id of w.podIds) {
    const p = model.nodeMap[id];
    inb = inb.concat(p.inEdges); outb = outb.concat(p.outEdges);
  }
  return { inb, outb, unit: (inb[0] || outb[0] || {}).unit || 'bps' };
};
export const sumCh = (list: TraceEdge[], ch: Channel): number => sum(list.filter((e) => e.channel === ch));

/* 內容順序照參考面板：型別／名稱、ns、ontap_cluster、流量、usage、status、health、model、
   perf（標 raw：原始讀數，不判定好壞）、alerts、no-flow 說明、id。沒有的鍵不輸出。 */
export const nodeTip = (n: TraceNode | TraceWrapper, model: TraceModelOk): NodeTip => {
  const rows: [string, string][] = [];
  const title = n.kind === 'anchor' ? '追查起點' : typeWord(n) + ' / ' + n.label;
  if (n.kind === 'anchor') {
    const inv = model.investigation!;
    rows.push(['iface', inv.iface]);
    rows.push([n.dirLabel + ' 方向', fmtDelta(inv.delta_bps)]);
    if (n.note) rows.push(['備註', n.note]);
    return { node: 1, title, rows };
  }
  const isW = n.kind === 'wrapper';
  const role = isW ? 'node' : n.role;
  if (!isW && n.namespace && n.role !== 'ns') rows.push(['namespace', 'ns/' + n.namespace]);
  if (!isW && n.ontapCluster) rows.push(['ontap_cluster', n.ontapCluster]);
  /* 流量四行，每一種卡都一樣（參考面板：in read／in write／out read／out write）：
     storage 資料的 read／write 是兩條帶，把兩個方向加成一個數字是沒人量過的值；
     switch 資料沒有通道就 in／out 兩行。in／out 一律是封包方向的入邊／出邊（ns 終點的 out 就是 0）。
     k8s node 外框的邊＝成員 pod 邊的聯集；它的 unit 算在這裡，不寫回 model。 */
  const we = isW ? wrapperEdges(n, model) : null;
  const inb = we ? we.inb : (n as TraceNode).inEdges, outb = we ? we.outb : (n as TraceNode).outEdges;
  const unit: RateUnit = we ? we.unit : (n as TraceNode).unit!;
  const chs = we ? chList(inb.concat(outb)) : channelsOf(n as TraceNode);
  const flowRow = (label: string, list: TraceEdge[]): void => {
    if (!chs.length) { rows.push([label, fmtAmount(sum(list), unit)]); return; }
    for (const ch of chs) rows.push([label + '（' + ch + '）', fmtAmount(sumCh(list, ch), unit)]);
  };
  if (n.noFlow) rows.push(['流量', '沒有任何可畫的 flow 邊（no-flow）']);
  else if (!isW && n.role === 'owner' && !(n.bps! > 0)) {
    /* owner 卡的量只來自「整張卡只有這一個 owner」的 port。名下的 port 上只要還有別人的
       機器（或查不到 owner 的機器），bps 就是 0——那不是「沒有流量」而是「量停在 port」，不能印成 0 */
    rows.push(['in', '—（名下的 port 上還有別人的機器，量停在 port）']);
  } else {
    flowRow('in', inb);
    flowRow('out', outb);
  }
  /* 卡種各自的附加列 */
  if (isW) {
    rows.push(['來源', '成員 pod 加總（推導值）']);
    rows.push(['pod', n.podIds.length + ' 個']);
  } else if (n.kind === 'node') {
    if (resIn(n)) rows.push(['其他輸入', fmtAmount(n.otherIn!, unit)]);
    if (resOut(n)) rows.push(['其他輸出', fmtAmount(n.otherOut!, unit)]);
  } else if (n.role === 'owner') {
    if (n.bps! > 0) rows.push(['來源', 'port 卡的量歸到 owner（推導值）' + (n.meteredPorts! < n.portCount! ? '，部分 port' : '')]);
    rows.push(['client', n.clientCount + ' 台']);
    rows.push(['port', n.portCount + ' 個']);
  } else if (n.role === 'ns' || n.role === 'app') {
    /* app／ns 卡的量是成員 pod 的推導值（同一筆數字重新分組，不是量測），參考面板同樣標「derived from member pods」 */
    rows.push(['來源', '成員 pod 加總（推導值）']);
    if (n.podCount != null) rows.push(['pod', n.podCount + ' 個']);
  }
  if (n.usage) rows.push(['usage', usageText(n.usage)]);
  if (n.status) {
    rows.push(['status', n.status + (role === 'ns' || role === 'app' ? '（成員 pod 中最差）'
      : isW ? '（node 與成員 pod 中最差）' : '')]);
  }
  const info = n.info || {};
  if (info.health) rows.push(['health', info.health]);
  if (info.model) rows.push(['model', info.model]);
  if (info.perf) {
    for (const k of Object.keys(info.perf)) {
      const v = info.perf[k];
      rows.push([k, (k === 'total_bytes_per_sec' ? fmtBytes(v) + '/s' : String(v)) + '（raw）']);
    }
  }
  for (const a of info.alerts || []) rows.push(['alert', a]);
  /* tooltip 不截斷、列出全部：卡面只放得下前兩筆，要看完整清單就是靠這裡 */
  const cs = (isW ? null : n.clients) || [];
  cs.forEach((c, i) => {
    rows.push([cs.length === 1 ? 'client' : 'client ' + (i + 1),
      [c.ip, c.hostname, c.owner].filter(Boolean).join(' · ')]);
  });
  /* id 放最後：參考後端的 id 是路徑式長字串（netapp/ontap-prod/aggr/aggr1），對人沒意義、
     對後端／cytoscape 才有用。名字就是 id 的（沒給 name）不重複印；推導出來的卡沒有 wire id */
  if (role !== 'ns' && role !== 'app' && role !== 'owner' && n.id !== n.label) rows.push(['id', n.id]);
  return { node: 1, title, rows };
};

/* 只有空外框（root k8s node，pod 全被濾掉）的 pod 欄：沒有節點可問，標題自己印 */
export const wrapperColCaption = (ci: number): string => '第 ' + ci + ' 跳 · node / pod';

export const colCaption = (col: TraceNode[], dir: 'destination' | 'source'): string => {
  const kinds = new Set<string>();
  for (const n of col) kinds.add(n.kind);
  /* 錨欄要整欄只有錨卡：no-flow 卡沒有邊、會落在第 0 欄，混進來不能標成「追查起點」 */
  if (kinds.has('anchor') && col.length === 1) return dir === 'destination' ? '追查起點 (in)' : '追查起點 (out)';
  /* 整欄同質才標註，混欄不標——標了反而誤導 */
  if (kinds.has('node')) {
    const role = col[0].role;
    const same = role !== 'switch' && col.every((n) => n.kind === 'node' && n.role === role);
    return '第 ' + col[0].col + ' 跳' + (same ? ' · ' + (TYPE_LABEL[role] || role) : '');
  }
  /* owner 終點欄：client 的負責人是追查的盡頭 */
  if (col.every((n) => n.role === 'owner')) return '追查終止 · owner';
  /* 整欄都接了 owner 卡的 port 葉：它們已經是中繼，比照 pod 欄印「第 N 跳」。
     混欄（真終點的葉混在裡面）維持既有的「追查終止」，標了反而誤導。 */
  if (col.every((n) => n.kind === 'leaf' && n.role === 'leaf' && n.ownerLinked)) {
    return '第 ' + col[0].col + ' 跳 · port';
  }
  /* ns 終點欄：namespace 是追查的盡頭 */
  if (col.every((n) => n.role === 'ns')) return '追查終止 · namespace';
  /* layout:'node'：pod 欄被 k8s node 外框分區，標題比照參考面板的「Node / Pod」 */
  if (col.some((n) => n.k8sNode)) return '第 ' + col[0].col + ' 跳 · node / pod';
  /* pod／application 是中繼了（另一側接 ns），整欄比照「第 N 跳」；含 pod 的混葉欄同理 */
  if (col.every((n) => n.kind === 'leaf' && n.role === 'pod')) {
    return '第 ' + col[0].col + ' 跳 · pod';
  }
  if (col.every((n) => n.kind === 'leaf' && n.role === 'app')) {
    return '第 ' + col[0].col + ' 跳 · application';
  }
  if (col.some((n) => n.kind === 'leaf' && (n.role === 'pod' || n.role === 'app'))) {
    return '第 ' + col[0].col + ' 跳';
  }
  return '追查終止';
};
