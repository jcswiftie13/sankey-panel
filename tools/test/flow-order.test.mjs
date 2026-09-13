/* 欄內流量排序（order:'flow'，預設）的性質測試。
   golden 會抓到「版面變了」，但抓不到「變得對不對」——這裡鎖住幾條看得懂的不變量。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, models } from './_cases.mjs';
import { byKey } from 'trace-sankey/samples';

const sum = (es) => es.reduce((a, e) => a + e.bps, 0);
/* 與套件內 layout/text.ts 的 flowOf 同一個定義。刻意在測試裡獨立寫一次：
   如果哪天 flowOf 的語意被改掉（例如把殘差算進去），這裡會炸——那正是要被討論的改動。 */
const flowOf = (n) => Math.max(sum(n.inEdges), sum(n.outEdges));
const colsOf = (m, order) => {
  const geo = api.layout(m, { order });
  return { geo, cols: geo.cols.filter((c) => c && c.length) };
};

test('flowOf＝max(入邊總和, 出邊總和)，不含殘差', () => {
  const m = api.build(byKey.classic.json, { minBps: 0 });
  const b = m.nodes.find((n) => n.id === 'sw-edge-a');
  assert.ok(b, '範例的節點 id 變了，測試要跟著改');
  /* classic 是「追進來 10G、出去 20G」的不守恆範例：max 取 20G，
     殘差（其他輸入 10G）刻意不算進來——否則「沒追到的量」會主導版面。 */
  assert.equal(flowOf(b), Math.max(b.tracedIn, b.tracedOut));
  assert.equal(flowOf(b), b.tracedOut);
  assert.ok(b.otherIn > 0, 'classic 的 sw-edge-a 應該有其他輸入');
  assert.equal(flowOf(b), b.tracedOut, '殘差不該被算進 flowOf');
  assert.ok(flowOf(b) < b.tracedIn + b.otherIn + b.tracedOut, '這條只是確認上面幾個值都不是 0');
  /* 歸屬線（owns）bps 恆 0，所以掛了 owner 的 port 葉的 flowOf 只看真正有量的那一側 */
  const om = api.build(byKey.client.json, { minBps: 0 });
  const owner = om.nodes.find((n) => n.role === 'owner');
  if (owner) assert.equal(flowOf(owner), Math.max(sum(owner.inEdges), sum(owner.outEdges)));
});

/* 沒有分組的欄（沒有帶 ns 的葉 pod、也沒有同欄互連邊）必須嚴格照流量遞減——
   這是「流量大的在上」最直接的定義。有分組的欄由下面兩條各自管。 */
test('flow 模式：沒有分組的欄，流量單調不遞增', () => {
  let checked = 0;
  for (const { name, tag, model } of models) {
    for (const col of colsOf(model, 'flow').cols) {
      const grouped = col.some((n) => (n.kind === 'leaf' && n.role === 'pod' && n.namespace)
        || n.inEdges.some((e) => e.lateral) || n.outEdges.some((e) => e.lateral));
      if (grouped || col.length < 2) continue;
      const f = col.map(flowOf);
      for (let i = 1; i < f.length; i++) {
        assert.ok(f[i] <= f[i - 1] + 1e-9,
          `${name}${tag} 欄內 ${col[i - 1].label}(${f[i - 1]}) → ${col[i].label}(${f[i]}) 不是遞減`);
      }
      checked++;
    }
  }
  assert.ok(checked > 10, '檢查到的欄太少（' + checked + '），語料或判定壞了');
});

/* ns 分組要整組相鄰（組間照組總流量、組內照各自流量）——這是既有行為，換排序不能弄丟 */
test('flow 模式：同 namespace 的葉 pod 仍然相鄰', () => {
  let checked = 0;
  for (const { name, tag, model } of models) {
    for (const col of colsOf(model, 'flow').cols) {
      const seen = new Map();
      col.forEach((n, i) => {
        if (n.kind !== 'leaf' || n.role !== 'pod' || !n.namespace) return;
        const at = seen.get(n.namespace);
        if (at == null) seen.set(n.namespace, i);
        else {
          assert.equal(i, at + 1, `${name}${tag} 的 ns ${n.namespace} 在欄內被切開了`);
          seen.set(n.namespace, i);
        }
      });
      if (seen.size) checked++;
    }
  }
  assert.ok(checked > 0, '語料裡沒有帶 ns 的葉 pod');
});

/* 這條守的是「lateral 鏈當一個群、鏈內生產者在上」那個決定。
   純流量排序會把 6G 的 BDR 4-6 排到 4G 的 BDR 1-3 之上，兩條 DCI 的弧帶得跨整欄。 */
test('flow 模式：dci-tier 的 DCI 夾在它的生產者與消費者之間', () => {
  const m = api.build(byKey['dci-tier'].json, { minBps: 0 });
  const col = colsOf(m, 'flow').cols.find((c) => c.some((n) => n.label.startsWith('DCI')));
  assert.ok(col, 'dci-tier 的 DCI 欄找不到了');
  const at = (p) => col.findIndex((n) => n.label.startsWith(p));
  const idx = col.map((n) => n.label);
  const dci = idx.findIndex((l) => l.startsWith('DCI'));
  const up = Math.max(...[1, 2, 3].map((i) => idx.indexOf('BDR ' + i)));
  const down = Math.min(...[4, 5, 6].map((i) => idx.indexOf('BDR ' + i)));
  assert.ok(up >= 0 && down >= 0 && dci >= 0, '節點名變了：' + idx.join(','));
  assert.ok(up < dci, '生產者 BDR 1-3 應該在 DCI 上面，實際順序：' + idx.join(' → '));
  assert.ok(dci < down, '消費者 BDR 4-6 應該在 DCI 下面，實際順序：' + idx.join(' → '));
  assert.equal(at('DCI'), dci);
});

/* layout:'node' 的外框在 flow 模式照成員 pod 的流量加總排（barycenter 照名字）。
   **不能拿內建範例測**：storage 的 worker-0 剛好既是名字最前、又是流量最大，兩種排序結果相同，
   斷言會在「外框永遠照名字排」的壞實作下照樣通過（實測過）。這裡刻意做一份名字序與流量序
   相反的資料：aaa-node 掛小 pod、zzz-node 掛大 pod。 */
const N = (data) => ({ data });
const E = (data) => ({ data });
const wrapperDoc = {
  kind: 'destination',
  elements: {
    nodes: [
      N({ id: 'sw1', type: 'switch', name: 'SW 1',
        investigation: { iface: 'xe-0/0/1', delta_bps: 3e9, direction: 'out' } }),
      N({ id: 'aaa-node', type: 'node', name: 'aaa-node' }),
      N({ id: 'zzz-node', type: 'node', name: 'zzz-node' }),
      N({ id: 'ns1', type: 'namespace', name: 'ns1' }),
      N({ id: 'p-small', type: 'pod', name: 'p-small', parent: 'ns1' }),
      N({ id: 'p-big', type: 'pod', name: 'p-big', parent: 'ns1' })
    ],
    edges: [
      E({ id: 'e1', type: 'network-flow', source: 'sw1', target: 'p-small',
        labels: { source_iface: 'xe-0/0/1' }, metrics: { delta_bps: 1e9 } }),
      E({ id: 'e2', type: 'network-flow', source: 'sw1', target: 'p-big',
        labels: { source_iface: 'xe-0/0/2' }, metrics: { delta_bps: 2e9 } }),
      E({ id: 'e3', type: 'network-flow', source: 'p-small', target: 'aaa-node',
        labels: { tier: 'pod-node' }, metrics: { delta_bps: 1e9 } }),
      E({ id: 'e4', type: 'network-flow', source: 'p-big', target: 'zzz-node',
        labels: { tier: 'pod-node' }, metrics: { delta_bps: 2e9 } })
    ]
  }
};

test('flow 模式：k8s node 外框照成員流量排，barycenter 照名字', () => {
  const m = api.build(wrapperDoc, { minBps: 0, layout: 'node' });
  assert.ok(m.ok, m.ok ? '' : m.errors.join(' / '));
  assert.equal(m.wrappers.length, 2, '外框數不對：' + m.wrappers.map((w) => w.label).join(','));
  const wf = (w) => w.podIds.reduce((t, id) => t + flowOf(m.nodeMap[id]), 0);
  const labels = (order) => api.layout(m, { order }).wrappers.map((g) => g.wrapper.label);
  /* 名字序與流量序在這份資料上是相反的——兩條斷言因此不可能同時被同一個壞實作滿足 */
  assert.deepEqual(labels('barycenter'), ['aaa-node', 'zzz-node'], 'barycenter 的外框不是照名字排');
  assert.deepEqual(labels('flow'), ['zzz-node', 'aaa-node'], 'flow 的外框不是照成員流量排');
  const flow = api.layout(m, { order: 'flow' }).wrappers.map((g) => g.wrapper);
  for (let i = 1; i < flow.length; i++) {
    assert.ok(wf(flow[i]) <= wf(flow[i - 1]) + 1e-9, '外框沒有照成員流量遞減');
  }
  /* 內建範例也要照流量遞減（只是它名字序剛好相同，測不出區別，所以只當附帶檢查） */
  const sm = api.build(byKey.storage.json, { minBps: 0, layout: 'node' });
  const sf = (w) => w.podIds.reduce((t, id) => t + flowOf(sm.nodeMap[id]), 0);
  const sw = api.layout(sm, { order: 'flow' }).wrappers.map((g) => g.wrapper);
  for (let i = 1; i < sw.length; i++) assert.ok(sf(sw[i]) <= sf(sw[i - 1]) + 1e-9);
});

/* 兩個模式必須真的不同（否則上面幾條可能只是在測一個沒生效的選項），
   而且 barycenter 那條路要能被叫到。 */
test('order 選項真的會改變版面', () => {
  let differ = 0;
  for (const { model } of models) {
    const seq = (order) => api.layout(model, { order }).cols
      .filter((c) => c && c.length).map((c) => c.map((n) => n.id).join(',')).join('|');
    if (seq('flow') !== seq('barycenter')) differ++;
  }
  assert.ok(differ > 0, 'flow 與 barycenter 在所有範例上結果相同——選項沒有生效');
});
