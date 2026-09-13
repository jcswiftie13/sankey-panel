/* 卡片：hop 盒（NodeBox）、終點葉卡（LeafCard）、pod 中繼卡、ns／app 群組卡、owner 卡、錨卡、
   k8s node 外框（WrapperBox）、殘差色塊。
   每張卡的 <g> 都帶 data-n（節點 id）與 data-tip（tooltip 委派讀它）；data-n 是路徑高亮與 onNodeClick
   把 DOM 對回 model 的通道（帶的對應物是 data-e），與 zoom-layer、data-tip 一樣是套件的 public 契約。
   殘差色塊沒有 data-tip、只有原生 <title>。
   每張卡同一套版式：第 1 行型別標（.leaf-stop）、第 2 行名字、之後一行一個屬性（LINE_H）；
   卡面不印 id（參考後端的 id 是路徑式長字串，卡面沒意義；tooltip 最後一列有）。 */
import type { NodeGeom, Slot, WrapperGeom } from '../layout/geometry.js';
import type { TraceModelOk, TraceNode, TraceWrapper } from '../model/types.js';
import { CLIENT_GAP, CLIENT_PAD, DEVICE_TYPES, LINE_H, RES_GAP, RES_LEN, STATUS_COLOR, WRAP_HEADER_H } from '../layout/constants.js';
import { clientCols, clientRows, clip, hasUsage, headerH, usageText } from '../layout/text.js';
import { nodeTip } from '../layout/tips.js';
import { fmtAmount as A, fmtDelta as D, fmtRate as R } from '../model/format.js';
import { locatable } from '../locatable.js';

export interface CardProps {
  n: TraceNode; g: NodeGeom; model: TraceModelOk; nsColor: Record<string, string>;
  /** 有 onNodeClick 時才為 true：可定位的卡加 .clickable（cursor:pointer） */
  clickable: boolean;
}

/* 卡片 <g> 的共用屬性。.clickable 由 React 當 className 輸出，不在 DOM 上事後加：
   headless 不給 clickable，golden 輸出就沒有這個 class。 */
const gAttrs = (n: TraceNode | TraceWrapper, model: TraceModelOk, clickable: boolean) => ({
  'data-n': n.id,
  'data-tip': JSON.stringify(nodeTip(n, model)),
  className: clickable && locatable(n) ? 'clickable' : undefined
});

export const NodeBox = ({ n, g, model, nsColor, clickable }: CardProps) => {
  const isDevice = DEVICE_TYPES.indexOf(n.role) >= 0;   /* k8s node／pod、netapp 三型別：虛線框 */
  const statusColor = n.status ? STATUS_COLOR[n.status] : null;
  const hh = headerH(n);
  /* 屬性逐行：ns（ns 色）、ontap_cluster、usage */
  const lines: React.ReactNode[] = [];
  let ly = g.y + 29 + LINE_H;
  if (n.namespace) {
    lines.push(<text key="ns" className="n-sub" style={{ fill: nsColor[n.namespace] || '#94a3b8' }} x={g.x + 12} y={ly}>{'ns/' + n.namespace}</text>);
    ly += LINE_H;
  }
  if (n.ontapCluster) {
    lines.push(<text key="oc" className="n-sub" x={g.x + 12} y={ly}>{n.ontapCluster}</text>);
    ly += LINE_H;
  }
  if (hasUsage(n)) lines.push(<text key="u" className="n-sub" x={g.x + 12} y={ly}>{'使用 ' + usageText(n.usage)}</text>);
  /* 外框色優先序：status（critical 玫瑰／warning 琥珀／normal 綠）> root 青框 > 設備天藍 > 預設；
     虛線只看設備型別——root 的 k8s node 兩個身分都看得見 */
  return (
    <g {...gAttrs(n, model, clickable)}>
      <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="9" fill="#101c28"
        stroke={statusColor || (n.isRoot ? '#22d3ee' : (isDevice ? '#7dd3fc' : '#2c3e52'))}
        strokeWidth={n.isRoot || statusColor ? 1.8 : 1.2}
        strokeDasharray={isDevice ? '6 4' : undefined} />
      <line x1={g.x} y1={g.y + hh - 6} x2={g.x + g.w} y2={g.y + hh - 6} stroke="#22303f" />
      {/* 型別標印 role 原字（switch／pod／netapp-aggr…） */}
      <text className="leaf-stop" x={g.x + 12} y={g.y + 15}>{n.role}</text>
      <text className="n-title" x={g.x + 12} y={g.y + 29}>{n.label}</text>
      {lines}
      {/* 殘差的標籤畫在盒子外面；k8s port 可沒 iface */}
      {g.leftSlots.map((sl, i) => (sl.res || !sl.iface) ? null : (
        <text key={'l' + i} className="p-label" x={g.x + 10} y={sl.cy + 3.5}>{sl.iface}</text>
      ))}
      {g.rightSlots.map((sl, i) => (sl.res || !sl.iface) ? null : (
        <text key={'r' + i} className="p-label" textAnchor="end" x={g.x + g.w - 10} y={sl.cy + 3.5}>{sl.iface}</text>
      ))}
    </g>
  );
};

export const LeafCard = ({ n, g, model, nsColor, clickable }: CardProps) => {
  const nsc = n.namespace ? (nsColor[n.namespace] || '#94a3b8') : null;
  const statusColor = n.status ? STATUS_COLOR[n.status] : null;
  const cols = clientCols(n);
  const unit = n.unit!;
  const body: React.ReactNode[] = [];
  let ly: number;
  if (cols.length) {
    /* 有 client 的卡：合成 id（sw-tor-1:xe-0/0/12）不當標題——順著帶子回去就知道是哪台
       switch 的哪個 iface，抄在卡上是重複資訊。真的給了 name 才畫標題。
       最後一行也不再重複 iface，只留量。 */
    ly = g.y + 31;
    if (n.named) {
      body.push(<text key="name" className="leaf-main" x={g.x + 12} y={ly}>{n.label}</text>);
      ly += 14;
    }
    if (n.namespace) {
      body.push(<text key="ns" className="leaf-sub" style={{ fill: nsc! }} x={g.x + 12} y={ly}>{'ns/' + n.namespace}</text>);
      ly += 14;
    }
    /* 表頭用 wire 的欄位名（跟 tooltip 印 ontap_cluster／health 同一套慣例），
       樣式沿用 .leaf-stop（灰小字），分隔線沿用 NodeBox 那條內聯 stroke——不新增類別與顏色。 */
    let cx = g.x + CLIENT_PAD;
    const hy = ly;
    for (const col of cols) {
      body.push(<text key={'h-' + col.key} className="leaf-stop" x={cx} y={hy}>{col.key}</text>);
      cx += col.w + CLIENT_GAP;
    }
    body.push(<line key="hl" x1={g.x + CLIENT_PAD} y1={hy + 4} x2={g.x + g.w - CLIENT_PAD} y2={hy + 4} stroke="#22303f" />);
    ly += 14;
    clientRows(n).forEach((cells, r) => {
      let rx = g.x + CLIENT_PAD;
      const ry = ly;
      cells.forEach((v, i) => {
        if (v) body.push(<text key={'c' + r + '-' + i} className="leaf-sub" x={rx} y={ry}>{v}</text>);
        rx += cols[i].w + CLIENT_GAP;
      });
      ly += 14;
    });
    body.push(<text key="amt" className="leaf-sub" x={g.x + 12} y={ly}>{A(n.bps!, unit)}</text>);
  } else {
    body.push(<text key="name" className="leaf-main" x={g.x + 12} y={g.y + 31}>{n.label}</text>);
    ly = g.y + 31 + LINE_H;
    if (n.namespace) {
      body.push(<text key="ns" className="leaf-sub" style={{ fill: nsc! }} x={g.x + 12} y={ly}>{'ns/' + n.namespace}</text>);
      ly += LINE_H;
    }
    const ifc = n.iface || n.localIface || '';
    body.push(<text key="amt" className="leaf-sub" x={g.x + 12} y={ly}>{(ifc ? ifc + ' · ' : '') + A(n.bps!, unit)}</text>);
  }
  /* 右上角：終點／port／client 的語意（型別標在左上角後，這裡才是「這張卡在追查裡是什麼角色」）。
     接了 owner 卡的 port 已經不是終點了（比照 pod 卡） */
  const nc = n.clients ? n.clients.length : 0;
  return (
    <g {...gAttrs(n, model, clickable)}>
      <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="8" fill="#0e151d"
        stroke={statusColor || '#94a3b8'} strokeOpacity={statusColor ? '1' : '.65'}
        strokeWidth={statusColor ? '1.8' : '1.1'} strokeDasharray="5 4" />
      {/* 左緣 ns 色條：帶 ns 的非 pod 葉也照畫（與色盤取用條件一致）。上下內縮避開圓角，避免色條戳出弧線外。 */}
      {nsc && <rect x={g.x + 1.5} y={g.y + 5} width="4" height={g.h - 10} rx="2" fill={nsc} fillOpacity=".85" />}
      {/* 統一版式：第 1 行是型別（輸入的 type 原字：host／router…） */}
      <text className="leaf-stop" x={g.x + 12} y={g.y + 17}>{n.type || 'host'}</text>
      {body}
      <text className="leaf-stop" textAnchor="end" x={g.x + g.w - 12} y={g.y + 17}>
        {n.ownerLinked ? 'port' : nc === 0 ? '未再往下追' : (nc === 1 ? 'client' : nc + ' 個 client')}
      </text>
    </g>
  );
};

/* pod 中繼卡：外觀沿用天藍虛線＋ns 色條的 pod 家族，但 pod 已不是終點——
   另一側有邊接 app／ns 終點，「追查終止／未再往下追」字樣不再出現。
   沒有 ns 的 pod（合法）就沒有色條與 ns 行，iface 行上移。 */
export const PodCard = ({ n, g, model, nsColor, clickable }: CardProps) => {
  const nsc = n.namespace ? (nsColor[n.namespace] || '#94a3b8') : null;
  const statusColor = n.status ? STATUS_COLOR[n.status] : null;
  const ly = g.y + 31 + LINE_H + (nsc ? LINE_H : 0);
  const ifc = n.iface || n.localIface || '';
  return (
    <g {...gAttrs(n, model, clickable)}>
      <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="8" fill="#0e151d"
        stroke={statusColor || '#7dd3fc'} strokeOpacity={statusColor ? '1' : '.55'}
        strokeWidth={statusColor ? '1.8' : '1.1'} strokeDasharray="5 4" />
      {/* 左緣 ns 色條：同 ns 的 pod 相鄰排列時色條連成一段，彙總一眼可讀 */}
      {nsc && <rect x={g.x + 1.5} y={g.y + 5} width="4" height={g.h - 10} rx="2" fill={nsc} fillOpacity=".85" />}
      <text className="leaf-stop" x={g.x + 12} y={g.y + 17}>pod</text>
      <text className="leaf-main" x={g.x + 12} y={g.y + 31}>{n.label}</text>
      {nsc && <text className="leaf-sub" style={{ fill: nsc }} x={g.x + 12} y={g.y + 31 + LINE_H}>{'ns/' + n.namespace}</text>}
      {/* root 一律畫：被選成 root 卻沒有任何可畫的邊的 pod 是 no-flow 卡，量那行印 no flow 而不是 0 */}
      <text className="leaf-sub" x={g.x + 12} y={ly}>{n.noFlow ? 'no flow' : (ifc ? ifc + ' · ' : '') + A(n.bps!, n.unit!)}</text>
    </g>
  );
};

/* k8s node 外框（layout:'node'）：包住這台 node 上的 pod 卡。外框本體不收事件（pod 卡與帶在它上面），
   只有標題列那一塊是 hover／點擊目標。實線天藍（k8s node 既有語彙）、有 status 就換 status 色。 */
export const WrapperBox = ({ g, model, clickable }: { g: WrapperGeom; model: TraceModelOk; clickable: boolean }) => {
  const w = g.wrapper;
  const statusColor = w.status ? STATUS_COLOR[w.status] : null;
  return (
    <>
      <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="12" fill="#0e151d" fillOpacity=".35"
        stroke={statusColor || '#7dd3fc'} strokeOpacity={statusColor ? '1' : '.55'}
        strokeWidth={statusColor ? '1.8' : '1.2'} pointerEvents="none" />
      <g {...gAttrs(w, model, clickable)}>
        <rect x={g.x} y={g.y} width={g.w} height={WRAP_HEADER_H} fill="transparent" />
        <line x1={g.x} y1={g.y + WRAP_HEADER_H - 6} x2={g.x + g.w} y2={g.y + WRAP_HEADER_H - 6} stroke="#22303f" />
        <text className="leaf-stop" x={g.x + 12} y={g.y + 15}>node</text>
        <text className="n-title" x={g.x + 12} y={g.y + 29}>{w.label}</text>
        <text className="n-sub" x={g.x + 12} y={g.y + 29 + LINE_H}>{w.noFlow ? 'no flow' : w.podIds.length + ' 個 pod'}</text>
      </g>
    </>
  );
};

/* 群組終點卡（namespace／application）：邏輯彙總、不是設備——用 ns 色實線描邊，
   虛線留給「設備／截斷」的既有語彙。bps 是所有成員邊的加總（model 算好）；
   status 是成員 pod 的最差值，有就換成 status 色描邊。 */
export const GroupCard = ({ n, g, model, nsColor, clickable, word }: CardProps & { word: 'namespace' | 'application' }) => {
  const nsc = nsColor[n.namespace!] || '#94a3b8';
  const statusColor = n.status ? STATUS_COLOR[n.status] : null;
  const lines: React.ReactNode[] = [];
  let ly = g.y + 31 + LINE_H;
  /* application 卡面印所屬 ns（參考面板：application · ns/prod · 2 pods）；namespace 卡的 ns 就是自己 */
  if (word === 'application' && n.namespace) {
    lines.push(<text key="ns" className="leaf-sub" style={{ fill: nsc }} x={g.x + 12} y={ly}>{'ns/' + n.namespace}</text>);
    ly += LINE_H;
  }
  lines.push(<text key="pods" className="leaf-sub" x={g.x + 12} y={ly}>{n.podCount + ' 個 pod'}</text>);
  ly += LINE_H;
  lines.push(<text key="sum" className="leaf-sub" x={g.x + 12} y={ly}>{'合計 ' + R(n.bps!, n.unit!)}</text>);
  return (
    <g {...gAttrs(n, model, clickable)}>
      <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="8" fill={nsc} fillOpacity=".10"
        stroke={statusColor || nsc} strokeWidth={statusColor ? '1.8' : '1.4'} />
      <text className="leaf-stop" style={{ fill: nsc }} x={g.x + 12} y={g.y + 17}>{word}</text>
      <text className="leaf-main" x={g.x + 12} y={g.y + 31}>{n.label}</text>
      {lines}
    </g>
  );
};

/* owner 終點卡：client 的負責人。跟 ns／app 一樣是邏輯彙總（實線描邊，虛線留給設備／截斷），
   但 owner 不是 namespace、沒有 ns 色，用葉卡那支灰——不新增顏色定義。
   bps 只來自「整張卡只有這一個 owner」的 port；名下的 port 上還有別人的機器時 bps 是 0，
   那不是「沒有流量」而是「量停在 port」，所以第三行改印台數，不能印一個 0 出來。 */
export const OwnerCard = ({ n, g, model, clickable }: CardProps) => (
  <g {...gAttrs(n, model, clickable)}>
    <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="8" fill="#94a3b8" fillOpacity=".10" stroke="#94a3b8" strokeWidth="1.4" />
    <text className="leaf-stop" x={g.x + 12} y={g.y + 17}>owner</text>
    <text className="leaf-main" x={g.x + 12} y={g.y + 31}>{clip(n.label, 34)}</text>
    {/* 量與台數分兩行：擠成一行會讀成「這個量是這幾個 port 的總和」，
        而名下只要有一個 port 掛著多個 owner，那個 port 的量就沒有算進來。 */}
    <text className="leaf-sub" x={g.x + 12} y={g.y + 31 + LINE_H}>
      {n.bps! > 0 ? R(n.bps!, n.unit!) + (n.meteredPorts! < n.portCount! ? '（部分 port）' : '') : '量停在 port'}
    </text>
    <text className="leaf-sub" x={g.x + 12} y={g.y + 31 + LINE_H * 2}>{n.clientCount + ' 台 client · ' + n.portCount + ' 個 port'}</text>
  </g>
);

export const AnchorCard = ({ n, g, model, clickable }: CardProps) => {
  const inv = model.investigation!;
  return (
    <g {...gAttrs(n, model, clickable)}>
      <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="8" fill="#0d1a22" stroke="#22d3ee" strokeWidth="1.4" strokeDasharray="4 3" />
      <text className="leaf-stop" style={{ fill: '#22d3ee' }} x={g.x + 12} y={g.y + 17}>追查起點</text>
      <text className="leaf-main" x={g.x + 12} y={g.y + 31}>{inv.iface}</text>
      <text className="leaf-sub" x={g.x + 12} y={g.y + 31 + LINE_H}>{n.dirLabel + ' 方向 · ' + D(inv.delta_bps)}</text>
    </g>
  );
};

/* 依 kind／role 分派到對應的卡片 */
export const Card = (p: CardProps) => {
  const { n } = p;
  if (n.kind === 'node') return <NodeBox {...p} />;
  if (n.kind === 'leaf') {
    if (n.role === 'pod') return <PodCard {...p} />;
    if (n.role === 'ns') return <GroupCard {...p} word="namespace" />;
    if (n.role === 'app') return <GroupCard {...p} word="application" />;
    if (n.role === 'owner') return <OwnerCard {...p} />;
    return <LeafCard {...p} />;
  }
  return <AnchorCard {...p} />;
};

/* 殘差：貼盒子外側、與帶寬等比的虛線色塊，不進走廊。
   直接走槽位，畫出來的東西跟 layout() 保留的空間就不可能不一致。
   原生 <title> 兩種模式都留：殘差沒有 data-tip，這是它唯一的 hover 資訊。 */
export const Residual = ({ n, g, sl }: { n: TraceNode; g: NodeGeom; sl: Slot }) => {
  const isIn = sl.res === 'in';
  const color = isIn ? '#f59e0b' : '#fb7185';
  const h = sl.t;                                  /* 已含 THICK_MIN 下限 */
  const x = isIn ? g.x - RES_LEN : g.x + g.w;
  const txtX = isIn ? x - RES_GAP : x + RES_LEN + RES_GAP;
  const anchor = isIn ? 'end' : 'start';
  const word = isIn ? '其他輸入' : '其他輸出';
  const unit = n.unit!;
  const amount = (isIn && unit !== 'bytesPerSec' ? '+' : '') + A(sl.bps!, unit);
  /* 標籤用描邊光暈，不用不透明底板——底板會在青帶上打出一個黑洞（殘差最後才畫） */
  const halo = { fill: color, paintOrder: 'stroke', stroke: '#0b1017', strokeWidth: '3.5px' } as const;
  return (
    <g>
      <title>{n.label + '：' + word + ' ' + A(sl.bps!, unit) +
        '（已追查 in ' + A(n.tracedIn!, unit) + ' / out ' + A(n.tracedOut!, unit) + '）'}</title>
      <rect x={x} y={sl.cy - h / 2} width={RES_LEN} height={h} fill={color} fillOpacity=".16"
        stroke={color} strokeWidth="1.4" strokeDasharray="4 3" />
      <text className="res-label" textAnchor={anchor} x={txtX} y={sl.cy - 1} style={halo}>{word}</text>
      <text className="res-label" textAnchor={anchor} x={txtX} y={sl.cy + 11} style={halo}>{amount}</text>
    </g>
  );
};
