#!/usr/bin/env python3
"""產生壓力測試用的追查 JSON（elements wire 格式）。純標準函式庫，不改動模型層。

  python3 stress/gen.py --depth 5 --fan 3  -o stress/x.json   # 樹狀擴散（圖會很高）
  python3 stress/gen.py --chain 20 --fan 8 -o stress/y.json   # 長鏈（圖會很寬）

節點順序：switch 依產生順序、葉依 port 發現順序；邊依 port 順序——跟 model.js 的 lazy-leaf
規則一致，build 出來的 order 才穩定。
"""
import argparse, json, sys

G = 1000000000


def sid(d, i):
    return 'sw-l%d-%03d' % (d, i)


def build(depth, fan, chain, total_bps):
    """回傳 (nodes, edges)。
       chain>0：一條 chain 跳的主幹，每跳再分出 fan-1 條直接終止的支線（圖會很寬）。
       否則：depth 層、每台 fan 個下游的樹（圖會很高）。"""
    nodes, edges, leaves = [], [], set()

    def edge(src, src_if, dst, dst_if, bps):
        edges.append({'data': {
            'id': 'e%d' % len(edges), 'type': 'network-flow', 'source': src, 'target': dst,
            'labels': {'source_iface': src_if, 'target_iface': dst_if},
            'metrics': {'delta_bps': int(bps)},
        }})

    def leaf(lid):
        if lid not in leaves:
            leaves.add(lid)
            leaf_nodes.append({'data': {'id': lid, 'type': 'host'}})

    leaf_nodes = []
    if chain:
        bw = total_bps
        for d in range(chain):
            last = (d == chain - 1)
            me = sid(d, 0)
            nodes.append({'data': {'id': me, 'type': 'switch', 'name': 'Hop %02d' % d}})
            if last:
                leaf('srv-%03d' % d)
                edge(me, 'et-%d/0/0' % d, 'srv-%03d' % d, 'eno1', bw)
            else:
                edge(me, 'et-%d/0/0' % d, sid(d + 1, 0), 'et-%d/0/0' % (d + 1), bw * 0.6)
            for k in range(1, fan):          # 支線：直接終止，製造大量 interface
                lid = 'srv-%d-%02d' % (d, k)
                leaf(lid)
                edge(me, 'xe-%d/0/%d' % (d, k), lid, 'eno1', bw * 0.4 / max(1, fan - 1))
            bw *= 0.6
        return nodes + leaf_nodes, edges

    frontier = [(0, 0, total_bps)]
    for d in range(depth):
        nxt = []
        for (_, idx, bw) in frontier:
            me = sid(d, idx)
            nodes.append({'data': {'id': me, 'type': 'switch', 'name': 'L%d-%03d' % (d, idx)}})
            for k in range(fan):
                child, share, last = idx * fan + k, bw / fan, (d == depth - 1)
                if last:
                    lid = 'srv-%d-%04d' % (d, child)
                    leaf(lid)
                    edge(me, 'et-%d/0/%d' % (d, 10 + k), lid, 'eno1', share)
                else:
                    edge(me, 'et-%d/0/%d' % (d, 10 + k), sid(d + 1, child), 'et-%d/0/0' % (d + 1), share)
                    nxt.append((d + 1, child, share))
        frontier = nxt
    return nodes + leaf_nodes, edges


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--depth', type=int, default=4, help='樹的層數')
    ap.add_argument('--fan', type=int, default=3, help='每台的出口數')
    ap.add_argument('--chain', type=int, default=0, help='>0 改產生這麼多跳的長鏈')
    ap.add_argument('--gbps', type=float, default=64.0)
    ap.add_argument('-o', '--out', required=True)
    a = ap.parse_args()

    nodes, edges = build(a.depth, a.fan, a.chain, a.gbps * G)
    # 追查起點寫在起點節點的 data 裡（頂層 investigation 已 deprecated）
    nodes[0]['data']['investigation'] = {'iface': 'et-0/0/0', 'delta_bps': int(a.gbps * G), 'direction': 'in',
                                         'note': '壓力測試資料，不是真的追查結果'}
    doc = {'kind': 'destination', 'elements': {'nodes': nodes, 'edges': edges}}
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False)
    sw = sum(1 for n in nodes if n['data']['type'] == 'switch')
    print('%s：%d 台 switch、%d 條 interface' % (a.out, sw, len(edges)), file=sys.stderr)


main()
