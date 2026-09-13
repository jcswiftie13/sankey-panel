/* namespace 小計的單一來源。原本 summary() 讀 ns 終點卡、flowTables() 自己掃葉 pod
   重新加總，兩邊的註解都寫著「這是單一事實來源」，而在 roots ＋ no-flow pod 的組合下
   已經對不上（flowTables 說 4 個 pod、ns 卡說 2 個；門檻高一點時圖上連 ns 卡都沒有、
   flowTables 卻還印著那一列）。golden 抓不到這件事——它分別對 summary.html 與 tables.html
   逐 byte 比，從不互相比較。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, models } from './_cases.mjs';
import { namespaceAggs, nsTotalText } from 'trace-sankey';

/* 從 summary() 的 HTML 把 namespace 小計那張表的列拆出來（純字串，不引入 parser） */
const summaryNsRows = (html) => {
  const m = /<h3>namespace 流量小計（終點）<\/h3>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(html);
  if (!m) return null;
  return [...m[1].matchAll(/<tr><td>(.*?)<\/td><td class="num">(.*?)<\/td><td class="num">(.*?)<\/td><\/tr>/g)]
    .map((r) => ({ namespace: r[1], pods: r[2], total: r[3] }));
};

test('summary() 與 flowTables() 的 namespace 小計逐列相同', () => {
  let rows = 0;
  for (const { name, tag, model } of models) {
    const t = api.flowTables(model).namespaces;
    const s = summaryNsRows(api.summary(model));
    if (!t.length) { assert.equal(s, null, name + tag + '：flowTables 沒有 ns 列，summary 卻有'); continue; }
    assert.ok(s, name + tag + '：summary 少了 namespace 小計那張表');
    assert.equal(s.length, t.length, name + tag + '：兩張表的列數不同');
    t.forEach((a, i) => {
      assert.equal(s[i].namespace, a.namespace, name + tag + ' 第 ' + i + ' 列的 ns 不同（排序也要一致）');
      assert.equal(s[i].pods, a.pods + ' / ' + a.podsTotal, name + tag + ' ' + a.namespace + ' 的 pod 數不同');
      assert.equal(s[i].total, a.totalText, name + tag + ' ' + a.namespace + ' 的量不同');
      rows++;
    });
  }
  assert.ok(rows > 0, '語料裡沒有任何 namespace 小計列');
});

test('namespaceAggs 與圖上的 ns 終點卡一致', () => {
  for (const { name, tag, model } of models) {
    for (const a of namespaceAggs(model)) {
      const card = model.nodes.find((n) => n.role === 'ns' && n.label === a.namespace);
      assert.ok(a.podsTotal >= a.pods, name + tag + ' ' + a.namespace + '：計量 pod 數大於全部 pod 數');
      if (card) {
        assert.equal(a.pods, card.podCount, name + tag + ' ' + a.namespace + '：計量 pod 數與 ns 卡不同');
        assert.equal(a.total, card.bps, name + tag + ' ' + a.namespace + '：量與 ns 卡不同');
      } else {
        /* 沒有 ns 卡＝那個 ns 在圖上只剩 no-flow pod：量必須是 0 且不准印成 0 */
        assert.equal(a.pods, 0, name + tag + ' ' + a.namespace + '：沒有 ns 卡卻有計量 pod');
        assert.equal(a.total, 0);
        assert.equal(nsTotalText(a), '—', '沒量到東西要印 —，不是 0（缺值不是零）');
      }
    }
  }
});

/* 上面兩條在「計量＝全部」的語料上會變成同義反覆。roots 變體就是為了製造差異而加的，
   這條確認它真的有效——否則那個 bug 修好之後沒人守得住。 */
test('語料裡真的有「計量 pod 數 ≠ 全部 pod 數」的情況', () => {
  const diff = [], noCard = [];
  for (const { name, tag, model } of models) {
    for (const a of namespaceAggs(model)) {
      if (a.pods !== a.podsTotal) diff.push(name + tag + ' ' + a.namespace + ' ' + a.pods + '/' + a.podsTotal);
      if (!model.nodes.some((n) => n.role === 'ns' && n.label === a.namespace)) noCard.push(name + tag);
    }
  }
  assert.ok(diff.length > 0, '沒有任何 ns 出現「計量 ≠ 全部」——roots 變體可能被拿掉了，兩張表的分歧就沒人守');
  assert.ok(noCard.length > 0, '沒有任何「有 no-flow pod 但沒有 ns 卡」的情況——那條分支沒被測到');
});
