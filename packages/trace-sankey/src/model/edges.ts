/* 步驟 2：依邊的首次出現順序建邊，一律照封包方向（左 -> 右）。
   葉、ns／app 終點卡、owner 卡都在這裡 lazy 建：第一條存活邊才建，門檻濾掉就不會留孤兒卡。 */
import type { AggEdge, BuildCtx, Channel, RateUnit, TraceEdge, TraceNode } from './types.js';
import { clientsOf, infoOf, statusOf, usageOf } from './classify.js';
import { SEP, str } from './util.js';

/* 邊的物件字面值：鍵序就是 model.json 的鍵序，別重排。id 到步驟 4 才編。 */
export const mkEdge = (a: TraceNode, b: TraceNode, fromIface: string, toIface: string,
  p: { bps: number; unit?: RateUnit; channel?: Channel | null; tier?: string | null; attribution?: string | null; extra?: Record<string, number> | null }): TraceEdge =>
  ({
    fromId: a.id, toId: b.id, fromIface: fromIface || '', toIface: toIface || '',
    bps: p.bps, unit: p.unit || 'bps', channel: p.channel || null,
    tier: p.tier || null, attribution: p.attribution || null, extra: p.extra || null,
    namespace: null
  } as TraceEdge);

export const buildEdges = (ctx: BuildCtx): void => {
  const { dir, nodes, order, edges, raw, minBps, channels, dropIn, dropOut } = ctx;
  /* namespace 終點節點：每個 pod 葉自動再接一條邊到所屬 ns（有 application 祖先就先接 app 卡，
     再由 app 匯進 ns），全圖同 ns／同 app 合一個節點，「這個 ns 總共多少流量」直接在圖上讀。
     pod→app→ns 的值就是 pod 自己的量測值——同一筆數字的重新分組，不是推估攤分。
     只有葉 pod 會接：proxy pod（有往下走的邊）的流量已流向下游，再接 ns 會重複計量。
     dedup 表鍵加前綴避開 __proto__；節點 id 用流水號——ns／app 名是自由字串。 */
  const nsBag = new Map<string, TraceNode>(); let nsSeq = 0;
  const appBag = new Map<string, TraceNode>(); let appSeq = 0;
  const podLinks = new Map<string, TraceEdge[]>();
  const ownerBag = new Map<string, TraceNode>(); let ownerSeq = 0;
  const ownerLinks = new Map<string, TraceEdge[]>();

  const nsFor = (name: string): TraceNode => {
    let ns = nsBag.get(name);
    if (!ns) {
      ns = {
        id: 'ns-' + (++nsSeq), kind: 'leaf', role: 'ns',
        label: name, namespace: name, inEdges: [], outEdges: [], col: 0
      };
      nsBag.set(name, ns);
      nodes[ns.id] = ns; order.push(ns.id);
    }
    return ns;
  };
  /* 同名 application 可能出現在兩個 ns，鍵要帶 ns */
  const appFor = (name: string, ns: string | null): TraceNode => {
    const k = (ns || '') + SEP + name;
    let app = appBag.get(k);
    if (!app) {
      app = {
        id: 'app-' + (++appSeq), kind: 'leaf', role: 'app',
        label: name, namespace: ns || null, inEdges: [], outEdges: [], col: 0
      };
      appBag.set(k, app);
      nodes[app.id] = app; order.push(app.id);
    }
    return app;
  };
  const derived = (a: TraceNode, b: TraceNode, unit: RateUnit, ns: string | null): TraceEdge => {
    const e = mkEdge(a, b, '', '', { bps: 0, unit, channel: null });
    e.namespace = ns || null;
    e.derived = true;
    return e;
  };
  /* 第一次遇到這個 pod 就把 pod→app→ns（或 pod→ns）整段建好、緊接在 hop→pod 邊之後
     （邊序＝z-order）；之後同 pod 的每條入邊只累加。app→ns 邊全 app 共用一條。 */
  const linkPod = (pod: TraceNode, bps: number, unit: RateUnit): void => {
    let L = podLinks.get(pod.id);
    if (!L) {
      L = []; podLinks.set(pod.id, L);
      const appD = raw.appOf(pod.id), nsName = pod.namespace ?? null;
      if (appD) {
        const app = appFor(str(appD.name) ? appD.name : appD.id, nsName);
        const e1 = dir === 'destination' ? derived(pod, app, unit, nsName) : derived(app, pod, unit, nsName);
        edges.push(e1); L.push(e1);
        if (nsName) {
          const ns = nsFor(nsName);
          if (!app.nsEdge) {
            app.nsEdge = dir === 'destination' ? derived(app, ns, unit, nsName) : derived(ns, app, unit, nsName);
            edges.push(app.nsEdge);
          }
          L.push(app.nsEdge);
        }
      } else if (nsName) {
        const ns2 = nsFor(nsName);
        const e2 = dir === 'destination' ? derived(pod, ns2, unit, nsName) : derived(ns2, pod, unit, nsName);
        edges.push(e2); L.push(e2);
      }
    }
    for (const e of L) e.bps += bps;
  };
  /* owner 聚合：無鄰居 port 的 client 查得到負責人時，葉卡右邊再長一欄 owner 卡，
     同名 owner 全圖合一，「這個人名下總共多少流量」直接在圖上讀。
     量只有在整張卡歸屬同一個 owner 時才帶得過去——那是同一筆數字的重新分組，比照 pod→app→ns。
     port 上還有別人（或查不到 owner）的機器時量就停在 port：後端量得到的是整個 port 的
     Δ bps、量不到 per-client，拆開就是攤分推估（正是 5499b24 移除「可歸因」欄的理由）。
     所以那種 port 照樣分帶連到每個具名 owner，但那些帶不帶量，畫成灰虛線的「歸屬線」。
     **查不到 owner 的 client 不開卡也不連線**：「查不到」不是一個人，做成一張卡只會是
     全圖最大的一張、佔著 owner 欄最顯眼的位置卻什麼都沒說。但它**仍然算一組**（見 linkOwner）。 */
  const ownerFor = (name: string): TraceNode => {
    let o = ownerBag.get(name);
    if (!o) {
      o = {
        id: 'owner-' + (++ownerSeq), kind: 'leaf', role: 'owner',
        label: name, owner: name,
        namespace: null, clientCount: 0, portCount: 0, meteredPorts: 0,
        inEdges: [], outEdges: [], col: 0
      };
      ownerBag.set(name, o);
      nodes[o.id] = o; order.push(o.id);
    }
    return o;
  };
  /* 依 clients 首次出現順序分組，沒有 owner 的全歸同一組（owner 為 null）。
     那一組不建卡也不連線，但要回傳——linkOwner 得知道「這張卡上還有不知道是誰的機器」。 */
  const ownerGroups = (clients: { owner: string | null }[]): { owner: string | null; count: number }[] => {
    const seen = new Map<string, { owner: string | null; count: number }>();
    let unk: { owner: string | null; count: number } | null = null;
    const out: { owner: string | null; count: number }[] = [];
    for (const c of clients) {
      let g: { owner: string | null; count: number };
      if (c.owner == null) g = unk || (unk = { owner: null, count: 0 });
      else {
        g = seen.get(c.owner) || { owner: c.owner, count: 0 };
        seen.set(c.owner, g);
      }
      if (!g.count) out.push(g);
      g.count++;
    }
    return out;
  };
  /* 歸屬線：只表達「這個 port 掛的機器屬於誰」，bps 恆 0，render 畫成灰虛線、不印數字 */
  const ownEdge = (a: TraceNode, b: TraceNode, unit: RateUnit, metered: boolean): TraceEdge => {
    const e = derived(a, b, unit, null);
    if (!metered) e.owns = true;
    return e;
  };
  /* 比照 linkPod：第一次遇到這張 client 葉就把往 owner 的邊整組建好、緊接在 hop→葉 邊之後
     （邊序＝z-order）；之後同一張葉的每條入邊只累加實量帶。 */
  const linkOwner = (leaf: TraceNode, bps: number, unit: RateUnit): void => {
    let L = ownerLinks.get(leaf.id);
    if (!L) {
      const gs = ownerGroups(leaf.clients!);
      const named = gs.filter((g) => g.owner != null);
      /* 一個 owner 都查不到：整張卡不接 owner 層，維持原本的終點葉卡 */
      if (!named.length) return;
      /* metered 看的是「全部」組數、含查不到 owner 的那一組：卡上還有不知道是誰的機器時，
         那張卡的量就不是這個 owner 一個人的，整額帶過去就是把別人的量記到他頭上。 */
      const metered = gs.length === 1;
      L = []; ownerLinks.set(leaf.id, L);
      for (const g of named) {
        const o = ownerFor(g.owner!);
        o.clientCount! += g.count;
        o.portCount!++;
        if (metered) o.meteredPorts!++;
        const e = dir === 'destination' ? ownEdge(leaf, o, unit, metered) : ownEdge(o, leaf, unit, metered);
        edges.push(e);
        if (metered) L.push(e);
      }
      leaf.ownerLinked = true;
    }
    for (const e of L) e.bps += bps;
  };
  const ensureLeaf = (id: string, a: AggEdge, side: 'from' | 'to'): TraceNode => {
    let n = nodes[id];
    const own = side === 'from' ? a.sif : a.tif, local = side === 'from' ? a.tif : a.sif;
    if (n) {
      if (n.kind === 'leaf') {
        /* 多條邊接同一張葉卡：iface 不一致就留空，不猜 */
        if (n.iface !== own) n.iface = '';
        if (n.localIface !== local) n.localIface = '';
      }
      return n;
    }
    const d = raw.get(id)!;
    const cl = clientsOf(d);
    n = {
      id, kind: 'leaf', role: d.type === 'pod' ? 'pod' : 'leaf', type: d.type,
      /* 無鄰居 port 的 id 常是「switch:iface」這種合成字串，沒有 name。
         剛好只掛一台 client 時用它的 hostname（沒有 hostname 就用 IP）當 label：
         量測帶的 tooltip 讀的就是 label（render 的 model.nodeMap[e.toId].label），
         寫成 IP 才看得出那頭是誰；合成 id 仍在節點 tooltip 裡。
         clientsOf() 保證每筆至少有 ip 或 hostname，所以這個表達式不會是 null。 */
      label: str(d.name) ? d.name : (cl && cl.length === 1 ? (cl[0].hostname || cl[0].ip)! : id),
      /* 卡面標題只在輸入真的給了 name 時才畫。不能用 label !== id 判斷——
         單一 client 時 label 是那台機器的 hostname，那不是使用者給這個 port 取的名字。 */
      named: str(d.name),
      iface: own, localIface: local, peerKind: d.type,
      namespace: d.type === 'pod' ? raw.nsOfPod(id) : (d.labels && str(d.labels.namespace) ? d.labels.namespace : null),
      ontapCluster: d.labels && str(d.labels.ontap_cluster) ? d.labels.ontap_cluster : null,
      status: statusOf(d.status), usage: usageOf(d.usage), info: infoOf(d), clients: cl,
      inEdges: [], outEdges: [], col: 0
    };
    nodes[id] = n; order.push(id);
    return n;
  };
  const isHop = (id: string): boolean => !!nodes[id] && nodes[id].kind === 'node';

  for (const key of ctx.aggOrder) {
    const a = ctx.agg[key];
    /* 沒過門檻／不在要看的通道：不建邊也不建 leaf——先濾再建，才不會留下沒有邊的孤兒葉卡片。
       pod 葉的 ns 邊也一併不生（它接在建葉之後）。量記到 hop 端頭上，等步驟 6 併進殘差。 */
    const hideCh = channels !== 'both' && a.channel && a.channel !== channels;
    if (hideCh || (minBps > 0 && !(a.bps > minBps))) {
      if (hideCh) ctx.hiddenChannel++;
      else { ctx.filteredCount++; ctx.filteredBps += a.bps; }
      if (isHop(a.src)) dropOut[a.src] = (dropOut[a.src] || 0) + a.bps;
      if (isHop(a.tgt)) dropIn[a.tgt] = (dropIn[a.tgt] || 0) + a.bps;
      continue;
    }
    const from = ensureLeaf(a.src, a, 'from');
    const to = ensureLeaf(a.tgt, a, 'to');
    const e = mkEdge(from, to, a.sif, a.tif, a);
    const leafEnd = to.kind === 'leaf' ? to : (from.kind === 'leaf' ? from : null);
    e.namespace = leafEnd ? (leafEnd.namespace ?? null) : null;
    edges.push(e);
    /* pod 葉再接一條到 app／ns 終點。追來源模式方向反接（ns → pod），畫布仍照封包方向、ns 落在最左。
       帶 clients 的葉同理再接到 owner 卡；pod 葉走 linkPod，owner 卡自己不是從這裡建的。 */
    const downLeaf = dir === 'destination' ? to : from;
    if (downLeaf.kind === 'leaf' && downLeaf.role === 'pod') linkPod(downLeaf, a.bps, a.unit);
    if (downLeaf.kind === 'leaf' && downLeaf.role === 'leaf' && downLeaf.clients) {
      linkOwner(downLeaf, a.bps, a.unit);
    }
  }
  if (ctx.hiddenChannel) {
    ctx.warnings.push('只顯示 ' + channels + ' 通道：' + ctx.hiddenChannel + ' 條 ' + (channels === 'read' ? 'write' : 'read') +
      ' 帶不畫，量已併進其他輸入／其他輸出。');
  }
};
