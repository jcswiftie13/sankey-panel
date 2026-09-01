/* 範例追查 JSON。純資料，不抓 counter、不掃網。 */
var G = function (n) { return Math.round(n * 1e9); };

var SAMPLES = [
  {
    key: 'classic',
    name: '經典不守恆',
    desc: 'A→B 10G 進來，B→C 出去 20G。多出來的 10G 是 B 的其他輸入，不是 B 生的。',
    json: {
      kind: 'destination',
      investigation: {
        switchId: 'sw-edge-a', iface: 'xe-0/0/1', direction: 'in', deltaBps: G(10),
        note: 'Edge A 的 access port 進來 +10 Gbps'
      },
      pruning: { topN: 3, minShare: 0.10 },
      hops: [
        {
          switchId: 'sw-edge-a', label: 'Edge A', role: 'switch',
          outputs: [
            { iface: 'et-0/0/48', deltaBps: G(20), peerKind: 'switch', peerSwitchId: 'sw-core-1', peerIface: 'et-1/0/1' }
          ]
        },
        {
          switchId: 'sw-core-1', label: 'Core 1', role: 'switch',
          outputs: [
            { iface: 'et-1/0/9', deltaBps: G(20), peerKind: 'host', peerId: 'srv-db-07', peerIface: 'eno1' }
          ]
        }
      ]
    }
  },

  {
    key: 'dual-uplink',
    name: '雙 uplink',
    desc: '同一台 core 在 hops 出現兩次（兩條 uplink 匯入），要合併成一個盒子，不是兩台。',
    json: {
      kind: 'destination',
      investigation: { switchId: 'sw-edge-a', iface: 'xe-0/0/1', direction: 'in', deltaBps: G(10) },
      pruning: { topN: 3, minShare: 0.10 },
      hops: [
        {
          switchId: 'sw-edge-a', label: 'Edge A', role: 'switch',
          outputs: [
            { iface: 'et-0/0/48', deltaBps: G(6), peerKind: 'switch', peerSwitchId: 'sw-core-1', peerIface: 'et-1/0/1' },
            { iface: 'et-0/0/49', deltaBps: G(4), peerKind: 'switch', peerSwitchId: 'sw-core-1', peerIface: 'et-1/0/2' }
          ]
        },
        {
          switchId: 'sw-core-1', label: 'Core 1', role: 'switch',
          outputs: [
            { iface: 'et-1/0/24', deltaBps: G(9), peerKind: 'switch', peerSwitchId: 'sw-agg-9', peerIface: 'et-9/0/1' }
          ]
        },
        {
          switchId: 'sw-core-1', label: 'Core 1', role: 'switch',
          outputs: [
            { iface: 'et-1/0/24', deltaBps: G(7), peerKind: 'switch', peerSwitchId: 'sw-agg-9', peerIface: 'et-9/0/1' }
          ]
        },
        {
          switchId: 'sw-agg-9', label: 'Agg 9', role: 'switch',
          outputs: [
            { iface: 'xe-9/0/12', deltaBps: G(11), peerKind: 'host', peerId: 'srv-cache-02', peerIface: 'bond0' },
            { iface: 'xe-9/0/13', deltaBps: G(5), peerKind: 'host', peerId: 'srv-cache-03', peerIface: 'bond0' }
          ]
        }
      ]
    }
  },

  {
    key: 'campus',
    name: '校園骨幹',
    desc: '宿網 → 匯聚 → 核心 → 出口／機房。每層都有沒追的上聯與沒跟的出口。',
    json: {
      kind: 'destination',
      investigation: {
        switchId: 'sw-dorm-b3', iface: 'ae0', direction: 'in', deltaBps: G(8),
        note: '宿舍 B3 上聯 ae0 進向 +8 Gbps'
      },
      pruning: { topN: 3, minShare: 0.10 },
      hops: [
        {
          switchId: 'sw-dorm-b3', label: '宿網 B3', role: 'switch',
          outputs: [
            { iface: 'et-0/0/50', deltaBps: G(22), peerKind: 'switch', peerSwitchId: 'sw-agg-dorm', peerIface: 'et-2/0/3' }
          ]
        },
        {
          switchId: 'sw-agg-dorm', label: '宿區匯聚', role: 'switch',
          outputs: [
            { iface: 'ae10', deltaBps: G(18), peerKind: 'switch', peerSwitchId: 'sw-core-n', peerIface: 'ae1' },
            { iface: 'xe-2/0/7', deltaBps: G(6), peerKind: 'switch', peerSwitchId: 'fw-campus', peerIface: 'xe-0/0/0' }
          ]
        },
        {
          switchId: 'sw-core-n', label: '核心 North', role: 'switch',
          outputs: [
            { iface: 'et-0/0/1', deltaBps: G(12), peerKind: 'router', peerId: 'rtr-tanet', peerIface: 'Te0/1/0' },
            { iface: 'et-0/0/2', deltaBps: G(4), peerKind: 'switch', peerSwitchId: 'sw-dc-spine', peerIface: 'et-1/1/1' }
          ]
        },
        {
          switchId: 'fw-campus', label: '校園防火牆', role: 'switch',
          outputs: [
            { iface: 'xe-0/0/1', deltaBps: G(6), peerKind: 'router', peerId: 'rtr-tanet', peerIface: 'Te0/1/1' }
          ]
        },
        {
          switchId: 'sw-dc-spine', label: '機房 Spine', role: 'switch',
          outputs: [
            { iface: 'et-1/1/9', deltaBps: G(4), peerKind: 'host', peerId: 'srv-nas-01', peerIface: 'ens5f0' }
          ]
        }
      ]
    }
  },

  {
    key: 'pruned',
    name: '截斷殘差',
    desc: '這層有 9 個 port 在漲，只跟前 3 名（≥10%）。沒跟的併成其他輸出，用等比的虛線色塊貼在右邊。',
    json: {
      kind: 'destination',
      investigation: { switchId: 'sw-tor-14', iface: 'et-0/0/52', direction: 'in', deltaBps: G(40) },
      pruning: { topN: 3, minShare: 0.10 },
      hops: [
        {
          switchId: 'sw-tor-14', label: 'ToR 14', role: 'switch',
          otherOutBps: G(9),
          outputs: [
            { iface: 'xe-0/0/1', deltaBps: G(18), peerKind: 'switch', peerSwitchId: 'sw-leaf-3', peerIface: 'et-3/0/1' },
            { iface: 'xe-0/0/2', deltaBps: G(9), peerKind: 'host', peerId: 'srv-app-11', peerIface: 'eno2' },
            { iface: 'xe-0/0/3', deltaBps: G(6), peerKind: 'host', peerId: 'srv-app-12', peerIface: 'eno2' }
          ]
        },
        {
          switchId: 'sw-leaf-3', label: 'Leaf 3', role: 'switch',
          otherOutBps: G(3),
          outputs: [
            { iface: 'xe-3/0/8', deltaBps: G(10), peerKind: 'host', peerId: 'srv-log-01', peerIface: 'bond0' },
            { iface: 'xe-3/0/9', deltaBps: G(5), peerKind: 'host', peerId: 'srv-log-02', peerIface: 'bond0' }
          ]
        }
      ]
    }
  },

  {
    key: 'source',
    name: '追來源',
    desc: '看到某條 out 增加，往回追貢獻大的 in。起點釘在最右，封包方向照樣左到右。',
    json: {
      kind: 'source',
      investigation: {
        switchId: 'sw-core-1', iface: 'et-1/0/9', direction: 'out', deltaBps: G(20),
        note: 'Core 1 出向 et-1/0/9 +20 Gbps，問誰灌的'
      },
      pruning: { topN: 3, minShare: 0.10 },
      hops: [
        {
          switchId: 'sw-core-1', label: 'Core 1', role: 'switch',
          inputs: [
            { iface: 'et-1/0/1', deltaBps: G(12), peerKind: 'switch', peerSwitchId: 'sw-edge-a', peerIface: 'et-0/0/48' },
            { iface: 'et-1/0/2', deltaBps: G(6), peerKind: 'switch', peerSwitchId: 'sw-edge-b', peerIface: 'et-0/0/48' }
          ]
        },
        {
          switchId: 'sw-edge-a', label: 'Edge A', role: 'switch',
          inputs: [
            { iface: 'xe-0/0/1', deltaBps: G(7), peerKind: 'host', peerId: 'lab-gpu-01', peerIface: 'eno1' },
            { iface: 'xe-0/0/2', deltaBps: G(3), peerKind: 'host', peerId: 'lab-gpu-02', peerIface: 'eno1' }
          ]
        },
        {
          switchId: 'sw-edge-b', label: 'Edge B', role: 'switch',
          otherInBps: G(2),
          inputs: [
            { iface: 'xe-0/0/5', deltaBps: G(4), peerKind: 'host', peerId: 'backup-relay', peerIface: 'eth0' }
          ]
        }
      ]
    }
  },

  {
    key: 'k8s',
    name: 'Switch → Node → Pod → NS',
    desc: '同一條 Sankey 接下去。node 是虛線盒、pod 是中繼小卡，流量匯進 namespace 終點——' +
      'telemetry 跨兩台 node 的 pod 合進同一個 ns 節點。k8s hop 的 port 可省略 iface；' +
      'node 也能當葉（沒列 pod 就整台補成其他輸出）。',
    json: {
      kind: 'destination',
      investigation: { switchId: 'sw-tor-k8s', iface: 'et-0/0/48', direction: 'in', deltaBps: G(30) },
      pruning: { topN: 3, minShare: 0.10 },
      hops: [
        {
          switchId: 'sw-tor-k8s', label: 'ToR k8s', role: 'switch',
          outputs: [
            { iface: 'xe-0/0/11', deltaBps: G(14), peerKind: 'node', peerSwitchId: 'node-w-11', peerIface: 'bond0' },
            { iface: 'xe-0/0/12', deltaBps: G(8), peerKind: 'node', peerSwitchId: 'node-w-12', peerIface: 'bond0' },
            { iface: 'xe-0/0/13', deltaBps: G(5), peerKind: 'node', peerSwitchId: 'node-w-13', peerIface: 'bond0' },
            { iface: 'xe-0/0/20', deltaBps: G(3), peerKind: 'host', peerId: 'srv-log-01', peerIface: 'eno1' }
          ]
        },
        {
          switchId: 'node-w-11', label: 'node-w-11', role: 'node',
          otherOutBps: G(2.5),
          outputs: [
            { iface: 'veth3a1f', deltaBps: G(8), peerKind: 'pod', peerId: 'ingest-7d9c', namespace: 'telemetry' },
            { iface: 'veth9b02', deltaBps: G(3.5), peerKind: 'pod', peerId: 'kafka-2', namespace: 'stream' }
          ]
        },
        {
          /* k8s node 的 port 沒有 switch iface：iface 省略，靠 peerId 認 port */
          switchId: 'node-w-12', label: 'node-w-12', role: 'node',
          outputs: [
            { deltaBps: G(5.5), peerKind: 'pod', peerId: 'ingest-4f11', namespace: 'telemetry' },
            { deltaBps: G(2.5), peerKind: 'pod', peerId: 'debug-shell', namespace: 'debug' }
          ]
        },
        /* node 當葉：沒列 pod，進來的 5G 由平衡式補成其他輸出 */
        { switchId: 'node-w-13', label: 'node-w-13', role: 'node' }
      ]
    }
  },

  {
    key: 'k8s-source',
    name: 'NS → Pod → Node → Switch（追來源）',
    desc: '追來源方向的 k8s：namespace 終點在最左欄，batch 兩個 pod 跨 node 匯進同一個 ns；' +
      'node-w-21 的 port 全省略 iface。',
    json: {
      kind: 'source',
      investigation: {
        switchId: 'sw-tor-k8s', iface: 'et-0/0/48', direction: 'out', deltaBps: G(18),
        note: 'ToR uplink 出量 +18G，追是哪些 pod 打出來的'
      },
      hops: [
        {
          switchId: 'sw-tor-k8s', label: 'ToR k8s', role: 'switch',
          inputs: [
            { iface: 'xe-0/0/21', deltaBps: G(12), peerKind: 'node', peerSwitchId: 'node-w-21', peerIface: 'bond0' },
            { iface: 'xe-0/0/22', deltaBps: G(6), peerKind: 'node', peerSwitchId: 'node-w-22', peerIface: 'bond0' }
          ]
        },
        {
          switchId: 'node-w-21', label: 'node-w-21', role: 'node',
          inputs: [
            { deltaBps: G(7), peerKind: 'pod', peerId: 'web-6f8d', namespace: 'frontend' },
            { deltaBps: G(3), peerKind: 'pod', peerId: 'cache-1', namespace: 'frontend' },
            { deltaBps: G(2), peerKind: 'pod', peerId: 'batch-9k', namespace: 'batch' }
          ]
        },
        {
          switchId: 'node-w-22', label: 'node-w-22', role: 'node',
          inputs: [
            { iface: 'veth71aa', deltaBps: G(6), peerKind: 'pod', peerId: 'job-runner-5c', namespace: 'batch' }
          ]
        }
      ]
    }
  },

  {
    key: 'dci-tier',
    name: '同層互連（tier）',
    desc: 'bdr 與 dci 實際是同一層。不標 tier 時 bdr↔dci 互連會把 bdr 拆成兩欄；' +
      '同層的 hop 都標 tier: "border" 就鎖在同一欄，互連畫成右側弧帶。',
    json: {
      kind: 'destination',
      investigation: {
        switchId: 'core-1', iface: 'et-0/0/0', direction: 'in', deltaBps: G(24),
        note: 'core 進來 +24 Gbps，跨 DC 流量經 dci 繞回同層 bdr'
      },
      hops: [
        {
          switchId: 'core-1', label: 'Core', role: 'switch',
          outputs: [
            { iface: 'et-0/0/1', deltaBps: G(4), peerKind: 'switch', peerSwitchId: 'bdr-1', peerIface: 'et-1/0/1' },
            { iface: 'et-0/0/2', deltaBps: G(4), peerKind: 'switch', peerSwitchId: 'bdr-2', peerIface: 'et-1/0/1' },
            { iface: 'et-0/0/3', deltaBps: G(4), peerKind: 'switch', peerSwitchId: 'bdr-3', peerIface: 'et-1/0/1' },
            { iface: 'et-0/0/4', deltaBps: G(4), peerKind: 'switch', peerSwitchId: 'bdr-4', peerIface: 'et-1/0/1' },
            { iface: 'et-0/0/5', deltaBps: G(4), peerKind: 'switch', peerSwitchId: 'bdr-5', peerIface: 'et-1/0/1' },
            { iface: 'et-0/0/6', deltaBps: G(4), peerKind: 'switch', peerSwitchId: 'bdr-6', peerIface: 'et-1/0/1' }
          ]
        },
        {
          switchId: 'bdr-1', label: 'BDR 1', role: 'switch', tier: 'border',
          outputs: [
            { iface: 'et-1/1/1', deltaBps: G(1), peerKind: 'switch', peerSwitchId: 'dci-1', peerIface: 'ae0' },
            { iface: 'et-1/1/2', deltaBps: G(1), peerKind: 'switch', peerSwitchId: 'dci-2', peerIface: 'ae0' },
            { iface: 'et-1/2/1', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'spn-1', peerIface: 'et-2/0/1' }
          ]
        },
        {
          switchId: 'bdr-2', label: 'BDR 2', role: 'switch', tier: 'border',
          outputs: [
            { iface: 'et-1/1/1', deltaBps: G(1), peerKind: 'switch', peerSwitchId: 'dci-1', peerIface: 'ae0' },
            { iface: 'et-1/1/2', deltaBps: G(1), peerKind: 'switch', peerSwitchId: 'dci-2', peerIface: 'ae0' },
            { iface: 'et-1/2/1', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'spn-2', peerIface: 'et-2/0/2' }
          ]
        },
        {
          switchId: 'bdr-3', label: 'BDR 3', role: 'switch', tier: 'border',
          outputs: [
            { iface: 'et-1/1/1', deltaBps: G(1), peerKind: 'switch', peerSwitchId: 'dci-1', peerIface: 'ae0' },
            { iface: 'et-1/1/2', deltaBps: G(1), peerKind: 'switch', peerSwitchId: 'dci-2', peerIface: 'ae0' },
            { iface: 'et-1/2/1', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'spn-3', peerIface: 'et-2/0/3' }
          ]
        },
        {
          switchId: 'dci-1', label: 'DCI 1', role: 'switch', tier: 'border',
          outputs: [
            { iface: 'et-9/0/1', deltaBps: G(1), peerKind: 'switch', peerSwitchId: 'bdr-4', peerIface: 'et-1/0/2' },
            { iface: 'et-9/0/2', deltaBps: G(1), peerKind: 'switch', peerSwitchId: 'bdr-5', peerIface: 'et-1/0/2' },
            { iface: 'et-9/0/3', deltaBps: G(1), peerKind: 'switch', peerSwitchId: 'bdr-6', peerIface: 'et-1/0/2' }
          ]
        },
        {
          switchId: 'dci-2', label: 'DCI 2', role: 'switch', tier: 'border',
          outputs: [
            { iface: 'et-9/0/1', deltaBps: G(1), peerKind: 'switch', peerSwitchId: 'bdr-4', peerIface: 'et-1/0/3' },
            { iface: 'et-9/0/2', deltaBps: G(1), peerKind: 'switch', peerSwitchId: 'bdr-5', peerIface: 'et-1/0/3' },
            { iface: 'et-9/0/3', deltaBps: G(1), peerKind: 'switch', peerSwitchId: 'bdr-6', peerIface: 'et-1/0/3' }
          ]
        },
        {
          switchId: 'bdr-4', label: 'BDR 4', role: 'switch', tier: 'border',
          outputs: [
            { iface: 'et-1/2/1', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'spn-1', peerIface: 'et-2/0/4' },
            { iface: 'et-1/2/2', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'spn-2', peerIface: 'et-2/0/4' },
            { iface: 'et-1/2/3', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'spn-3', peerIface: 'et-2/0/4' }
          ]
        },
        {
          switchId: 'bdr-5', label: 'BDR 5', role: 'switch', tier: 'border',
          outputs: [
            { iface: 'et-1/2/1', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'spn-1', peerIface: 'et-2/0/5' },
            { iface: 'et-1/2/2', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'spn-2', peerIface: 'et-2/0/5' },
            { iface: 'et-1/2/3', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'spn-3', peerIface: 'et-2/0/5' }
          ]
        },
        {
          switchId: 'bdr-6', label: 'BDR 6', role: 'switch', tier: 'border',
          outputs: [
            { iface: 'et-1/2/1', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'spn-1', peerIface: 'et-2/0/6' },
            { iface: 'et-1/2/2', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'spn-2', peerIface: 'et-2/0/6' },
            { iface: 'et-1/2/3', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'spn-3', peerIface: 'et-2/0/6' }
          ]
        },
        {
          switchId: 'spn-1', label: 'SPN 1', role: 'switch',
          outputs: [
            { iface: 'et-2/1/1', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'tor-1', peerIface: 'et-3/0/1' },
            { iface: 'et-2/1/2', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'tor-2', peerIface: 'et-3/0/1' },
            { iface: 'et-2/1/3', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'tor-3', peerIface: 'et-3/0/1' },
            { iface: 'et-2/1/4', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'tor-4', peerIface: 'et-3/0/1' }
          ]
        },
        {
          switchId: 'spn-2', label: 'SPN 2', role: 'switch',
          outputs: [
            { iface: 'et-2/1/1', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'tor-1', peerIface: 'et-3/0/2' },
            { iface: 'et-2/1/2', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'tor-2', peerIface: 'et-3/0/2' },
            { iface: 'et-2/1/3', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'tor-3', peerIface: 'et-3/0/2' },
            { iface: 'et-2/1/4', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'tor-4', peerIface: 'et-3/0/2' }
          ]
        },
        {
          switchId: 'spn-3', label: 'SPN 3', role: 'switch',
          outputs: [
            { iface: 'et-2/1/1', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'tor-1', peerIface: 'et-3/0/3' },
            { iface: 'et-2/1/2', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'tor-2', peerIface: 'et-3/0/3' },
            { iface: 'et-2/1/3', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'tor-3', peerIface: 'et-3/0/3' },
            { iface: 'et-2/1/4', deltaBps: G(2), peerKind: 'switch', peerSwitchId: 'tor-4', peerIface: 'et-3/0/3' }
          ]
        },
        {
          switchId: 'tor-1', label: 'ToR 1', role: 'switch',
          outputs: [
            { iface: 'xe-3/0/10', deltaBps: G(6), peerKind: 'host', peerId: 'srv-a-01', peerIface: 'eno1' }
          ]
        },
        {
          switchId: 'tor-2', label: 'ToR 2', role: 'switch',
          outputs: [
            { iface: 'xe-3/0/10', deltaBps: G(6), peerKind: 'host', peerId: 'srv-a-02', peerIface: 'eno1' }
          ]
        },
        {
          switchId: 'tor-3', label: 'ToR 3', role: 'switch',
          outputs: [
            { iface: 'xe-3/0/10', deltaBps: G(6), peerKind: 'host', peerId: 'srv-a-03', peerIface: 'eno1' }
          ]
        },
        {
          switchId: 'tor-4', label: 'ToR 4', role: 'switch',
          outputs: [
            { iface: 'xe-3/0/10', deltaBps: G(6), peerKind: 'host', peerId: 'srv-a-04', peerIface: 'eno1' }
          ]
        }
      ]
    }
  },
  (function () {
    /* 跨層回頭：core → bdr → dci → bdr、core → bdr → spn → tor。
       bdr 全同 tier；dci 與 spn 同 tier；tor 同 tier。dci 只回打 bdr，
       跟 bdr→dci/spn 的主流向繞成環 → 多數決排欄，6 條 dci→bdr 畫成回流帶。
       數字全守恆：每台 bdr in = 4G(core)+1G(dci 回打) = out = 1G(dci)+4G(spn)。 */
    var hops = [{
      switchId: 'core-1', label: 'Core 1', role: 'core',
      outputs: [1, 2, 3, 4, 5, 6].map(function (i) {
        return { iface: 'et-0/0/' + i, deltaBps: G(4), peerKind: 'switch', peerSwitchId: 'bdr-' + i, peerIface: 'et-1/0/1' };
      })
    }];
    var pair = function (i) { return Math.ceil(i / 2); };        /* bdr-1,2→dci-1/spn-1 … */
    [1, 2, 3, 4, 5, 6].forEach(function (i) {
      hops.push({
        switchId: 'bdr-' + i, label: 'BDR ' + i, role: 'border', tier: 'bdr',
        outputs: [
          { iface: 'et-2/0/1', deltaBps: G(1), peerKind: 'switch', peerSwitchId: 'dci-' + pair(i), peerIface: 'ae0' },
          { iface: 'et-2/0/2', deltaBps: G(4), peerKind: 'switch', peerSwitchId: 'spn-' + pair(i), peerIface: 'et-0/0/' + i }
        ]
      });
    });
    /* dci 回打錯開（dci-1→bdr-3,4；dci-2→bdr-5,6；dci-3→bdr-1,2）：環繞多台而非成對回彈 */
    [1, 2, 3].forEach(function (j) {
      var t1 = (j * 2 + 1) > 6 ? (j * 2 + 1) - 6 : (j * 2 + 1);
      var t2 = (j * 2 + 2) > 6 ? (j * 2 + 2) - 6 : (j * 2 + 2);
      hops.push({
        switchId: 'dci-' + j, label: 'DCI ' + j, role: 'switch', tier: 'dci-spn',
        outputs: [
          { iface: 'et-9/0/1', deltaBps: G(1), peerKind: 'switch', peerSwitchId: 'bdr-' + t1, peerIface: 'et-1/1/1' },
          { iface: 'et-9/0/2', deltaBps: G(1), peerKind: 'switch', peerSwitchId: 'bdr-' + t2, peerIface: 'et-1/1/1' }
        ]
      });
    });
    [[1, [[1, 4], [2, 4]]], [2, [[2, 2], [3, 6]]], [3, [[1, 2], [4, 6]]]].forEach(function (s) {
      hops.push({
        switchId: 'spn-' + s[0], label: 'SPN ' + s[0], role: 'spine', tier: 'dci-spn',
        outputs: s[1].map(function (o) {
          return { iface: 'et-3/0/' + o[0], deltaBps: G(o[1]), peerKind: 'switch', peerSwitchId: 'tor-' + o[0], peerIface: 'et-0/0/' + s[0] };
        })
      });
    });
    [1, 2, 3, 4].forEach(function (k) {
      hops.push({
        switchId: 'tor-' + k, label: 'ToR ' + k, role: 'tor', tier: 'tor',
        outputs: [
          { iface: 'xe-0/0/10', deltaBps: G(6), peerKind: 'host', peerId: 'srv-' + k, peerIface: 'eno1' }
        ]
      });
    });
    return {
      key: 'dci-uturn',
      name: '跨層回頭（bdr→dci→bdr）',
      desc: 'bdr 出去 dci 又繞回 bdr，跟主流向（bdr→spn→tor）繞成環。' +
        'dci 與 spn 同 tier 鎖同欄，多數決排欄後 6 條 dci→bdr 畫成走廊內的玫瑰色回流帶。',
      json: {
        kind: 'destination',
        investigation: {
          switchId: 'core-1', iface: 'et-0/0/0', direction: 'in', deltaBps: G(24),
          note: 'core 進來 +24 Gbps，部分流量經 dci 繞回 bdr 再下去'
        },
        hops: hops
      }
    };
  })()
];

var byKey = {};
SAMPLES.forEach(function (s) { byKey[s.key] = s; });

var defaultKey = 'classic';

export { SAMPLES as list, byKey, defaultKey };
