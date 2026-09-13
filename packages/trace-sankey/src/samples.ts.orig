/* 範例追查 JSON（elements wire 格式）。純資料，不抓 counter、不掃網。
   三個簡寫只是省字，不是轉換器：G(10) = 10 Gbps、N(...) = 一個節點、E(...) = 一條 network-flow 邊。 */
import type { WireGraph } from './model/types.js';

export interface TraceSample {
  key: string;
  name: string;
  desc: string;
  json: WireGraph;
}

var G = function (n: number) { return Math.round(n * 1e9); };
/* N(id, type, name?, extra?)：extra 直接合併進 data（labels／other_*_bps） */
function N(id: string, type: string, name?: string | null, extra?: Record<string, any>) {
  var d: any = { id: id, type: type };
  if (name) d.name = name;
  if (extra) Object.keys(extra).forEach(function (k: any) { d[k] = extra[k]; });
  return { data: d };
}
/* E(id, source, source_iface, target, target_iface, bps)：iface 給空字串就不寫進 labels（k8s 內部沒有 switch iface） */
function E(id: string, src: string, sif: string, dst: string, dif: string, bps: number) {
  var d: any = { id: id, type: 'network-flow', source: src, target: dst };
  var labels: any = {};
  if (sif) labels.source_iface = sif;
  if (dif) labels.target_iface = dif;
  if (sif || dif) d.labels = labels;
  d.metrics = { delta_bps: bps };
  return { data: d };
}

var SAMPLES: TraceSample[] = [
  {
    key: 'classic',
    name: '經典不守恆',
    desc: 'A→B 10G 進來，B→C 出去 20G。多出來的 10G 是 B 的其他輸入，不是 B 生的。',
    json: {
      kind: 'destination',
      investigation: {
        node_id: 'sw-edge-a', iface: 'xe-0/0/1', delta_bps: G(10), direction: 'in',
        note: 'Edge A 的 access port 進來 +10 Gbps'
      },
      elements: {
        nodes: [
          N('sw-edge-a', 'switch', 'Edge A'),
          N('sw-core-1', 'switch', 'Core 1'),
          N('srv-db-07', 'host')
        ],
        edges: [
          E('e0', 'sw-edge-a', 'et-0/0/48', 'sw-core-1', 'et-1/0/1', G(20)),
          E('e1', 'sw-core-1', 'et-1/0/9', 'srv-db-07', 'eno1', G(20))
        ]
      }
    }
  },

  {
    key: 'dual-uplink',
    name: '雙 uplink',
    desc: '兩條 uplink 匯入同一台 core：同一對節點之間兩條邊，各自一條帶；core 往下的兩筆量測相加成一條。',
    json: {
      kind: 'destination',
      investigation: { node_id: 'sw-edge-a', iface: 'xe-0/0/1', delta_bps: G(10), direction: 'in' },
      elements: {
        nodes: [
          N('sw-edge-a', 'switch', 'Edge A'),
          N('sw-core-1', 'switch', 'Core 1'),
          N('sw-agg-9', 'switch', 'Agg 9'),
          N('srv-cache-02', 'host'),
          N('srv-cache-03', 'host')
        ],
        edges: [
          E('e0', 'sw-edge-a', 'et-0/0/48', 'sw-core-1', 'et-1/0/1', G(6)),
          E('e1', 'sw-edge-a', 'et-0/0/49', 'sw-core-1', 'et-1/0/2', G(4)),
          /* 同 (source, target, iface) 的兩筆 9G＋7G 已合成一筆；拆成兩條邊也會自動加總 */
          E('e2', 'sw-core-1', 'et-1/0/24', 'sw-agg-9', 'et-9/0/1', G(16)),
          E('e3', 'sw-agg-9', 'xe-9/0/12', 'srv-cache-02', 'bond0', G(11)),
          E('e4', 'sw-agg-9', 'xe-9/0/13', 'srv-cache-03', 'bond0', G(5))
        ]
      }
    }
  },

  {
    key: 'campus',
    name: '校園骨幹',
    desc: '宿網 → 匯聚 → 核心 → 出口／機房。每層都有沒追的上聯與沒跟的出口；rtr-tanet 從兩台接進來，是一張多邊葉卡。',
    json: {
      kind: 'destination',
      investigation: {
        node_id: 'sw-dorm-b3', iface: 'ae0', delta_bps: G(8), direction: 'in',
        note: '宿舍 B3 上聯 ae0 進向 +8 Gbps'
      },
      elements: {
        nodes: [
          N('sw-dorm-b3', 'switch', '宿網 B3'),
          N('sw-agg-dorm', 'switch', '宿區匯聚'),
          N('sw-core-n', 'switch', '核心 North'),
          N('fw-campus', 'switch', '校園防火牆'),
          N('sw-dc-spine', 'switch', '機房 Spine'),
          N('rtr-tanet', 'router'),
          N('srv-nas-01', 'host')
        ],
        edges: [
          E('e0', 'sw-dorm-b3', 'et-0/0/50', 'sw-agg-dorm', 'et-2/0/3', G(22)),
          E('e1', 'sw-agg-dorm', 'ae10', 'sw-core-n', 'ae1', G(18)),
          E('e2', 'sw-agg-dorm', 'xe-2/0/7', 'fw-campus', 'xe-0/0/0', G(6)),
          E('e3', 'sw-core-n', 'et-0/0/1', 'rtr-tanet', 'Te0/1/0', G(12)),
          E('e4', 'sw-core-n', 'et-0/0/2', 'sw-dc-spine', 'et-1/1/1', G(4)),
          E('e5', 'fw-campus', 'xe-0/0/1', 'rtr-tanet', 'Te0/1/1', G(6)),
          E('e6', 'sw-dc-spine', 'et-1/1/9', 'srv-nas-01', 'ens5f0', G(4))
        ]
      }
    }
  },

  {
    key: 'pruned',
    name: '截斷殘差',
    desc: '這層有 9 個 port 在漲，只跟前 3 名（≥10%）。沒跟的併成其他輸出（other_out_bps 顯式給），用等比的虛線色塊貼在右邊。',
    json: {
      kind: 'destination',
      investigation: { node_id: 'sw-tor-14', iface: 'et-0/0/52', delta_bps: G(40), direction: 'in' },
      elements: {
        nodes: [
          N('sw-tor-14', 'switch', 'ToR 14', { other_out_bps: G(9) }),
          N('sw-leaf-3', 'switch', 'Leaf 3', { other_out_bps: G(3) }),
          N('srv-app-11', 'host'),
          N('srv-app-12', 'host'),
          N('srv-log-01', 'host'),
          N('srv-log-02', 'host')
        ],
        edges: [
          E('e0', 'sw-tor-14', 'xe-0/0/1', 'sw-leaf-3', 'et-3/0/1', G(18)),
          E('e1', 'sw-tor-14', 'xe-0/0/2', 'srv-app-11', 'eno2', G(9)),
          E('e2', 'sw-tor-14', 'xe-0/0/3', 'srv-app-12', 'eno2', G(6)),
          E('e3', 'sw-leaf-3', 'xe-3/0/8', 'srv-log-01', 'bond0', G(10)),
          E('e4', 'sw-leaf-3', 'xe-3/0/9', 'srv-log-02', 'bond0', G(5))
        ]
      }
    }
  },

  {
    key: 'source',
    name: '追來源',
    desc: '看到某條 out 增加，往回追貢獻大的 in。起點釘在最右，邊仍一律照封包方向寫（上游 → 下游）。',
    json: {
      kind: 'source',
      investigation: {
        node_id: 'sw-core-1', iface: 'et-1/0/9', delta_bps: G(20), direction: 'out',
        note: 'Core 1 出向 et-1/0/9 +20 Gbps，問誰灌的'
      },
      elements: {
        nodes: [
          N('sw-core-1', 'switch', 'Core 1'),
          N('sw-edge-a', 'switch', 'Edge A'),
          N('sw-edge-b', 'switch', 'Edge B', { other_in_bps: G(2) }),
          N('lab-gpu-01', 'host'),
          N('lab-gpu-02', 'host'),
          N('backup-relay', 'host')
        ],
        edges: [
          E('e0', 'sw-edge-a', 'et-0/0/48', 'sw-core-1', 'et-1/0/1', G(12)),
          E('e1', 'sw-edge-b', 'et-0/0/48', 'sw-core-1', 'et-1/0/2', G(6)),
          E('e2', 'lab-gpu-01', 'eno1', 'sw-edge-a', 'xe-0/0/1', G(7)),
          E('e3', 'lab-gpu-02', 'eno1', 'sw-edge-a', 'xe-0/0/2', G(3)),
          E('e4', 'backup-relay', 'eth0', 'sw-edge-b', 'xe-0/0/5', G(4))
        ]
      }
    }
  },

  {
    key: 'k8s',
    name: 'Switch → Node → Pod → NS',
    desc: '同一條 Sankey 接下去。node 是虛線盒、pod 是中繼小卡，流量匯進 namespace 終點——' +
      'telemetry 跨兩台 node 的 pod 合進同一個 ns 節點。k8s 內部的邊可以不寫 iface；' +
      'node 也能當葉（沒有往下的邊就整台補成其他輸出）。',
    json: {
      kind: 'destination',
      investigation: { node_id: 'sw-tor-k8s', iface: 'et-0/0/48', delta_bps: G(30), direction: 'in' },
      elements: {
        nodes: [
          N('sw-tor-k8s', 'switch', 'ToR k8s'),
          N('node-w-11', 'node', 'node-w-11', { other_out_bps: G(2.5) }),
          N('node-w-12', 'node', 'node-w-12'),
          /* node 當葉：沒有往下的邊，進來的 5G 由平衡式補成其他輸出 */
          N('node-w-13', 'node', 'node-w-13'),
          N('srv-log-01', 'host'),
          /* pod 的 ns 用 labels.namespace（也可以用 parent 鏈接到 type:"namespace" 的群組節點） */
          N('ingest-7d9c', 'pod', null, { labels: { namespace: 'telemetry' } }),
          N('kafka-2', 'pod', null, { labels: { namespace: 'stream' } }),
          N('ingest-4f11', 'pod', null, { labels: { namespace: 'telemetry' } }),
          N('debug-shell', 'pod', null, { labels: { namespace: 'debug' } })
        ],
        edges: [
          E('e0', 'sw-tor-k8s', 'xe-0/0/11', 'node-w-11', 'bond0', G(14)),
          E('e1', 'sw-tor-k8s', 'xe-0/0/12', 'node-w-12', 'bond0', G(8)),
          E('e2', 'sw-tor-k8s', 'xe-0/0/13', 'node-w-13', 'bond0', G(5)),
          E('e3', 'sw-tor-k8s', 'xe-0/0/20', 'srv-log-01', 'eno1', G(3)),
          E('e4', 'node-w-11', 'veth3a1f', 'ingest-7d9c', '', G(8)),
          E('e5', 'node-w-11', 'veth9b02', 'kafka-2', '', G(3.5)),
          /* k8s node 內部沒有 switch iface：兩邊都不寫 */
          E('e6', 'node-w-12', '', 'ingest-4f11', '', G(5.5)),
          E('e7', 'node-w-12', '', 'debug-shell', '', G(2.5))
        ]
      }
    }
  },

  {
    key: 'k8s-source',
    name: 'NS → Pod → Node → Switch（追來源）',
    desc: '追來源方向的 k8s：namespace 終點在最左欄，batch 兩個 pod 跨 node 匯進同一個 ns；' +
      'node-w-21 的邊全省略 iface。',
    json: {
      kind: 'source',
      investigation: {
        node_id: 'sw-tor-k8s', iface: 'et-0/0/48', delta_bps: G(18), direction: 'out',
        note: 'ToR uplink 出量 +18G，追是哪些 pod 打出來的'
      },
      elements: {
        nodes: [
          N('sw-tor-k8s', 'switch', 'ToR k8s'),
          N('node-w-21', 'node', 'node-w-21'),
          N('node-w-22', 'node', 'node-w-22'),
          N('web-6f8d', 'pod', null, { labels: { namespace: 'frontend' } }),
          N('cache-1', 'pod', null, { labels: { namespace: 'frontend' } }),
          N('batch-9k', 'pod', null, { labels: { namespace: 'batch' } }),
          N('job-runner-5c', 'pod', null, { labels: { namespace: 'batch' } })
        ],
        edges: [
          E('e0', 'node-w-21', 'bond0', 'sw-tor-k8s', 'xe-0/0/21', G(12)),
          E('e1', 'node-w-22', 'bond0', 'sw-tor-k8s', 'xe-0/0/22', G(6)),
          E('e2', 'web-6f8d', '', 'node-w-21', '', G(7)),
          E('e3', 'cache-1', '', 'node-w-21', '', G(3)),
          E('e4', 'batch-9k', '', 'node-w-21', '', G(2)),
          E('e5', 'job-runner-5c', '', 'node-w-22', 'veth71aa', G(6))
        ]
      }
    }
  },

  {
    key: 'dci-tier',
    name: '同層互連（tier）',
    desc: 'bdr 與 dci 實際是同一層。不標 tier 時 bdr↔dci 互連會把 bdr 拆成兩欄；' +
      '同層的節點都標 labels.tier: "border" 就鎖在同一欄，互連畫成右側弧帶。',
    json: (function () {
      var T = { labels: { tier: 'border' } };
      var nodes = [N('core-1', 'switch', 'Core')];
      [1, 2, 3].forEach(function (i: any) { nodes.push(N('bdr-' + i, 'switch', 'BDR ' + i, T)); });
      [1, 2].forEach(function (i: any) { nodes.push(N('dci-' + i, 'switch', 'DCI ' + i, T)); });
      [4, 5, 6].forEach(function (i: any) { nodes.push(N('bdr-' + i, 'switch', 'BDR ' + i, T)); });
      [1, 2, 3].forEach(function (i: any) { nodes.push(N('spn-' + i, 'switch', 'SPN ' + i)); });
      [1, 2, 3, 4].forEach(function (i: any) { nodes.push(N('tor-' + i, 'switch', 'ToR ' + i)); });
      [1, 2, 3, 4].forEach(function (i: any) { nodes.push(N('srv-a-0' + i, 'host')); });
      var edges: any[] = [], seq = 0;
      var add = function (src: any, sif: any, dst: any, dif: any, bps: any) { edges.push(E('e' + (seq++), src, sif, dst, dif, bps)); };
      [1, 2, 3, 4, 5, 6].forEach(function (i: any) { add('core-1', 'et-0/0/' + i, 'bdr-' + i, 'et-1/0/1', G(4)); });
      /* bdr-1..3：1G 到 dci-1、1G 到 dci-2（同層互連 → 弧帶）、2G 到自己那台 spn */
      [1, 2, 3].forEach(function (i: any) {
        add('bdr-' + i, 'et-1/1/1', 'dci-1', 'ae0', G(1));
        add('bdr-' + i, 'et-1/1/2', 'dci-2', 'ae0', G(1));
        add('bdr-' + i, 'et-1/2/1', 'spn-' + i, 'et-2/0/' + i, G(2));
      });
      /* dci 再回到同層的 bdr-4..6 */
      [1, 2].forEach(function (j: any) {
        [4, 5, 6].forEach(function (i: any, k: any) { add('dci-' + j, 'et-9/0/' + (k + 1), 'bdr-' + i, 'et-1/0/' + (j + 1), G(1)); });
      });
      [4, 5, 6].forEach(function (i: any) {
        [1, 2, 3].forEach(function (s: any) { add('bdr-' + i, 'et-1/2/' + s, 'spn-' + s, 'et-2/0/' + i, G(2)); });
      });
      [1, 2, 3].forEach(function (s: any) {
        [1, 2, 3, 4].forEach(function (t: any) { add('spn-' + s, 'et-2/1/' + t, 'tor-' + t, 'et-3/0/' + s, G(2)); });
      });
      [1, 2, 3, 4].forEach(function (t: any) { add('tor-' + t, 'xe-3/0/10', 'srv-a-0' + t, 'eno1', G(6)); });
      return {
        kind: 'destination',
        investigation: {
          node_id: 'core-1', iface: 'et-0/0/0', delta_bps: G(24), direction: 'in',
          note: 'core 進來 +24 Gbps，跨 DC 流量經 dci 繞回同層 bdr'
        },
        elements: { nodes: nodes, edges: edges }
      };
    })()
  },
  (function () {
    /* 跨層回頭：core → bdr → dci → bdr、core → bdr → spn → tor。
       bdr 全同 tier；dci 與 spn 同 tier；tor 同 tier。dci 只回打 bdr，
       跟 bdr→dci/spn 的主流向繞成環 → 多數決排欄，6 條 dci→bdr 畫成回流帶。
       數字全守恆：每台 bdr in = 4G(core)+1G(dci 回打) = out = 1G(dci)+4G(spn)。 */
    var nodes = [N('core-1', 'switch', 'Core 1')];
    [1, 2, 3, 4, 5, 6].forEach(function (i: any) { nodes.push(N('bdr-' + i, 'switch', 'BDR ' + i, { labels: { tier: 'bdr' } })); });
    [1, 2, 3].forEach(function (j: any) { nodes.push(N('dci-' + j, 'switch', 'DCI ' + j, { labels: { tier: 'dci-spn' } })); });
    [1, 2, 3].forEach(function (s: any) { nodes.push(N('spn-' + s, 'switch', 'SPN ' + s, { labels: { tier: 'dci-spn' } })); });
    [1, 2, 3, 4].forEach(function (k: any) { nodes.push(N('tor-' + k, 'switch', 'ToR ' + k, { labels: { tier: 'tor' } })); });
    [1, 2, 3, 4].forEach(function (k: any) { nodes.push(N('srv-' + k, 'host')); });
    var edges: any[] = [], seq = 0;
    var add = function (src: any, sif: any, dst: any, dif: any, bps: any) { edges.push(E('e' + (seq++), src, sif, dst, dif, bps)); };
    [1, 2, 3, 4, 5, 6].forEach(function (i: any) { add('core-1', 'et-0/0/' + i, 'bdr-' + i, 'et-1/0/1', G(4)); });
    var pair = function (i: any) { return Math.ceil(i / 2); };        /* bdr-1,2→dci-1/spn-1 … */
    [1, 2, 3, 4, 5, 6].forEach(function (i: any) {
      add('bdr-' + i, 'et-2/0/1', 'dci-' + pair(i), 'ae0', G(1));
      add('bdr-' + i, 'et-2/0/2', 'spn-' + pair(i), 'et-0/0/' + i, G(4));
    });
    /* dci 回打錯開（dci-1→bdr-3,4；dci-2→bdr-5,6；dci-3→bdr-1,2）：環繞多台而非成對回彈 */
    [1, 2, 3].forEach(function (j: any) {
      var t1 = (j * 2 + 1) > 6 ? (j * 2 + 1) - 6 : (j * 2 + 1);
      var t2 = (j * 2 + 2) > 6 ? (j * 2 + 2) - 6 : (j * 2 + 2);
      add('dci-' + j, 'et-9/0/1', 'bdr-' + t1, 'et-1/1/1', G(1));
      add('dci-' + j, 'et-9/0/2', 'bdr-' + t2, 'et-1/1/1', G(1));
    });
    ([[1, [[1, 4], [2, 4]]], [2, [[2, 2], [3, 6]]], [3, [[1, 2], [4, 6]]]] as [number, number[][]][]).forEach(function (s: any) {
      s[1].forEach(function (o: any) { add('spn-' + s[0], 'et-3/0/' + o[0], 'tor-' + o[0], 'et-0/0/' + s[0], G(o[1])); });
    });
    [1, 2, 3, 4].forEach(function (k: any) { add('tor-' + k, 'xe-0/0/10', 'srv-' + k, 'eno1', G(6)); });
    return {
      key: 'dci-uturn',
      name: '跨層回頭（bdr→dci→bdr）',
      desc: 'bdr 出去 dci 又繞回 bdr，跟主流向（bdr→spn→tor）繞成環。' +
        'dci 與 spn 同 tier 鎖同欄，多數決排欄後 6 條 dci→bdr 畫成走廊內的玫瑰色回流帶。',
      json: {
        kind: 'destination',
        investigation: {
          node_id: 'core-1', iface: 'et-0/0/0', delta_bps: G(24), direction: 'in',
          note: 'core 進來 +24 Gbps，部分流量經 dci 繞回 bdr 再下去'
        },
        elements: { nodes: nodes, edges: edges }
      }
    };
  })(),

  {
    key: 'client',
    name: '無鄰居 port 的 client',
    desc: '追到 access port 就沒有 LLDP 鄰居了。後端改用 ARP／MAC table／DHCP／CMDB 查出這個 port 上掛了誰，' +
      '寫成 nodes[].data.clients；一個 port 一張葉卡（量測不到 per-client 流量，不做攤分），卡上列 IP／hostname／owner。' +
      '再依 owner 聚合出一欄 owner 卡：整張卡只有這一個 owner 才把量帶過去，port 上還有別人（或查不到' +
      ' owner）的機器時量停在 port、只畫灰虛線的歸屬線。一個 owner 都查不到的 port 不接 owner 層。' +
      '最後一張是沒有 clients 的對照組。',
    json: {
      kind: 'destination',
      investigation: {
        node_id: 'sw-tor-1', iface: 'et-0/0/49', delta_bps: G(50), direction: 'in',
        note: 'ToR 1 的 uplink 進來 +50 Gbps，往下的 access port 多半沒有 LLDP 鄰居'
      },
      elements: {
        nodes: [
          N('sw-tor-1', 'switch', 'ToR 1'),
          /* 單一 client、三個欄位齊全：節點沒給 name，標題用 client 的 hostname */
          N('sw-tor-1:xe-0/0/12', 'host', null, {
            clients: [{ ip: '10.42.7.31', hostname: 'lab-gpu-01', owner: '網管部 王小明' }]
          }),
          /* 只有 IP：卡上一行、沒有 owner 行；帶 ns 色條驗證色條跟著卡長高 */
          N('sw-tor-1:xe-0/0/13', 'host', null, {
            labels: { namespace: 'lab' },
            clients: [{ ip: '10.42.7.32' }]
          }),
          /* 多個 client：卡上只印前兩筆＋「還有 N 個…」，完整清單在 tooltip。
             最後一筆只有 owner，認不出是哪台機器，靜默丟棄（所以是 3 個不是 4 個）。 */
          N('sw-tor-1:xe-0/0/14', 'host', '未管理小 switch', {
            clients: [
              { ip: '10.42.7.41', hostname: 'ipphone-3f-07', owner: '總務處 李美華' },
              { ip: '10.42.7.42', hostname: 'desk-pc-3f-07' },
              { hostname: 'desk-nas-3f-07', owner: '總務處 李美華' },
              { owner: '沒有 ip 也沒有 hostname，這筆會被靜默丟棄' }
            ]
          }),
          /* 超長 hostname／owner：驗卡面截斷（完整值仍在 tooltip）；status 外框色仍優先 */
          N('sw-tor-1:xe-0/0/15', 'host', null, {
            status: 'warning',
            clients: [{
              ip: '10.42.7.51',
              hostname: 'lab-workstation-rendering-farm-node-42.corp.example.internal',
              owner: '研究發展二部 平台工程組 陳大文（分機 4721）'
            }]
          }),
          /* 六台：驗證卡面列出全部（不再截成「還有 N 個…」），並混一筆只有 IP、一筆只有 hostname */
          N('sw-tor-1:xe-0/0/17', 'host', null, {
            clients: [
              { ip: '10.42.9.11', hostname: 'wsA-3f-01', owner: '設計部 張三' },
              { ip: '10.42.9.12', hostname: 'wsA-3f-02', owner: '設計部 李四' },
              { ip: '10.42.9.13', hostname: 'wsA-3f-03' },
              { ip: '10.42.9.14' },
              { hostname: 'printer-3f', owner: '總務處 李美華' },
              { ip: '10.42.9.16', hostname: 'ap-3f-north', owner: '網管部 王小明' }
            ]
          }),
          /* 都沒有 owner：驗證 owner 欄整欄不畫、卡跟著變窄 */
          N('sw-tor-1:xe-0/0/18', 'host', null, {
            clients: [
              { ip: '10.42.9.21', hostname: 'cam-lobby-01' },
              { ip: '10.42.9.22', hostname: 'cam-lobby-02' }
            ]
          }),
          /* 對照組：沒有 clients 的葉，外觀與舊版逐 byte 相同 */
          N('srv-legacy-09', 'host')
        ],
        edges: [
          E('c1', 'sw-tor-1', 'xe-0/0/12', 'sw-tor-1:xe-0/0/12', '', G(12)),
          E('c2', 'sw-tor-1', 'xe-0/0/13', 'sw-tor-1:xe-0/0/13', '', G(8)),
          E('c3', 'sw-tor-1', 'xe-0/0/14', 'sw-tor-1:xe-0/0/14', '', G(10)),
          E('c4', 'sw-tor-1', 'xe-0/0/15', 'sw-tor-1:xe-0/0/15', '', G(6)),
          E('c5', 'sw-tor-1', 'xe-0/0/16', 'srv-legacy-09', 'eno1', G(4)),
          E('c6', 'sw-tor-1', 'xe-0/0/17', 'sw-tor-1:xe-0/0/17', '', G(7)),
          E('c7', 'sw-tor-1', 'xe-0/0/18', 'sw-tor-1:xe-0/0/18', '', G(3))
        ]
      }
    }
  },

  {
    key: 'storage',
    name: 'NetApp → aggr → SVM → PVC → pod → app → NS',
    desc: '參考面板（kube-state-graph-frontend）的 demo fixture 原封不動：storage-flow 邊的 read／write 各一條帶、' +
      'status 外框色、usage 副標、FlexGroup 從 SVM 起頭、split 歸因、未排程 pod、沒有 application 的 pod 直接接 namespace。' +
      '沒有 investigation，所以沒有錨卡；netapp-node 是源頭，不補其他輸入。',
    /* 來源：https://github.com/akira-core/kube-state-graph-frontend
       public/demo/storage-graph.json @ 9e568c784b2ecb5ce87b201c73989fb21cb88c56（Apache-2.0）。
       samples/storage.json 是同一份檔案；改一邊記得改另一邊。 */
    json: {
      apiVersion: 'v1',
      clusters: ['prod'],
      elements: {
        nodes: [
          {
            data: { id: 'storage-cluster/ontap-prod', name: 'ontap-prod', type: 'storage-cluster' }
          },
          {
            data: {
              id: 'netapp/ontap-prod/ontap-prod-01',
              status: 'normal',
              name: 'ontap-prod-01',
              type: 'netapp-node',
              parent: 'storage-cluster/ontap-prod',
              health: 'online',
              hardware: { model: 'AFF-A400', vendor: 'NetApp' },
              labels: { ontap_cluster: 'ontap-prod' }
            }
          },
          {
            data: {
              id: 'netapp/ontap-prod/ontap-prod-02',
              status: 'critical',
              name: 'ontap-prod-02',
              type: 'netapp-node',
              parent: 'storage-cluster/ontap-prod',
              health: 'degraded',
              hardware: { model: 'AFF-A400' },
              perf: { cpu_busy_pct: 41.2, total_ops: 18200, total_latency_us: 640, total_bytes_per_sec: 5767168 },
              alerts: [
                { name: 'NodeDegraded', severity: 'warning', time: 1748692200 },
                { name: 'NetAppControllerDegraded', state: 'firing', severity: 'critical' }
              ],
              labels: { ontap_cluster: 'ontap-prod' }
            }
          },
          {
            data: {
              id: 'netapp/ontap-prod/aggr/aggr1',
              status: 'warning',
              name: 'aggr1',
              type: 'netapp-aggr',
              parent: 'netapp/ontap-prod/ontap-prod-01',
              health: 'online',
              usage: { used_bytes: 700000000000, capacity_bytes: 1000000000000 },
              alerts: [
                { name: 'AggrFilling', state: 'firing' }
              ],
              labels: { ontap_cluster: 'ontap-prod', node: 'ontap-prod-01' }
            }
          },
          {
            data: {
              id: 'netapp/ontap-prod/aggr/aggr2',
              status: 'normal',
              name: 'aggr2',
              type: 'netapp-aggr',
              parent: 'netapp/ontap-prod/ontap-prod-02',
              health: 'online',
              usage: { used_bytes: 400000000000, capacity_bytes: 2000000000000 },
              labels: { ontap_cluster: 'ontap-prod', node: 'ontap-prod-02' }
            }
          },
          {
            data: {
              id: 'netapp/ontap-prod/svm/svm_shop',
              name: 'svm_shop',
              type: 'netapp-svm',
              parent: 'storage-cluster/ontap-prod',
              labels: { ontap_cluster: 'ontap-prod' }
            }
          },
          {
            data: {
              id: 'netapp/ontap-prod/svm/svm_dr',
              name: 'svm_dr',
              type: 'netapp-svm',
              parent: 'storage-cluster/ontap-prod',
              labels: { ontap_cluster: 'ontap-prod' }
            }
          },
          {
            data: { id: 'cluster/prod', name: 'prod', type: 'cluster' }
          },
          {
            data: { id: 'prod/ns/prod', name: 'prod', type: 'namespace', parent: 'cluster/prod' }
          },
          {
            data: { id: 'prod/app/mongodb', name: 'mongodb', type: 'application', parent: 'prod/ns/prod' }
          },
          {
            data: { id: 'prod/ctrl/StatefulSet/mongodb', name: 'mongodb', type: 'controller', parent: 'prod/app/mongodb' }
          },
          {
            data: { id: 'prod/ctrl/Job/batch', name: 'batch', type: 'controller', parent: 'prod/ns/prod' }
          },
          {
            data: {
              id: 'node/worker-0',
              status: 'normal',
              name: 'worker-0',
              type: 'node',
              parent: 'cluster/prod',
              labels: { cluster: 'prod' }
            }
          },
          {
            data: {
              id: 'node/worker-1',
              status: 'warning',
              name: 'worker-1',
              type: 'node',
              parent: 'cluster/prod',
              labels: { cluster: 'prod' }
            }
          },
          {
            data: {
              id: 'pod/mongo-0',
              status: 'normal',
              name: 'mongo-0',
              type: 'pod',
              parent: 'prod/ctrl/StatefulSet/mongodb',
              labels: { namespace: 'prod', cluster: 'prod', node: 'node/worker-0' }
            }
          },
          {
            data: {
              id: 'pod/mongo-1',
              status: 'normal',
              name: 'mongo-1',
              type: 'pod',
              parent: 'prod/ctrl/StatefulSet/mongodb',
              labels: { namespace: 'prod', cluster: 'prod', node: 'node/worker-1' }
            }
          },
          {
            data: {
              id: 'pvc/data-mongo-0',
              status: 'normal',
              name: 'data-mongo-0',
              type: 'pvc',
              parent: 'prod/app/mongodb',
              storageclass: 'netapp-nas',
              usage: { used_bytes: 7516192768, capacity_bytes: 10737418240 },
              labels: { namespace: 'prod', volumename: 'pvc-9f3a1b2c', svm: 'svm_shop' }
            }
          },
          {
            data: {
              id: 'pvc/data-mongo-1',
              status: 'normal',
              name: 'data-mongo-1',
              type: 'pvc',
              parent: 'prod/app/mongodb',
              storageclass: 'netapp-nas',
              usage: { used_bytes: 2147483648, capacity_bytes: 10737418240 },
              labels: { namespace: 'prod', volumename: 'pvc-7e5d4c3b', svm: 'svm_dr' }
            }
          },
          {
            data: {
              id: 'pvc/data-scratch',
              status: 'normal',
              name: 'data-scratch',
              type: 'pvc',
              parent: 'prod/app/mongodb',
              storageclass: 'netapp-nas',
              labels: { namespace: 'prod', volumename: 'pvc-scratch', svm: 'svm_shop' }
            }
          },
          {
            data: {
              id: 'netapp/ontap-prod/svm/svm_jobs',
              name: 'svm_jobs',
              type: 'netapp-svm',
              parent: 'storage-cluster/ontap-prod',
              labels: { ontap_cluster: 'ontap-prod' }
            }
          },
          {
            data: {
              id: 'pod/orphan-0',
              status: 'normal',
              name: 'orphan-0',
              type: 'pod',
              parent: 'prod/ctrl/Job/batch',
              labels: { namespace: 'prod', cluster: 'prod', node: 'node/worker-0' }
            }
          },
          {
            data: {
              id: 'pod/batch-pending',
              status: 'warning',
              name: 'batch-pending',
              type: 'pod',
              parent: 'prod/ctrl/Job/batch',
              labels: { namespace: 'prod', cluster: 'prod' }
            }
          },
          {
            data: {
              id: 'pvc/data-orphan',
              status: 'normal',
              name: 'data-orphan',
              type: 'pvc',
              parent: 'prod/ns/prod',
              storageclass: 'netapp-nas',
              labels: { namespace: 'prod', volumename: 'pvc-orphan', svm: 'svm_jobs' }
            }
          },
          {
            data: {
              id: 'pvc/data-pending',
              status: 'normal',
              name: 'data-pending',
              type: 'pvc',
              parent: 'prod/ns/prod',
              storageclass: 'netapp-nas',
              labels: { namespace: 'prod', volumename: 'pvc-pending', svm: 'svm_jobs' }
            }
          }
        ],
        edges: [
          {
            data: {
              id: 'sf-na-1',
              type: 'storage-flow',
              source: 'netapp/ontap-prod/ontap-prod-01',
              target: 'netapp/ontap-prod/aggr/aggr1',
              labels: { tier: 'node-aggr' },
              metrics: { read_bytes_per_sec: 5505024, write_bytes_per_sec: 1048576 }
            }
          },
          {
            data: {
              id: 'sf-as-1',
              type: 'storage-flow',
              source: 'netapp/ontap-prod/aggr/aggr1',
              target: 'netapp/ontap-prod/svm/svm_shop',
              labels: { tier: 'aggr-svm' },
              metrics: { read_bytes_per_sec: 5505024, write_bytes_per_sec: 1048576 }
            }
          },
          {
            data: {
              id: 'sf-sp-1',
              type: 'storage-flow',
              source: 'netapp/ontap-prod/svm/svm_shop',
              target: 'pvc/data-mongo-0',
              labels: { tier: 'svm-pvc' },
              metrics: { read_ops: 150, write_ops: 40, read_latency_us: 830, write_latency_us: 1200, read_bytes_per_sec: 5242880, write_bytes_per_sec: 1048576, max_iops: 5000, max_bytes_per_sec: 104857600 }
            }
          },
          {
            data: {
              id: 'sf-sp-fg',
              type: 'storage-flow',
              source: 'netapp/ontap-prod/svm/svm_shop',
              target: 'pvc/data-scratch',
              labels: { tier: 'svm-pvc' },
              metrics: { read_bytes_per_sec: 262144 }
            }
          },
          {
            data: {
              id: 'sf-pp-1',
              type: 'storage-flow',
              source: 'pvc/data-mongo-0',
              target: 'pod/mongo-0',
              labels: { tier: 'pvc-pod' },
              metrics: { read_bytes_per_sec: 5242880, write_bytes_per_sec: 1048576 }
            }
          },
          {
            data: {
              id: 'sf-pp-fg-0',
              type: 'storage-flow',
              source: 'pvc/data-scratch',
              target: 'pod/mongo-0',
              labels: { tier: 'pvc-pod', attribution: 'split' },
              metrics: { read_bytes_per_sec: 131072 }
            }
          },
          {
            data: {
              id: 'sf-pp-fg-1',
              type: 'storage-flow',
              source: 'pvc/data-scratch',
              target: 'pod/mongo-1',
              labels: { tier: 'pvc-pod', attribution: 'split' },
              metrics: { read_bytes_per_sec: 131072 }
            }
          },
          {
            data: {
              id: 'sf-pn-0',
              type: 'storage-flow',
              source: 'pod/mongo-0',
              target: 'node/worker-0',
              labels: { tier: 'pod-node' },
              metrics: { read_bytes_per_sec: 5373952, write_bytes_per_sec: 1048576 }
            }
          },
          {
            data: {
              id: 'sf-na-2',
              type: 'storage-flow',
              source: 'netapp/ontap-prod/ontap-prod-02',
              target: 'netapp/ontap-prod/aggr/aggr2',
              labels: { tier: 'node-aggr' },
              metrics: { read_bytes_per_sec: 262144, write_bytes_per_sec: 49152 }
            }
          },
          {
            data: {
              id: 'sf-as-2',
              type: 'storage-flow',
              source: 'netapp/ontap-prod/aggr/aggr2',
              target: 'netapp/ontap-prod/svm/svm_dr',
              labels: { tier: 'aggr-svm' },
              metrics: { read_bytes_per_sec: 262144, write_bytes_per_sec: 49152 }
            }
          },
          {
            data: {
              id: 'sf-sp-2',
              type: 'storage-flow',
              source: 'netapp/ontap-prod/svm/svm_dr',
              target: 'pvc/data-mongo-1',
              labels: { tier: 'svm-pvc' },
              metrics: { read_bytes_per_sec: 262144, write_bytes_per_sec: 49152 }
            }
          },
          {
            data: {
              id: 'sf-pp-2',
              type: 'storage-flow',
              source: 'pvc/data-mongo-1',
              target: 'pod/mongo-1',
              labels: { tier: 'pvc-pod' },
              metrics: { read_bytes_per_sec: 262144, write_bytes_per_sec: 49152 }
            }
          },
          {
            data: {
              id: 'sf-pn-1',
              type: 'storage-flow',
              source: 'pod/mongo-1',
              target: 'node/worker-1',
              labels: { tier: 'pod-node' },
              metrics: { read_bytes_per_sec: 393216, write_bytes_per_sec: 49152 }
            }
          },
          {
            data: {
              id: 'sf-sp-orphan',
              type: 'storage-flow',
              source: 'netapp/ontap-prod/svm/svm_jobs',
              target: 'pvc/data-orphan',
              labels: { tier: 'svm-pvc' },
              metrics: { read_bytes_per_sec: 8192 }
            }
          },
          {
            data: {
              id: 'sf-pp-orphan',
              type: 'storage-flow',
              source: 'pvc/data-orphan',
              target: 'pod/orphan-0',
              labels: { tier: 'pvc-pod' },
              metrics: { read_bytes_per_sec: 8192 }
            }
          },
          {
            data: {
              id: 'sf-pn-orphan',
              type: 'storage-flow',
              source: 'pod/orphan-0',
              target: 'node/worker-0',
              labels: { tier: 'pod-node' },
              metrics: { read_bytes_per_sec: 8192 }
            }
          },
          {
            data: {
              id: 'sf-sp-pending',
              type: 'storage-flow',
              source: 'netapp/ontap-prod/svm/svm_jobs',
              target: 'pvc/data-pending',
              labels: { tier: 'svm-pvc' },
              metrics: { read_bytes_per_sec: 4096 }
            }
          },
          {
            data: {
              id: 'sf-pp-pending',
              type: 'storage-flow',
              source: 'pvc/data-pending',
              target: 'pod/batch-pending',
              labels: { tier: 'pvc-pod' },
              metrics: { read_bytes_per_sec: 4096 }
            }
          }
        ]
      }
    }
  }
];

var byKey: Record<string, TraceSample> = {};
SAMPLES.forEach(function (s: any) { byKey[s.key] = s; });

var defaultKey = 'classic';

export { SAMPLES as list, byKey, defaultKey };
