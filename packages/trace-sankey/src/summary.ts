/* 圖外資訊：hop 數字摘要表（HTML 字串）。app 目前沒用，但照常匯出並被 golden 對拍——刻意保留的 API。 */
import type { TraceModelOk, TraceNode } from './model/types.js';
import { fmtAmount as A, fmtRate as R } from './model/format.js';
import { esc, resIn, resOut } from './layout/text.js';

export const summary = (model: TraceModelOk): string => {
  const rows = model.nodes.filter((n) => n.kind === 'node').sort((a, b) => a.col - b.col);
  const h = ['<h3>hop 數字摘要（圖外資訊）</h3><div class="tbl-wrap"><table><thead><tr>',
    '<th>hop</th><th>追查輸入</th><th>出口增加</th><th class="c-amber">其他進</th>',
    '<th class="c-rose">其他出</th></tr></thead><tbody>'];
  for (const n of rows) {
    const unit = n.unit!;
    h.push('<tr><td>' + esc(n.label) + ' <span class="c-dim">' + esc(n.id) + '</span>' +
      (n.noFlow ? ' <span class="c-dim">(no-flow)</span>' : '') + '</td>' +
      '<td class="num">' + A(n.tracedIn!, unit) + '</td>' +
      '<td class="num">' + A(n.tracedOut!, unit) + '</td>' +
      '<td class="num c-amber">' + (resIn(n) ? (unit === 'bytesPerSec' ? '' : '+') + A(n.otherIn!, unit) : '—') + '</td>' +
      '<td class="num c-rose">' + (resOut(n) ? A(n.otherOut!, unit) : '—') + '</td></tr>');
  }
  h.push('</tbody></table></div>');
  /* namespace 流量小計：ns 終點節點就是單一事實來源（bps＝pod 匯流邊加總、
     pod 數＝邊數），表跟圖不可能對不上 */
  const nsNodes: TraceNode[] = model.nodes.filter((n) => n.role === 'ns');
  if (nsNodes.length) {
    const sorted = nsNodes.slice().sort((a, b) => b.bps! - a.bps!);
    h.push('<h3>namespace 流量小計（終點）</h3><div class="tbl-wrap"><table><thead><tr>' +
      '<th>namespace</th><th>pod 數</th><th>Δ 合計</th></tr></thead><tbody>');
    for (const n of sorted) {
      h.push('<tr><td>' + esc(n.label) + '</td><td class="num">' + n.podCount + '</td>' +
        '<td class="num">' + R(n.bps!, n.unit!) + '</td></tr>');
    }
    h.push('</tbody></table></div>');
  }
  h.push('<p class="warn">平衡式：已知 in ＋ 其他輸入 ＝ 已追查 out ＋ 其他輸出。</p>');
  for (const w of model.warnings) h.push('<p class="warn">⚠ ' + esc(w) + '</p>');
  return h.join('');
};
