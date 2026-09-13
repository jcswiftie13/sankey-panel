/* tooltip 的內容：帶（BandTip）與卡片（NodeTipView）。
   帶的列是明確列鍵的：layout/tips.ts 的 bandMeta 加新鍵，這裡要同步加一列。 */
import type { BandMeta, NodeTip } from '../layout/tips.js';
import { fmtBytes, fmtRate } from '../model/format.js';

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="t-row"><span>{k}</span><span>{v}</span></div>
);

export const BandTip = ({ d }: { d: BandMeta }) => {
  const isBytes = d.unit === 'bytesPerSec';
  const x = d.extra || {};
  return (
    <>
      <b>{d.from + ' → ' + d.to}</b>
      {/* iface 只在那一端真的有才印：switch 的 port 才有 iface，storage 邊、推導邊、歸屬線沒有這回事 */}
      {d.fi && <Row k="出口 iface" v={d.fi} />}
      {d.ti && <Row k="入口 iface" v={d.ti} />}
      {/* delta_bps 是「速率的差」；bytes/s 是絕對速率，標籤跟著換。
          歸屬線的 bps 是 0，那不是「零流量」而是「沒有量」——印出來就是憑空生一個值 */}
      {!d.owns && <Row k={isBytes ? '速率' + (d.channel ? '（' + d.channel + '）' : '') : '速率增量 Δ'} v={fmtRate(d.bps, d.unit || 'bps')} />}
      {d.channel && <Row k="channel" v={d.channel} />}
      {d.ns && <Row k="namespace" v={'ns/' + d.ns} />}
      {/* 無鄰居 port 上查到的 client：一筆直接印，多筆印數量與清單（完整欄位在卡片的 tooltip） */}
      {d.clients && <Row k="client" v={d.clients.length === 1 ? d.clients[0] : d.clients.length + ' 個：' + d.clients.join(' · ')} />}
      {/* 歸屬線：這個 port 上還有別人（或查不到 owner）的機器，量停在 port——拆開就是攤分推估，我們不做 */}
      {d.owns && <Row k="歸屬" v="這個 port 上還有別人的機器，量停在 port（不攤分）" />}
      {d.tier && <Row k="tier" v={d.tier} />}
      {/* 推導邊：不是後端量的一條 flow，而是同一筆量測重新分組。pod→app→ns 有欄對 tier，
          值是成員 pod 入邊的加總；owner 邊沒有 tier，值是整張 port 卡的量歸到這個 owner */}
      {d.derived && !d.owns && <Row k="來源" v={d.tier ? '成員 pod 加總（推導值）' : 'port 卡的量歸到 owner（推導值）'} />}
      {d.attr && <Row k="attribution" v={d.attr === 'split' ? 'split（平均攤分的估計值）' : d.attr} />}
      {d.anchor && <Row k="這條是追查起點" v="" />}
      {d.backward && <Row k="回流（逆著多數流量方向）" v="" />}
      {(x.read_ops != null || x.write_ops != null) && (
        <Row k="IOPS（read / write）" v={(x.read_ops != null ? x.read_ops : '—') + ' / ' + (x.write_ops != null ? x.write_ops : '—')} />
      )}
      {x.read_latency_us != null && <Row k="read 延遲" v={x.read_latency_us + ' µs'} />}
      {x.write_latency_us != null && <Row k="write 延遲" v={x.write_latency_us + ' µs'} />}
      {x.max_iops != null && <Row k="QoS 上限" v={x.max_iops + ' IOPS'} />}
      {x.max_bytes_per_sec != null && <Row k="QoS 上限" v={fmtBytes(x.max_bytes_per_sec) + '/s'} />}
    </>
  );
};

export const NodeTipView = ({ d }: { d: NodeTip }) => (
  <>
    <b>{d.title}</b>
    {(d.rows || []).map((r, i) => <Row key={i} k={r[0]} v={r[1]} />)}
  </>
);
