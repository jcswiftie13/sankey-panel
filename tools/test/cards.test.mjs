/* 卡面屬性行的單一來源。layout/text.ts 產出行清單（高度取它的長度），svg/cards.tsx 迭代同一份
   清單來畫。以前這兩件事各寫一次（text.ts 數行數、cards.tsx 一串 `if (cond) { push; ly += LINE_H }`），
   每一組都碰巧抄對——但那是兩份手抄，之後在卡面多加一行卻忘了改行數，內容會超出算出的高度、
   分隔線與下方卡片的 y 全錯位，而且沒有型別錯誤也沒有執行期例外。

   下面這條刻意**不看程式怎麼寫**，只看渲染結果：每張卡裡的每個 <text> 的 y 都必須落在那張卡的
   框裡。不管未來 cards.tsx 改成什麼結構，「畫的比算的多一行」都會被抓到。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, models } from './_cases.mjs';

const num = (s, attr) => {
  const m = new RegExp(attr + '="(-?[\\d.]+)"').exec(s);
  return m ? Number(m[1]) : null;
};

/** 把 render() 的輸出切成一張卡一段：從 data-n 到**這個 g 的結尾**。
    切到「下一個 data-n」是錯的：最後一張卡後面接著殘差色塊的 <g>，而殘差本來就畫在卡框外面
    （貼盒子外側），會被誤判成溢出（踩過一次）。卡的 <g> 裡沒有嵌套的 <g>
    （WrapperBox 的 data-n 就是內層那個），所以第一個 </g> 就是結尾。 */
const cardChunks = (svg) => [...svg.matchAll(/<g data-n="([^"]*)"[\s\S]*?<\/g>/g)]
  .map((m) => ({ id: m[1], text: m[0] }));

test('每張卡的文字都落在卡框內（畫的行數不能超過算出的高度）', () => {
  let cards = 0;
  for (const { name, tag, model } of models) {
    const svg = api.render(model);
    for (const c of cardChunks(svg)) {
      const rect = /<rect [^>]*>/.exec(c.text);
      assert.ok(rect, name + tag + ' ' + c.id + '：卡裡找不到 <rect>');
      const top = num(rect[0], 'y'), h = num(rect[0], 'height');
      assert.ok(top != null && h != null, name + tag + ' ' + c.id + '：rect 少了 y／height');
      /* 只看卡自己的文字。<title> 不是 <text>；帶上的數字不在卡的 <g> 裡。 */
      const ys = [...c.text.matchAll(/<text [^>]*\by="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
      for (const y of ys) {
        assert.ok(y >= top - 0.5,
          `${name}${tag} ${c.id}：文字 y=${y} 在卡框上緣 ${top} 之外`);
        assert.ok(y <= top + h + 0.5,
          `${name}${tag} ${c.id}：文字 y=${y} 超出卡框下緣 ${top + h}（算出的高度容不下畫出來的行數）`);
      }
      if (ys.length) cards++;
    }
  }
  assert.ok(cards > 100, '檢查到的卡太少（' + cards + '），切段或選擇器壞了');
});

/* 清單長度與高度的關係：高度是 cardH(行數)，所以「行數 +1」一定要讓卡高 +LINE_H。
   這條是上面那條的算術面，抓的是「有人把 cardH 改成固定值」。 */
/* 上面那條只抓得到**嚴重**溢出：cardH 的底部留白有 13px + CARD_BASE 的餘裕，多畫一行常常還在
   框裡（實測：app 卡多畫一行仍在框內，斷言不會炸）。所以再加一條精準的——
   直接比對「畫了幾行」與「text.ts 算了幾行」，把兩邊綁死。 */
const SUB_CLASS = { node: 'n-sub', leaf: 'leaf-sub' };
test('每張卡畫出的屬性行數＝text.ts 算出的行數', async () => {
  const T = await import('../../packages/trace-sankey/dist/layout/text.js');
  let checked = 0;
  for (const { name, tag, model } of models) {
    const svg = api.render(model);
    for (const c of cardChunks(svg)) {
      const n = model.nodeMap[c.id];
      if (!n) continue;                                  /* k8s node 外框不是圖節點 */
      let want, cls = SUB_CLASS[n.kind];
      if (n.kind === 'node') want = T.hopLines(n).length;
      else if (n.kind === 'anchor') { want = 1; cls = 'leaf-sub'; }
      else if (n.role === 'ns' || n.role === 'app') want = T.groupLines(n).length;
      else if (n.role === 'owner') want = T.ownerLines(n).length;
      else if (T.clientCols(n).length) continue;          /* 有 clients 的葉是表格版式，另一套格線 */
      else want = T.leafLines(n).length;
      const got = (c.text.match(new RegExp('<text class="' + cls + '"', 'g')) || []).length;
      assert.equal(got, want,
        `${name}${tag} ${c.id}（${n.kind}/${n.role}）畫了 ${got} 行屬性、text.ts 算的是 ${want} 行`);
      checked++;
    }
  }
  assert.ok(checked > 100, '檢查到的卡太少（' + checked + '）');
});

test('cardH 對行數是線性的（加一行就高一階）', async () => {
  const { cardH } = await import('../../packages/trace-sankey/dist/layout/text.js');
  const { LINE_H } = await import('../../packages/trace-sankey/dist/layout/constants.js');
  for (let i = 0; i < 5; i++) {
    assert.equal(cardH(i + 1) - cardH(i), LINE_H, 'cardH 不是每行 +LINE_H');
  }
});
