/* SVG Sankey 繪製（字串版）：青帶＝已追查（storage 資料的 read 通道同色、write 通道燃橘）、
   殘差＝盒子外側與帶寬等比的虛線色塊、終止＝灰虛線小卡。
   帶上的數字一律是實際量測值，沒有推估值；單位跟著邊（bps 帶 + 號、bytes/s 不帶）。

   過渡期的形狀：版面已經抽到 layout/（純函式、回 Geometry Map），這裡的字串 emitters
   還是舊寫法，吃「model 欄位 + 版面欄位合併」的 view 物件（N()／E()）——最小改動就能
   逐 byte 驗證版面抽取沒動到任何座標。下一步整支換成 React 元件，直接讀 Map。 */
import { fmtDelta as D, fmtRate as R, fmtAmount as A } from './model/format.js';
import type { TraceEdge, TraceModelOk, TraceNode } from './model/types.js';
import { CLIENT_GAP, CLIENT_PAD, DEVICE_TYPES, OWN_T, PAD_SIDE, PAD_TOP, RES_GAP, RES_LEN, STATUS_COLOR } from './layout/constants.js';
import { clientCols, clientRows, clip, esc, hasUsage, headerH, usageText } from './layout/text.js';
import { layout } from './layout/layout.js';
import { backwardRibbon, lateralRibbon, ownLine, ribbon } from './layout/paths.js';
import { bandMeta, bandTitle, colCaption, nodeTip } from './layout/tips.js';
import { summary } from './summary.js';

function tipAttr(n: any, model: any) { return ' data-tip="' + esc(JSON.stringify(nodeTip(n, model))) + '"'; }

function nodeBox(n: any, model: any, nsColor: any) {
  var isDevice = DEVICE_TYPES.indexOf(n.role) >= 0;   /* k8s node／pod、netapp 三型別：虛線框 */
  var statusColor = n.status ? STATUS_COLOR[n.status] : null;
  var s = [];
  /* 外框色優先序：status（critical 玫瑰／warning 琥珀）> root 青框 > 設備天藍 > 預設；
     虛線只看設備型別——root 的 k8s node 兩個身分都看得見 */
  s.push('<g' + tipAttr(n, model) + '>');
  s.push('<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="9" ' +
    'fill="#101c28" stroke="' + (statusColor || (n.isRoot ? '#22d3ee' : (isDevice ? '#7dd3fc' : '#2c3e52'))) + '" ' +
    'stroke-width="' + (n.isRoot || statusColor ? 1.8 : 1.2) + '"' + (isDevice ? ' stroke-dasharray="6 4"' : '') + '/>');
  s.push('<line x1="' + n.x + '" y1="' + (n.y + headerH(n) - 6) + '" x2="' + (n.x + n.w) +
    '" y2="' + (n.y + headerH(n) - 6) + '" stroke="#22303f"/>');
  s.push('<text class="n-title" x="' + (n.x + 12) + '" y="' + (n.y + 17) + '">' + esc(n.label) + '</text>');
  var sub = esc(n.id);
  if (n.namespace) {
    sub += ' · <tspan style="fill:' + (nsColor[n.namespace] || '#94a3b8') + '">ns/' + esc(n.namespace) + '</tspan>';
  }
  if (n.role !== 'switch') sub += ' · ' + esc(n.role);
  if (n.ontapCluster) sub += ' · ' + esc(n.ontapCluster);
  s.push('<text class="n-sub" x="' + (n.x + 12) + '" y="' + (n.y + 29) + '">' + sub + '</text>');
  if (hasUsage(n)) {
    s.push('<text class="n-sub" x="' + (n.x + 12) + '" y="' + (n.y + 41) + '">使用 ' + esc(usageText(n.usage)) + '</text>');
  }

  n.leftSlots.forEach(function (sl: any) {
    if (sl.res || !sl.iface) return;             /* 殘差的標籤畫在盒子外面；k8s port 可沒 iface */
    s.push('<text class="p-label" x="' + (n.x + 10) + '" y="' + (sl.cy + 3.5) + '">' + esc(sl.iface) + '</text>');
  });
  n.rightSlots.forEach(function (sl: any) {
    if (sl.res || !sl.iface) return;
    s.push('<text class="p-label" text-anchor="end" x="' + (n.x + n.w - 10) + '" y="' + (sl.cy + 3.5) + '">' +
      esc(sl.iface) + '</text>');
  });
  s.push('</g>');
  return s.join('');
}

function leafCard(n: any, model: any, nsColor: any) {
  var s = [];
  var nsc = n.namespace ? (nsColor[n.namespace] || '#94a3b8') : null;
  var statusColor = n.status ? STATUS_COLOR[n.status] : null;
  s.push('<g' + tipAttr(n, model) + '>');
  s.push('<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8" ' +
    'fill="#0e151d" stroke="' + (statusColor || '#94a3b8') + '" stroke-opacity="' + (statusColor ? '1' : '.65') +
    '" stroke-width="' + (statusColor ? '1.8' : '1.1') + '" stroke-dasharray="5 4"/>');
  /* 左緣 ns 色條：帶 ns 的非 pod 葉也照畫（與色盤取用條件一致）。
     上下內縮避開圓角，避免色條戳出弧線外。 */
  if (nsc) {
    s.push('<rect x="' + (n.x + 1.5) + '" y="' + (n.y + 5) + '" width="4" height="' + (n.h - 10) +
      '" rx="2" fill="' + nsc + '" fill-opacity=".85"/>');
  }
  /* 接了 owner 卡的 port 已經不是終點了（比照 pod 卡從「追查終止」變成 pod） */
  s.push('<text class="leaf-stop" x="' + (n.x + 12) + '" y="' + (n.y + 17) + '">' +
    (n.ownerLinked ? 'port' : '追查終止') + '</text>');
  var cols = clientCols(n), ly: any;
  if (cols.length) {
    /* 有 client 的卡：合成 id（sw-tor-1:xe-0/0/12）不當標題——順著帶子回去就知道是哪台
       switch 的哪個 iface，抄在卡上是重複資訊。真的給了 name 才畫標題。
       最後一行也不再重複 iface，只留量。 */
    ly = n.y + 34;
    if (n.named) {
      s.push('<text class="leaf-main" x="' + (n.x + 12) + '" y="' + ly + '">' + esc(n.label) + '</text>');
      ly += 14;
    }
    if (n.namespace) {
      s.push('<text class="leaf-sub" style="fill:' + nsc + '" x="' + (n.x + 12) + '" y="' + ly + '">ns/' +
        esc(n.namespace) + '</text>');
      ly += 14;
    }
    /* 表頭用 wire 的欄位名（跟 tooltip 印 ontap_cluster／health 同一套慣例），
       樣式沿用 .leaf-stop（灰小字），分隔線沿用 nodeBox 那條內聯 stroke——不新增類別與顏色。 */
    var cx = n.x + CLIENT_PAD;
    cols.forEach(function (col: any) {
      s.push('<text class="leaf-stop" x="' + cx + '" y="' + ly + '">' + col.key + '</text>');
      cx += col.w + CLIENT_GAP;
    });
    s.push('<line x1="' + (n.x + CLIENT_PAD) + '" y1="' + (ly + 4) + '" x2="' + (n.x + n.w - CLIENT_PAD) +
      '" y2="' + (ly + 4) + '" stroke="#22303f"/>');
    ly += 14;
    clientRows(n).forEach(function (cells: any) {
      var rx = n.x + CLIENT_PAD;
      cells.forEach(function (v: any, i: any) {
        if (v) s.push('<text class="leaf-sub" x="' + rx + '" y="' + ly + '">' + esc(v) + '</text>');
        rx += cols[i].w + CLIENT_GAP;
      });
      ly += 14;
    });
    s.push('<text class="leaf-sub" x="' + (n.x + 12) + '" y="' + ly + '">' + esc(A(n.bps, n.unit)) + '</text>');
  } else {
    s.push('<text class="leaf-main" x="' + (n.x + 12) + '" y="' + (n.y + 34) + '">' + esc(n.label) + '</text>');
    ly = n.y + 48;
    if (n.namespace) {
      s.push('<text class="leaf-sub" style="fill:' + nsc + '" x="' + (n.x + 12) + '" y="' + ly + '">ns/' +
        esc(n.namespace) + '</text>');
      ly += 14;
    }
    var ifc = n.iface || n.localIface || '';
    s.push('<text class="leaf-sub" x="' + (n.x + 12) + '" y="' + ly + '">' +
      (ifc ? esc(ifc) + ' · ' : '') + esc(A(n.bps, n.unit)) + '</text>');
  }
  /* 查得到 client 就不是「不明終點」了：右上角換成 client 標記 */
  var nc = n.clients ? n.clients.length : 0;
  s.push('<text class="leaf-stop" text-anchor="end" x="' + (n.x + n.w - 12) + '" y="' + (n.y + 17) +
    '">' + (nc === 0 ? '未再往下追' : (nc === 1 ? 'client' : nc + ' 個 client')) + '</text>');
  s.push('</g>');
  return s.join('');
}

/* pod 中繼卡：外觀沿用天藍虛線＋ns 色條的 pod 家族，但 pod 已不是終點——
   另一側有邊接 app／ns 終點，「追查終止／未再往下追」字樣不再出現。
   沒有 ns 的 pod（合法）就沒有色條與 ns 行，iface 行上移。 */
function podCard(n: any, model: any, nsColor: any) {
  var nsc = n.namespace ? (nsColor[n.namespace] || '#94a3b8') : null;
  var statusColor = n.status ? STATUS_COLOR[n.status] : null;
  var s = [];
  s.push('<g' + tipAttr(n, model) + '>');
  s.push('<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8" ' +
    'fill="#0e151d" stroke="' + (statusColor || '#7dd3fc') + '" stroke-opacity="' + (statusColor ? '1' : '.55') +
    '" stroke-width="' + (statusColor ? '1.8' : '1.1') + '" stroke-dasharray="5 4"/>');
  /* 左緣 ns 色條：同 ns 的 pod 相鄰排列時色條連成一段，彙總一眼可讀 */
  if (nsc) {
    s.push('<rect x="' + (n.x + 1.5) + '" y="' + (n.y + 5) + '" width="4" height="' + (n.h - 10) +
      '" rx="2" fill="' + nsc + '" fill-opacity=".85"/>');
  }
  s.push('<text class="leaf-stop" x="' + (n.x + 12) + '" y="' + (n.y + 17) + '">pod</text>');
  s.push('<text class="leaf-main" x="' + (n.x + 12) + '" y="' + (n.y + 34) + '">' + esc(n.label) + '</text>');
  var ly = n.y + 48;
  if (nsc) {
    s.push('<text class="leaf-sub" style="fill:' + nsc + '" x="' + (n.x + 12) + '" y="' + ly + '">ns/' +
      esc(n.namespace) + '</text>');
    ly += 14;
  }
  var ifc = n.iface || n.localIface || '';
  s.push('<text class="leaf-sub" x="' + (n.x + 12) + '" y="' + ly + '">' +
    (ifc ? esc(ifc) + ' · ' : '') + esc(A(n.bps, n.unit)) + '</text>');
  s.push('</g>');
  return s.join('');
}

/* 群組終點卡（namespace／application）：邏輯彙總、不是設備——用 ns 色實線描邊，
   虛線留給「設備／截斷」的既有語彙。bps 是所有成員邊的加總（model 算好）；
   status 是成員 pod 的最差值，有就換成 status 色描邊。 */
function groupCard(n: any, model: any, nsColor: any, word: any) {
  var nsc = nsColor[n.namespace] || '#94a3b8';
  var statusColor = n.status ? STATUS_COLOR[n.status] : null;
  var s = [];
  s.push('<g' + tipAttr(n, model) + '>');
  s.push('<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8" ' +
    'fill="' + nsc + '" fill-opacity=".10" stroke="' + (statusColor || nsc) + '" stroke-width="' + (statusColor ? '1.8' : '1.4') + '"/>');
  s.push('<text class="leaf-stop" style="fill:' + nsc + '" x="' + (n.x + 12) + '" y="' + (n.y + 17) +
    '">' + word + '</text>');
  s.push('<text class="leaf-main" x="' + (n.x + 12) + '" y="' + (n.y + 34) + '">' + esc(n.label) + '</text>');
  s.push('<text class="leaf-sub" x="' + (n.x + 12) + '" y="' + (n.y + 48) + '">' +
    esc(R(n.bps, n.unit)) + ' · ' + n.podCount + ' 個 pod</text>');
  s.push('</g>');
  return s.join('');
}
function nsCard(n: any, model: any, nsColor: any) { return groupCard(n, model, nsColor, 'namespace'); }
function appCard(n: any, model: any, nsColor: any) { return groupCard(n, model, nsColor, 'application'); }

/* owner 終點卡：client 的負責人。跟 ns／app 一樣是邏輯彙總（實線描邊，虛線留給設備／截斷），
   但 owner 不是 namespace、沒有 ns 色，用葉卡那支灰——不新增顏色定義。
   bps 只來自「整張卡只有這一個 owner」的 port；名下的 port 上還有別人的機器時 bps 是 0，
   那不是「沒有流量」而是「量停在 port」，所以第三行改印台數，不能印一個 0 出來。 */
function ownerCard(n: any, model: any) {
  var s = [];
  s.push('<g' + tipAttr(n, model) + '>');
  s.push('<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8" ' +
    'fill="#94a3b8" fill-opacity=".10" stroke="#94a3b8" stroke-width="1.4"/>');
  s.push('<text class="leaf-stop" x="' + (n.x + 12) + '" y="' + (n.y + 17) + '">owner</text>');
  s.push('<text class="leaf-main" x="' + (n.x + 12) + '" y="' + (n.y + 34) + '">' +
    esc(clip(n.label, 34)) + '</text>');
  /* 量與台數分兩行：擠成一行會讀成「這個量是這幾個 port 的總和」，
     而名下只要有一個 port 掛著多個 owner，那個 port 的量就沒有算進來。 */
  s.push('<text class="leaf-sub" x="' + (n.x + 12) + '" y="' + (n.y + 48) + '">' +
    (n.bps > 0 ? esc(R(n.bps, n.unit)) + (n.meteredPorts < n.portCount ? '（部分 port）' : '')
               : '量停在 port') + '</text>');
  s.push('<text class="leaf-stop" x="' + (n.x + 12) + '" y="' + (n.y + 64) + '">' +
    n.clientCount + ' 台 client · ' + n.portCount + ' 個 port</text>');
  s.push('</g>');
  return s.join('');
}

function anchorCard(n: any, model: any) {
  var inv = model.investigation;
  var s = [];
  s.push('<g' + tipAttr(n, model) + '>');
  s.push('<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8" ' +
    'fill="#0d1a22" stroke="#22d3ee" stroke-width="1.4" stroke-dasharray="4 3"/>');
  s.push('<text class="leaf-stop" style="fill:#22d3ee" x="' + (n.x + 12) + '" y="' + (n.y + 18) + '">追查起點</text>');
  s.push('<text class="leaf-main" x="' + (n.x + 12) + '" y="' + (n.y + 36) + '">' + esc(inv.iface) + '</text>');
  s.push('<text class="leaf-sub" x="' + (n.x + 12) + '" y="' + (n.y + 52) + '">' +
    esc(n.dirLabel) + ' 方向 · ' + esc(D(inv.delta_bps)) + '</text>');
  s.push('</g>');
  return s.join('');
}

function residual(n: any, sl: any) {
  var isIn = sl.res === 'in';
  var color = isIn ? '#f59e0b' : '#fb7185';
  var h = sl.t;                                  /* 已含 THICK_MIN 下限 */
  var x = isIn ? n.x - RES_LEN : n.x + n.w;
  var txtX = isIn ? x - RES_GAP : x + RES_LEN + RES_GAP;
  var anchorAttr = isIn ? 'end' : 'start';
  var word = isIn ? '其他輸入' : '其他輸出';
  var amount = (isIn && n.unit !== 'bytesPerSec' ? '+' : '') + A(sl.bps, n.unit);
  /* 標籤用描邊光暈，不用不透明底板——底板會在青帶上打出一個黑洞（殘差最後才畫） */
  var halo = 'paint-order:stroke;stroke:#0b1017;stroke-width:3.5px';
  var s = [];
  s.push('<g>');
  s.push('<title>' + esc(n.label + '：' + word + ' ' + A(sl.bps, n.unit) +
    '（已追查 in ' + A(n.tracedIn, n.unit) + ' / out ' + A(n.tracedOut, n.unit) + '）') + '</title>');
  s.push('<rect x="' + x + '" y="' + (sl.cy - h / 2) + '" width="' + RES_LEN + '" height="' + h + '" ' +
    'fill="' + color + '" fill-opacity=".16" ' +
    'stroke="' + color + '" stroke-width="1.4" stroke-dasharray="4 3"/>');
  s.push('<text class="res-label" text-anchor="' + anchorAttr + '" x="' + txtX + '" y="' + (sl.cy - 1) +
    '" style="fill:' + color + ';' + halo + '">' + esc(word) + '</text>');
  s.push('<text class="res-label" text-anchor="' + anchorAttr + '" x="' + txtX + '" y="' + (sl.cy + 11) +
    '" style="fill:' + color + ';' + halo + '">' + esc(amount) + '</text>');
  s.push('</g>');
  return s.join('');
}

function render(model: TraceModelOk): string {
  var geo = layout(model);
  /* 過渡期的 view：model 欄位 + 版面欄位攤平成一個物件，emitters 不用改讀法 */
  var N = function (n: TraceNode): any { return Object.assign({}, n, geo.nodes.get(n.id)); };
  var E = function (e: TraceEdge): any { return Object.assign({}, e, geo.edges.get(e.id)); };
  var out = [];
  /* 尺寸交給 CSS（.chart svg）：SVG 填滿容器，meet-fit 就是「符合視窗」。 */
  out.push('<svg viewBox="0 0 ' + geo.width + ' ' + geo.height + '" ' +
    'preserveAspectRatio="xMidYMid meet" ' +
    'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="追查 Sankey">');
  out.push('<defs>' +
    '<linearGradient id="gband" x1="0" x2="1"><stop offset="0" stop-color="#22d3ee" stop-opacity=".85"/>' +
    '<stop offset="1" stop-color="#0e7490" stop-opacity=".85"/></linearGradient>' +
    '<linearGradient id="gband-h" x1="0" x2="1"><stop offset="0" stop-color="#67e8f9"/>' +
    '<stop offset="1" stop-color="#22d3ee"/></linearGradient>' +
    '<linearGradient id="gband-back" x1="1" x2="0"><stop offset="0" stop-color="#fb7185" stop-opacity=".75"/>' +
    '<stop offset="1" stop-color="#9f1239" stop-opacity=".75"/></linearGradient>' +
    '<linearGradient id="gband-back-h" x1="1" x2="0"><stop offset="0" stop-color="#fda4af"/>' +
    '<stop offset="1" stop-color="#be123c"/></linearGradient>' +
    /* write 通道（storage 資料）：燃橘。read 沿用青帶——read 與無通道的 switch 帶同色。
       只在圖上真的有 write 帶時才輸出這兩個漸層：switch 追查資料的 SVG 逐 byte 不變 */
    (model.edges.some(function (e) { return e.channel === 'write'; })
      ? '<linearGradient id="gband-w" x1="0" x2="1"><stop offset="0" stop-color="#c2410c" stop-opacity=".85"/>' +
        '<stop offset="1" stop-color="#7c2d12" stop-opacity=".85"/></linearGradient>' +
        '<linearGradient id="gband-w-h" x1="0" x2="1"><stop offset="0" stop-color="#fb923c"/>' +
        '<stop offset="1" stop-color="#c2410c"/></linearGradient>'
      : '') +
    '</defs>');
  /* 縮放層：TraceZoom 只動這個 <g> 的 transform。<defs> 留在外面。 */
  out.push('<g class="zoom-layer">');
  if (!model.nodes.length) {
    out.push('<text class="col-cap" x="' + PAD_SIDE + '" y="' + PAD_TOP + '">顯示門檻／通道過濾之後沒有任何節點</text>');
  }

  /* 欄位標題 */
  (geo.cols || []).forEach(function (col) {
    if (!col || !col.length) return;
    var cap = colCaption(col, model.dir);
    out.push('<text class="col-cap" x="' + geo.nodes.get(col[0].id)!.x + '" y="24">' + esc(cap) + '</text>');
  });

  /* 帶：先畫，壓在盒子下面 */
  model.edges.forEach(function (me) {
    var e = E(me);
    var meta = bandMeta(me, model);
    var isW = e.channel === 'write';
    var tt = bandTitle(me, meta);
    if (e.backward) {
      var backTitle = '<title>' + esc(tt + '（回流）') + '</title>';
      if (e.backNear) {
        /* 相鄰欄回流：整條活在兩欄之間的走廊，反向的一般帶 */
        out.push('<path class="band band-back" d="' + ribbon(e) + '" fill="url(#gband-back)" ' +
          'stroke="#fb7185" stroke-opacity=".35" stroke-width="1" ' +
          'data-tip="' + esc(JSON.stringify(meta)) + '">' + backTitle + '</path>');
      } else {
        /* band-loop：fill 是 none，hover 只能加深 stroke，CSS 得認得出來 */
        out.push('<path class="band band-back band-loop" d="' + backwardRibbon(e) + '" fill="none" ' +
          'stroke="#fb7185" stroke-opacity=".55" stroke-width="' + e.backT + '" ' +
          'stroke-linejoin="round" stroke-linecap="butt" ' +
          'data-tip="' + esc(JSON.stringify(meta)) + '">' + backTitle + '</path>');
      }
      return;
    }
    /* 歸屬線：只表達「這個 port 掛的機器屬於誰」，量停在 port。灰虛線沿用葉卡外框的語彙，
       不新增顏色；stroke-linecap 留預設，短虛線才不會糊在一起。 */
    if (e.owns) {
      out.push('<path class="band band-own" d="' + ownLine(e) + '" fill="none" ' +
        'stroke="#94a3b8" stroke-opacity=".55" stroke-width="' + OWN_T + '" stroke-dasharray="5 4" ' +
        'data-tip="' + esc(JSON.stringify(meta)) + '"><title>' +
        esc(meta.from + ' → ' + meta.to + '：歸屬（量停在 port）') + '</title></path>');
      return;
    }
    out.push('<path class="band' + (e.lateral ? ' band-lat' : '') + (isW ? ' band-w' : '') + '" d="' +
      (e.lateral ? lateralRibbon(e, e.bulge) : ribbon(e)) + '" fill="url(#' + (isW ? 'gband-w' : 'gband') + ')" ' +
      'stroke="' + (isW ? '#c2410c' : '#22d3ee') + '" stroke-opacity=".35" stroke-width="1" ' +
      'data-tip="' + esc(JSON.stringify(meta)) + '"><title>' + esc(tt) + '</title></path>');
    /* 馬蹄弧一定終止在 target 右緣、且是朝 -x 進來的，所以固定一個朝左的三角形
       就永遠指對方向，不用算路徑切線。兄弟節點而非包在 band 裡：包起來會打斷
       .band:hover 與 querySelectorAll('.band') 的 tooltip 綁定。 */
    if (e.lateral) {
      var as = Math.max(5, Math.min(9, e.t2 / 2));   /* 細帶也看得見，粗帶不誇張 */
      out.push('<path class="lat-arrow' + (isW ? ' arrow-w' : '') + '" d="M' + (e.x2 + 4 + as * 2) + ',' + (e.y2 - as) +
        ' L' + (e.x2 + 4) + ',' + e.y2 +
        ' L' + (e.x2 + 4 + as * 2) + ',' + (e.y2 + as) + ' Z"/>');
    }
  });

  /* 帶上的數字。橫向弧帶的數字放弧頂，回流帶放底部水平段中點，放中點會壓在欄上 */
  model.edges.forEach(function (me) {
    if (me.owns) return;                        /* 歸屬線沒有量，印數字就是憑空生一個值 */
    var e = E(me);
    var mx = (e.backward && !e.backNear) ? (e.backXD + e.backXU) / 2
      : e.lateral ? e.x1 + 0.72 * e.bulge : (e.x1 + e.x2) / 2;
    var my = (e.backward && !e.backNear) ? e.backY - e.backT / 2 - 10 : (e.y1 + e.y2) / 2;
    out.push('<text x="' + mx + '" y="' + (my + 4) + '" text-anchor="middle" class="p-val" ' +
      'style="paint-order:stroke;stroke:#0b1017;stroke-width:3.5px">' + esc(R(e.bps, e.unit)) + '</text>');
  });

  /* 盒子 */
  model.nodes.forEach(function (mn) {
    var n = N(mn);
    if (n.kind === 'node') out.push(nodeBox(n, model, geo.nsColor));
    else if (n.kind === 'leaf') {
      if (n.role === 'pod') out.push(podCard(n, model, geo.nsColor));
      else if (n.role === 'ns') out.push(nsCard(n, model, geo.nsColor));
      else if (n.role === 'app') out.push(appCard(n, model, geo.nsColor));
      else if (n.role === 'owner') out.push(ownerCard(n, model));
      else out.push(leafCard(n, model, geo.nsColor));
    }
    else out.push(anchorCard(n, model));
  });

  /* 殘差：貼盒子外側、與帶寬等比的虛線色塊，不進走廊。
     直接走槽位，畫出來的東西跟 layout() 保留的空間就不可能不一致。 */
  model.nodes.forEach(function (mn) {
    if (mn.kind !== 'node') return;
    var n = N(mn);
    n.leftSlots.concat(n.rightSlots).forEach(function (sl: any) {
      if (sl.res) out.push(residual(n, sl));
    });
  });

  out.push('</g>');
  out.push('</svg>');
  return out.join('');
}

export { render, summary, esc };
