/* 步驟 5：欄位（最長路徑），封包方向左到右。
   同 tier 的節點視為一個超級節點：整群共用一個欄位，彼此之間的邊不參與排欄，
   同層互連（如 bdr↔dci）才不會把同一層拆成兩欄。沒標 tier 的自成一群，
   全部沒標時每群都是單節點，行為與純最長路徑相同。 */
import type { BuildCtx } from './types.js';
import { fmtBps } from './format.js';
import { SEP } from './util.js';

export const assignColumns = (ctx: BuildCtx): void => {
  const { nodes, edges, warnings } = ctx;
  const ids = ctx.order.slice();
  const groupOf: Record<string, string> = {}, groupIds: string[] = [];
  for (const id of ids) {
    const g = nodes[id].tier != null ? 't:' + nodes[id].tier : 'n:' + id;
    groupOf[id] = g;
    if (groupIds.indexOf(g) < 0) groupIds.push(g);
  }
  /* 5a. 聚合群組間每個方向的總流量。plain object：後面要依插入序迭代 */
  const gflow: Record<string, number> = {};
  for (const e of edges) {
    const ga = groupOf[e.fromId], gb = groupOf[e.toId];
    if (ga === gb) continue;
    const k = ga + SEP + gb;
    gflow[k] = (gflow[k] || 0) + e.bps;
  }
  const groupLabel = (g: string): string =>
    g.charAt(0) === 't' ? 'tier「' + g.slice(2) + '」' : nodes[g.slice(2)].label;

  /* 5b. 兩群之間雙向都有流量＝繞成環。流量多數決：總量小的方向整組退出排欄，
     畫成回流帶——tier 永遠鎖同一欄，不再整個放棄。平手時保留先出現的群當上游。 */
  const gdropped = new Set<string>();
  for (const k of Object.keys(gflow)) {
    const p = k.split(SEP), rk = p[1] + SEP + p[0];
    if (gflow[rk] == null || gdropped.has(k) || gdropped.has(rk)) continue;
    let loser = k;
    if (gflow[k] > gflow[rk] ||
        (gflow[k] === gflow[rk] && groupIds.indexOf(p[0]) < groupIds.indexOf(p[1]))) {
      loser = rk;
    }
    gdropped.add(loser);
    const lp = loser.split(SEP);
    warnings.push(groupLabel(lp[0]) + ' → ' + groupLabel(lp[1]) + ' 逆著多數流量方向（' +
      fmtBps(gflow[loser]) + '，對向 ' + fmtBps(gflow[lp[1] + SEP + lp[0]]) +
      '），畫成回流帶，不參與排欄。');
  }

  /* 5c. 多數決只看成對的兩群，繞經三群以上的環可能還在：
     反覆移除環上（SCC 內）總流量最小的群組邊，每輪至少移一條，必然終止。 */
  const sccOf = (live: string[]): { id: Record<string, number>; size: number[] } => {
    const adj: Record<string, string[]> = {}, radj: Record<string, string[]> = {};
    for (const g of groupIds) { adj[g] = []; radj[g] = []; }
    for (const k of live) {
      const p = k.split(SEP);
      adj[p[0]].push(p[1]); radj[p[1]].push(p[0]);
    }
    const seen = new Set<string>(), post: string[] = [];
    const dfs = (g: string): void => {
      if (seen.has(g)) return;
      seen.add(g);
      adj[g].forEach(dfs);
      post.push(g);
    };
    groupIds.forEach(dfs);
    const id: Record<string, number> = {}, size: number[] = [];
    for (let i = post.length - 1; i >= 0; i--) {
      if (id[post[i]] != null) continue;
      const cur = size.length;
      size.push(0);
      const stack = [post[i]];
      while (stack.length) {
        const v = stack.pop()!;
        if (id[v] != null) continue;
        id[v] = cur; size[cur]++;
        for (const w of radj[v]) if (id[w] == null) stack.push(w);
      }
    }
    return { id, size };
  };
  for (;;) {
    const live = Object.keys(gflow).filter((k) => !gdropped.has(k));
    /* 兩端同屬一個大小 >1 的強連通分量（SCC）的邊才真的在環上——
       光看 Kahn 排不進誰會把環的「下游」也圈進來，誤刪無辜的邊 */
    const scc = sccOf(live);
    let victim: string | null = null;
    for (const k of live) {
      const p = k.split(SEP);
      if (scc.id[p[0]] === scc.id[p[1]] && scc.size[scc.id[p[0]]] > 1 &&
          (victim == null || gflow[k] < gflow[victim])) victim = k;
    }
    if (victim == null) break;
    gdropped.add(victim);
    const vp = victim.split(SEP);
    warnings.push('群組間仍繞成環，移除其中流量最小的 ' + groupLabel(vp[0]) + ' → ' +
      groupLabel(vp[1]) + '（' + fmtBps(gflow[victim]) + '）破環，該方向畫成回流帶。');
  }

  /* 5d. 標記退出排欄的邊，在破環後的群組 DAG 上跑最長路徑（保證收斂） */
  for (const e of edges) {
    const ga = groupOf[e.fromId], gb = groupOf[e.toId];
    e.dropped = ga !== gb && gdropped.has(ga + SEP + gb);
  }
  const gcol: Record<string, number> = {};
  for (const g of groupIds) gcol[g] = 0;
  let gpass = 0;
  for (; gpass < groupIds.length + 2; gpass++) {
    let gmoved = false;
    for (const e of edges) {
      if (e.dropped) continue;
      const ga = groupOf[e.fromId], gb = groupOf[e.toId];
      if (ga === gb) continue;
      if (gcol[gb] < gcol[ga] + 1) { gcol[gb] = gcol[ga] + 1; gmoved = true; }
    }
    if (!gmoved) break;
  }
  if (gpass >= groupIds.length + 2) warnings.push('拓樸疑似有環，欄位順序可能不準。');
  for (const id of ids) nodes[id].col = gcol[groupOf[id]];

  /* 5e. 排完欄仍逆向（col 遞減）的邊畫成回流帶 */
  for (const e of edges) e.backward = nodes[e.fromId].col > nodes[e.toId].col;

  /* 5f. 同欄的邊＝tier 內的橫向互連，render 畫成右側弧帶 */
  for (const e of edges) e.lateral = nodes[e.fromId].col === nodes[e.toId].col;

  /* 5g. tier 群內的拓樸子順序。這不是給算式用的，是給排版用的：
     只被同欄餵的節點（dci 這種）沒有跨欄父節點可以對齊，render 靠 subOrder
     把生產者排在消費者上面，同欄弧帶才不會互相穿過。見 layout 的 pref。 */
  for (const id of ids) nodes[id].subOrder = 0;
  const tierMembers: Record<string, string[]> = {};
  for (const id of ids) {
    const t = nodes[id].tier;
    if (t != null) (tierMembers[t] = tierMembers[t] || []).push(id);
  }
  for (const t of Object.keys(tierMembers)) {
    const members = tierMembers[t];
    if (members.length < 2) continue;
    const inGroup = new Set<string>(), indeg: Record<string, number> = {}, adj: Record<string, string[]> = {};
    for (const id of members) { inGroup.add(id); indeg[id] = 0; adj[id] = []; }
    for (const e of edges) {
      if (inGroup.has(e.fromId) && inGroup.has(e.toId)) { adj[e.fromId].push(e.toId); indeg[e.toId]++; }
    }
    const queue = members.filter((id) => indeg[id] === 0);
    let seq = 0;
    const popped = new Set<string>();
    while (queue.length) {
      const cur = queue.shift()!;
      popped.add(cur);
      nodes[cur].subOrder = seq++;
      for (const m of adj[cur]) if (--indeg[m] === 0) queue.push(m);
    }
    /* tier 內部有環（a→b→a）就排不完。不再警告——沒有歸因要算了，剩下的影響
       只是那幾台的上下順序沒有唯一解；照發現順序補完，至少是穩定的。 */
    for (const id of members) if (!popped.has(id)) nodes[id].subOrder = seq++;
  }
};
