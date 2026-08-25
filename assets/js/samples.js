/* 範例追查 JSON。純資料，不抓 counter、不掃網。 */
(function (global) {
  'use strict';
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
            switchId: 'sw-edge-a', label: 'Edge A', role: 'switch', inputIface: 'xe-0/0/1',
            outputs: [
              { iface: 'et-0/0/48', deltaBps: G(20), peerKind: 'switch', peerSwitchId: 'sw-core-1', peerIface: 'et-1/0/1' }
            ]
          },
          {
            switchId: 'sw-core-1', label: 'Core 1', role: 'switch', inputIface: 'et-1/0/1',
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
            switchId: 'sw-edge-a', label: 'Edge A', role: 'switch', inputIface: 'xe-0/0/1',
            outputs: [
              { iface: 'et-0/0/48', deltaBps: G(6), peerKind: 'switch', peerSwitchId: 'sw-core-1', peerIface: 'et-1/0/1' },
              { iface: 'et-0/0/49', deltaBps: G(4), peerKind: 'switch', peerSwitchId: 'sw-core-1', peerIface: 'et-1/0/2' }
            ]
          },
          {
            switchId: 'sw-core-1', label: 'Core 1', role: 'switch', inputIface: 'et-1/0/1',
            outputs: [
              { iface: 'et-1/0/24', deltaBps: G(9), peerKind: 'switch', peerSwitchId: 'sw-agg-9', peerIface: 'et-9/0/1' }
            ]
          },
          {
            switchId: 'sw-core-1', label: 'Core 1', role: 'switch', inputIface: 'et-1/0/2',
            outputs: [
              { iface: 'et-1/0/24', deltaBps: G(7), peerKind: 'switch', peerSwitchId: 'sw-agg-9', peerIface: 'et-9/0/1' }
            ]
          },
          {
            switchId: 'sw-agg-9', label: 'Agg 9', role: 'switch', inputIface: 'et-9/0/1',
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
            switchId: 'sw-dorm-b3', label: '宿網 B3', role: 'switch', inputIface: 'ae0',
            outputs: [
              { iface: 'et-0/0/50', deltaBps: G(22), peerKind: 'switch', peerSwitchId: 'sw-agg-dorm', peerIface: 'et-2/0/3' }
            ]
          },
          {
            switchId: 'sw-agg-dorm', label: '宿區匯聚', role: 'switch', inputIface: 'et-2/0/3',
            outputs: [
              { iface: 'ae10', deltaBps: G(18), peerKind: 'switch', peerSwitchId: 'sw-core-n', peerIface: 'ae1' },
              { iface: 'xe-2/0/7', deltaBps: G(6), peerKind: 'switch', peerSwitchId: 'fw-campus', peerIface: 'xe-0/0/0' }
            ]
          },
          {
            switchId: 'sw-core-n', label: '核心 North', role: 'switch', inputIface: 'ae1',
            outputs: [
              { iface: 'et-0/0/1', deltaBps: G(12), peerKind: 'router', peerId: 'rtr-tanet', peerIface: 'Te0/1/0' },
              { iface: 'et-0/0/2', deltaBps: G(4), peerKind: 'switch', peerSwitchId: 'sw-dc-spine', peerIface: 'et-1/1/1' }
            ]
          },
          {
            switchId: 'fw-campus', label: '校園防火牆', role: 'switch', inputIface: 'xe-0/0/0',
            outputs: [
              { iface: 'xe-0/0/1', deltaBps: G(6), peerKind: 'router', peerId: 'rtr-tanet', peerIface: 'Te0/1/1' }
            ]
          },
          {
            switchId: 'sw-dc-spine', label: '機房 Spine', role: 'switch', inputIface: 'et-1/1/1',
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
            switchId: 'sw-tor-14', label: 'ToR 14', role: 'switch', inputIface: 'et-0/0/52',
            otherOutBps: G(9),
            outputs: [
              { iface: 'xe-0/0/1', deltaBps: G(18), peerKind: 'switch', peerSwitchId: 'sw-leaf-3', peerIface: 'et-3/0/1' },
              { iface: 'xe-0/0/2', deltaBps: G(9), peerKind: 'host', peerId: 'srv-app-11', peerIface: 'eno2' },
              { iface: 'xe-0/0/3', deltaBps: G(6), peerKind: 'host', peerId: 'srv-app-12', peerIface: 'eno2' }
            ]
          },
          {
            switchId: 'sw-leaf-3', label: 'Leaf 3', role: 'switch', inputIface: 'et-3/0/1',
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
            switchId: 'sw-core-1', label: 'Core 1', role: 'switch', outputIface: 'et-1/0/9',
            inputs: [
              { iface: 'et-1/0/1', deltaBps: G(12), peerKind: 'switch', peerSwitchId: 'sw-edge-a', peerIface: 'et-0/0/48' },
              { iface: 'et-1/0/2', deltaBps: G(6), peerKind: 'switch', peerSwitchId: 'sw-edge-b', peerIface: 'et-0/0/48' }
            ]
          },
          {
            switchId: 'sw-edge-a', label: 'Edge A', role: 'switch', outputIface: 'et-0/0/48',
            inputs: [
              { iface: 'xe-0/0/1', deltaBps: G(7), peerKind: 'host', peerId: 'lab-gpu-01', peerIface: 'eno1' },
              { iface: 'xe-0/0/2', deltaBps: G(3), peerKind: 'host', peerId: 'lab-gpu-02', peerIface: 'eno1' }
            ]
          },
          {
            switchId: 'sw-edge-b', label: 'Edge B', role: 'switch', outputIface: 'et-0/0/48',
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
      name: 'Switch → Node → Pod',
      desc: '同一條 Sankey 接下去。node 是虛線盒，pod 是葉。沒跟的 pod 併成該 node 的其他輸出。',
      json: {
        kind: 'destination',
        investigation: { switchId: 'sw-tor-k8s', iface: 'et-0/0/48', direction: 'in', deltaBps: G(24) },
        pruning: { topN: 3, minShare: 0.10 },
        hops: [
          {
            switchId: 'sw-tor-k8s', label: 'ToR k8s', role: 'switch', inputIface: 'et-0/0/48',
            outputs: [
              { iface: 'xe-0/0/11', deltaBps: G(14), peerKind: 'node', peerSwitchId: 'node-w-11', peerIface: 'bond0' },
              { iface: 'xe-0/0/12', deltaBps: G(7), peerKind: 'node', peerSwitchId: 'node-w-12', peerIface: 'bond0' }
            ]
          },
          {
            switchId: 'node-w-11', label: 'node-w-11', role: 'node', inputIface: 'bond0',
            otherOutBps: G(2.5),
            outputs: [
              { iface: 'veth3a1f', deltaBps: G(8), peerKind: 'pod', peerId: 'ingest-7d9c', namespace: 'telemetry' },
              { iface: 'veth9b02', deltaBps: G(3.5), peerKind: 'pod', peerId: 'kafka-2', namespace: 'stream' }
            ]
          },
          {
            switchId: 'node-w-12', label: 'node-w-12', role: 'node', inputIface: 'bond0',
            otherOutBps: G(1.5),
            outputs: [
              { iface: 'veth5cc7', deltaBps: G(5.5), peerKind: 'pod', peerId: 'ingest-4f11', namespace: 'telemetry' }
            ]
          }
        ]
      }
    }
  ];

  var byKey = {};
  SAMPLES.forEach(function (s) { byKey[s.key] = s; });

  global.TraceSamples = { list: SAMPLES, byKey: byKey, defaultKey: 'classic' };
})(window);
