/* 入口等價：render 與 flowTables 的第二個參數（算好的 Geometry）是選用的，
   「自己算」與「外面傳進來」必須得到完全相同的輸出。
   這條守的是 A5 的收斂決定——版面選項只掛 layout()，這兩支只吃 geo。
   如果哪天有人給 render 或 flowTables 補了一份自己的版面選項參數，
   它們就會與呼叫端傳進來的 geo 打架，這個斷言會先炸。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, models } from './_cases.mjs';

test('render(model) === render(model, layout(model))', () => {
  assert.ok(models.length > 0, '語料是空的——先 npm run build -w trace-sankey');
  for (const { name, tag, model } of models) {
    assert.equal(api.render(model, api.layout(model)), api.render(model), name + tag);
  }
});

test('flowTables(model) === flowTables(model, layout(model))', () => {
  for (const { name, tag, model } of models) {
    assert.equal(api.flowTables(model, api.layout(model)).html, api.flowTables(model).html, name + tag);
  }
});

/* layout() 的確定性：tables.ts 的「沒給 geo 就自己 layout() 一次」靠的就是這個性質——
   同一份 model 算兩次必須得到完全相同的順序，否則表的列序與圖的上下順序會不一致。 */
test('layout() 對同一份 model 是確定性的', () => {
  for (const { name, tag, model } of models) {
    const seq = (geo) => model.nodes.map((n) => n.id + ':' + geo.nodes.get(n.id).y).join('|');
    assert.equal(seq(api.layout(model)), seq(api.layout(model)), name + tag);
  }
});
