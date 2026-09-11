/* 卡片：hop 盒（NodeBox）、終點葉卡（LeafCard）、pod 中繼卡、ns／app 群組卡、owner 卡、錨卡、殘差色塊。
   每張卡的 <g> 都帶 data-tip（tooltip 委派讀它）；殘差色塊沒有 data-tip、只有原生 <title>。 */
import type { NodeGeom, Slot } from '../layout/geometry.js';
import type { TraceModelOk, TraceNode } from '../model/types.js';
import { CLIENT_GAP, CLIENT_PAD, DEVICE_TYPES, RES_GAP, RES_LEN, STATUS_COLOR } from '../layout/constants.js';
import { clientCols, clientRows, clip, hasUsage, headerH, usageText } from '../layout/text.js';
import { nodeTip } from '../layout/tips.js';
import { fmtAmount as A, fmtDelta as D, fmtRate as R } from '../model/format.js';

export interface CardProps { n: TraceNode; g: NodeGeom; model: TraceModelOk; nsColor: Record<string, string> }

const tipAttr = (n: TraceNode, model: TraceModelOk): string => JSON.stringify(nodeTip(n, model));

export const NodeBox = ({ n, g, model, nsColor }: CardProps) => {
  const isDevice = DEVICE_TYPES.indexOf(n.role) >= 0;   /* k8s node／pod、netapp 三型別：虛線框 */
  const statusColor = n.status ? STATUS_COLOR[n.status] : null;
  const hh = headerH(n);
  /* 外框色優先序：status（critical 玫瑰／warning 琥珀）> root 青框 > 設備天藍 > 預設；
     虛線只看設備型別——root 的 k8s node 兩個身分都看得見 */
  return (
    <g data-tip={tipAttr(n, model)}>
      <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="9" fill="#101c28"
        stroke={statusColor || (n.isRoot ? '#22d3ee' : (isDevice ? '#7dd3fc' : '#2c3e52'))}
        strokeWidth={n.isRoot || statusColor ? 1.8 : 1.2}
        strokeDasharray={isDevice ? '6 4' : undefined} />
      <line x1={g.x} y1={g.y + hh - 6} x2={g.x + g.w} y2={g.y + hh - 6} stroke="#22303f" />
      <text className="n-title" x={g.x + 12} y={g.y + 17}>{n.label}</text>
      <text className="n-sub" x={g.x + 12} y={g.y + 29}>
        {n.id}
        {n.namespace ? <>{' · '}<tspan style={{ fill: nsColor[n.namespace] || '#94a3b8' }}>{'ns/' + n.namespace}</tspan></> : null}
        {n.role !== 'switch' ? ' · ' + n.role : null}
        {n.ontapCluster ? ' · ' + n.ontapCluster : null}
      </text>
      {hasUsage(n) && <text className="n-sub" x={g.x + 12} y={g.y + 41}>{'使用 ' + usageText(n.usage)}</text>}
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

export const LeafCard = ({ n, g, model, nsColor }: CardProps) => {
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
    ly = g.y + 34;
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
    body.push(<text key="name" className="leaf-main" x={g.x + 12} y={g.y + 34}>{n.label}</text>);
    ly = g.y + 48;
    if (n.namespace) {
      body.push(<text key="ns" className="leaf-sub" style={{ fill: nsc! }} x={g.x + 12} y={ly}>{'ns/' + n.namespace}</text>);
      ly += 14;
    }
    const ifc = n.iface || n.localIface || '';
    body.push(<text key="amt" className="leaf-sub" x={g.x + 12} y={ly}>{(ifc ? ifc + ' · ' : '') + A(n.bps!, unit)}</text>);
  }
  /* 查得到 client 就不是「不明終點」了：右上角換成 client 標記 */
  const nc = n.clients ? n.clients.length : 0;
  return (
    <g data-tip={tipAttr(n, model)}>
      <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="8" fill="#0e151d"
        stroke={statusColor || '#94a3b8'} strokeOpacity={statusColor ? '1' : '.65'}
        strokeWidth={statusColor ? '1.8' : '1.1'} strokeDasharray="5 4" />
      {/* 左緣 ns 色條：帶 ns 的非 pod 葉也照畫（與色盤取用條件一致）。上下內縮避開圓角，避免色條戳出弧線外。 */}
      {nsc && <rect x={g.x + 1.5} y={g.y + 5} width="4" height={g.h - 10} rx="2" fill={nsc} fillOpacity=".85" />}
      {/* 接了 owner 卡的 port 已經不是終點了（比照 pod 卡從「追查終止」變成 pod） */}
      <text className="leaf-stop" x={g.x + 12} y={g.y + 17}>{n.ownerLinked ? 'port' : '追查終止'}</text>
      {body}
      <text className="leaf-stop" textAnchor="end" x={g.x + g.w - 12} y={g.y + 17}>
        {nc === 0 ? '未再往下追' : (nc === 1 ? 'client' : nc + ' 個 client')}
      </text>
    </g>
  );
};

/* pod 中繼卡：外觀沿用天藍虛線＋ns 色條的 pod 家族，但 pod 已不是終點——
   另一側有邊接 app／ns 終點，「追查終止／未再往下追」字樣不再出現。
   沒有 ns 的 pod（合法）就沒有色條與 ns 行，iface 行上移。 */
export const PodCard = ({ n, g, model, nsColor }: CardProps) => {
  const nsc = n.namespace ? (nsColor[n.namespace] || '#94a3b8') : null;
  const statusColor = n.status ? STATUS_COLOR[n.status] : null;
  const ly = g.y + 48 + (nsc ? 14 : 0);
  const ifc = n.iface || n.localIface || '';
  return (
    <g data-tip={tipAttr(n, model)}>
      <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="8" fill="#0e151d"
        stroke={statusColor || '#7dd3fc'} strokeOpacity={statusColor ? '1' : '.55'}
        strokeWidth={statusColor ? '1.8' : '1.1'} strokeDasharray="5 4" />
      {/* 左緣 ns 色條：同 ns 的 pod 相鄰排列時色條連成一段，彙總一眼可讀 */}
      {nsc && <rect x={g.x + 1.5} y={g.y + 5} width="4" height={g.h - 10} rx="2" fill={nsc} fillOpacity=".85" />}
      <text className="leaf-stop" x={g.x + 12} y={g.y + 17}>pod</text>
      <text className="leaf-main" x={g.x + 12} y={g.y + 34}>{n.label}</text>
      {nsc && <text className="leaf-sub" style={{ fill: nsc }} x={g.x + 12} y={g.y + 48}>{'ns/' + n.namespace}</text>}
      <text className="leaf-sub" x={g.x + 12} y={ly}>{(ifc ? ifc + ' · ' : '') + A(n.bps!, n.unit!)}</text>
    </g>
  );
};

/* 群組終點卡（namespace／application）：邏輯彙總、不是設備——用 ns 色實線描邊，
   虛線留給「設備／截斷」的既有語彙。bps 是所有成員邊的加總（model 算好）；
   status 是成員 pod 的最差值，有就換成 status 色描邊。 */
export const GroupCard = ({ n, g, model, nsColor, word }: CardProps & { word: 'namespace' | 'application' }) => {
  const nsc = nsColor[n.namespace!] || '#94a3b8';
  const statusColor = n.status ? STATUS_COLOR[n.status] : null;
  return (
    <g data-tip={tipAttr(n, model)}>
      <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="8" fill={nsc} fillOpacity=".10"
        stroke={statusColor || nsc} strokeWidth={statusColor ? '1.8' : '1.4'} />
      <text className="leaf-stop" style={{ fill: nsc }} x={g.x + 12} y={g.y + 17}>{word}</text>
      <text className="leaf-main" x={g.x + 12} y={g.y + 34}>{n.label}</text>
      <text className="leaf-sub" x={g.x + 12} y={g.y + 48}>{R(n.bps!, n.unit!) + ' · ' + n.podCount + ' 個 pod'}</text>
    </g>
  );
};

/* owner 終點卡：client 的負責人。跟 ns／app 一樣是邏輯彙總（實線描邊，虛線留給設備／截斷），
   但 owner 不是 namespace、沒有 ns 色，用葉卡那支灰——不新增顏色定義。
   bps 只來自「整張卡只有這一個 owner」的 port；名下的 port 上還有別人的機器時 bps 是 0，
   那不是「沒有流量」而是「量停在 port」，所以第三行改印台數，不能印一個 0 出來。 */
export const OwnerCard = ({ n, g, model }: CardProps) => (
  <g data-tip={tipAttr(n, model)}>
    <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="8" fill="#94a3b8" fillOpacity=".10" stroke="#94a3b8" strokeWidth="1.4" />
    <text className="leaf-stop" x={g.x + 12} y={g.y + 17}>owner</text>
    <text className="leaf-main" x={g.x + 12} y={g.y + 34}>{clip(n.label, 34)}</text>
    {/* 量與台數分兩行：擠成一行會讀成「這個量是這幾個 port 的總和」，
        而名下只要有一個 port 掛著多個 owner，那個 port 的量就沒有算進來。 */}
    <text className="leaf-sub" x={g.x + 12} y={g.y + 48}>
      {n.bps! > 0 ? R(n.bps!, n.unit!) + (n.meteredPorts! < n.portCount! ? '（部分 port）' : '') : '量停在 port'}
    </text>
    <text className="leaf-stop" x={g.x + 12} y={g.y + 64}>{n.clientCount + ' 台 client · ' + n.portCount + ' 個 port'}</text>
  </g>
);

export const AnchorCard = ({ n, g, model }: CardProps) => {
  const inv = model.investigation!;
  return (
    <g data-tip={tipAttr(n, model)}>
      <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="8" fill="#0d1a22" stroke="#22d3ee" strokeWidth="1.4" strokeDasharray="4 3" />
      <text className="leaf-stop" style={{ fill: '#22d3ee' }} x={g.x + 12} y={g.y + 18}>追查起點</text>
      <text className="leaf-main" x={g.x + 12} y={g.y + 36}>{inv.iface}</text>
      <text className="leaf-sub" x={g.x + 12} y={g.y + 52}>{n.dirLabel + ' 方向 · ' + D(inv.delta_bps)}</text>
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
