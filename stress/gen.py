#!/usr/bin/env python3
"""產生壓力測試用的追查 JSON。純標準函式庫，不改動模型層。

  python3 stress/gen.py --depth 5 --fan 3  -o stress/x.json   # 樹狀擴散（圖會很高）
  python3 stress/gen.py --chain 20 --fan 8 -o stress/y.json   # 長鏈（圖會很寬）
"""
import argparse, json, sys

G = 1000000000


def sid(d, i):
    return 'sw-l%d-%03d' % (d, i)


def build(depth, fan, chain, total_bps):
    """chain>0：一條 chain 跳的主幹，每跳再分出 fan-1 條直接終止的支線（圖會很寬）。
       否則：depth 層、每台 fan 個下游的樹（圖會很高）。"""
    hops = []
    if chain:
        bw = total_bps
        for d in range(chain):
            last = (d == chain - 1)
            outs = [{
                'iface': 'et-%d/0/0' % d,
                'deltaBps': int(bw if last else bw * 0.6),
                'peerKind': 'host' if last else 'switch',
                ('peerId' if last else 'peerSwitchId'):
                    ('srv-%03d' % d if last else sid(d + 1, 0)),
                'peerIface': 'eno1' if last else 'et-%d/0/0' % (d + 1),
            }]
            for k in range(1, fan):          # 支線：直接終止，製造大量 interface
                outs.append({
                    'iface': 'xe-%d/0/%d' % (d, k),
                    'deltaBps': int(bw * 0.4 / max(1, fan - 1)),
                    'peerKind': 'host',
                    'peerId': 'srv-%d-%02d' % (d, k),
                    'peerIface': 'eno1',
                })
            hops.append({'switchId': sid(d, 0), 'label': 'Hop %02d' % d, 'role': 'switch',
                         'outputs': outs})
            bw *= 0.6
        return hops

    frontier = [(0, 0, total_bps)]
    for d in range(depth):
        nxt = []
        for (_, idx, bw) in frontier:
            outs = []
            for k in range(fan):
                child, share, last = idx * fan + k, bw / fan, (d == depth - 1)
                outs.append({
                    'iface': 'et-%d/0/%d' % (d, 10 + k),
                    'deltaBps': int(share),
                    'peerKind': 'host' if last else 'switch',
                    ('peerId' if last else 'peerSwitchId'):
                        ('srv-%d-%04d' % (d, child) if last else sid(d + 1, child)),
                    'peerIface': 'eno1' if last else 'et-%d/0/0' % (d + 1),
                })
                if not last:
                    nxt.append((d + 1, child, share))
            hops.append({'switchId': sid(d, idx), 'label': 'L%d-%03d' % (d, idx), 'role': 'switch',
                         'outputs': outs})
        frontier = nxt
    return hops


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--depth', type=int, default=4, help='樹的層數')
    ap.add_argument('--fan', type=int, default=3, help='每台的出口數')
    ap.add_argument('--chain', type=int, default=0, help='>0 改產生這麼多跳的長鏈')
    ap.add_argument('--top-n', type=int, default=16, help='pruning.topN（調小圖就小）')
    ap.add_argument('--gbps', type=float, default=64.0)
    ap.add_argument('-o', '--out', required=True)
    a = ap.parse_args()

    hops = build(a.depth, a.fan, a.chain, a.gbps * G)
    doc = {
        'kind': 'destination',
        'investigation': {'switchId': hops[0]['switchId'], 'iface': 'et-0/0/0',
                          'direction': 'in', 'deltaBps': int(a.gbps * G),
                          'note': '壓力測試資料，不是真的追查結果'},
        'pruning': {'topN': a.top_n, 'minShare': 0.0},
        'hops': hops,
    }
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False)
    ifaces = sum(len(h['outputs']) for h in hops)
    print('%s：%d 台 switch、%d 條 interface' % (a.out, len(hops), ifaces), file=sys.stderr)


main()
