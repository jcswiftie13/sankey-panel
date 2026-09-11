/* tooltip 的資料與欄標題：全部只讀 model，不碰版面。
   帶的 data-tip 是套件對外契約的一部分（tooltip 讀它；golden 逐 byte 比）——
   鍵只在有值時出現（undefined 讓 JSON.stringify 丟掉），舊資料的輸出才不會變。 */
import type { TraceEdge, TraceModelOk, TraceNode } from '../model/types.js';
import { fmtBytes, fmtDelta, fmtRate } from '../model/format.js';
import { TYPE_LABEL } from '../model/classify.js';
import { fmtAmount } from '../model/format.js';
import { resIn, resOut, typeWord, usageText } from './text.js';

export interface BandMeta {
  from: string; to: string; fi: string; ti: string; bps: number; anchor: boolean;
  backward?: true; owns?: true; ns?: string; clients?: string[];
  unit?: 'bytesPerSec'; channel?: string; tier?: string; attr?: string; extra?: Record<string, number>;
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
  extra: e.extra || undefined
});

/* 帶的原生 <title>（headless 產 .svg 時唯一的 hover 資訊）。
   iface 在 k8s hop 上可空：只在有值時帶，避免「A → B：+8 Gbps」多出孤懸空格 */
export const bandTitle = (e: TraceEdge, meta: BandMeta): string =>
  meta.from + (e.fromIface ? ' ' + e.fromIface : '') + ' → ' +
  meta.to + (e.toIface ? ' ' + e.toIface : '') + '：' + fmtRate(e.bps, e.unit);

/* 內容順序照參考面板：型別／名稱、ns、ontap_cluster、流量、usage、status、health、model、
   perf（標 raw：原始讀數，不判定好壞）、alerts、no-flow 說明。沒有的鍵不輸出。 */
export const nodeTip = (n: TraceNode, model: TraceModelOk): NodeTip => {
  const rows: [string, string][] = [];
  const title = n.kind === 'anchor' ? '追查起點' : typeWord(n) + ' / ' + n.label;
  if (n.kind === 'anchor') {
    const inv = model.investigation!;
    rows.push(['iface', inv.iface]);
    rows.push([n.dirLabel + ' 方向', fmtDelta(inv.delta_bps)]);
    if (n.note) rows.push(['備註', n.note]);
    return { node: 1, title, rows };
  }
  if (n.role !== 'ns' && n.role !== 'app' && n.role !== 'owner' && n.id !== n.label) rows.push(['id', n.id]);
  if (n.namespace && n.role !== 'ns') rows.push(['namespace', 'ns/' + n.namespace]);
  if (n.ontapCluster) rows.push(['ontap_cluster', n.ontapCluster]);
  const unit = n.unit!;
  if (n.kind === 'node') {
    if (n.noFlow) rows.push(['流量', '沒有任何可畫的 flow 邊（no-flow）']);
    else {
      rows.push(['已追查 in', fmtAmount(n.tracedIn!, unit)]);
      rows.push(['已追查 out', fmtAmount(n.tracedOut!, unit)]);
      if (resIn(n)) rows.push(['其他輸入', fmtAmount(n.otherIn!, unit)]);
      if (resOut(n)) rows.push(['其他輸出', fmtAmount(n.otherOut!, unit)]);
    }
  } else {
    /* owner 卡的量只來自「整張卡只有這一個 owner」的 port。名下的 port 上只要還有別人的
       機器（或查不到 owner 的機器），bps 就是 0——那不是「沒有流量」而是「量停在 port」，
       不能印成 0。 */
    if (n.role === 'owner') {
      rows.push(['已量到的合計', n.bps! > 0 ? fmtRate(n.bps!, unit) : '—（名下的 port 上還有別人的機器，量停在 port）']);
      rows.push(['client', n.clientCount + ' 台']);
      rows.push(['port', n.portCount + ' 個']);
    } else {
      rows.push([n.role === 'ns' || n.role === 'app' ? '合計' : '流量', fmtRate(n.bps!, unit)]);
      if (n.podCount != null) rows.push(['pod', n.podCount + ' 個']);
    }
  }
  if (n.usage) rows.push(['usage', usageText(n.usage)]);
  if (n.status) rows.push(['status', n.status + (n.role === 'ns' || n.role === 'app' ? '（成員 pod 中最差）' : '')]);
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
  const cs = n.clients || [];
  cs.forEach((c, i) => {
    rows.push([cs.length === 1 ? 'client' : 'client ' + (i + 1),
      [c.ip, c.hostname, c.owner].filter(Boolean).join(' · ')]);
  });
  return { node: 1, title, rows };
};

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
