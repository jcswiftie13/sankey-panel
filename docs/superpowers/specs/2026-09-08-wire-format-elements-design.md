# 輸入格式改成 cytoscape-style wire JSON（elements.nodes / elements.edges）

## Context

目前 trace-sankey 吃自家的 `investigation + hops[].outputs/inputs` 格式。要改成與
「Storage Flow Sankey 面板」相同的 wire 格式：`{ elements: { nodes:[{data}], edges:[{data}] } }`，
節點有 `id/type/name/parent/labels/status/usage/...`，邊有 `id/type/source/target/labels.tier/metrics`。
目標：**參考面板 Sankey 會用到的合法資料，丟進我們的前端也合法且畫得出來**（netapp-node →
aggr → svm → pvc → pod → application → namespace、status 外框色、usage 副標、tooltip 附加資訊、
no-flow 卡），**同時保留我們原有的 switch 追查能力**（追查起點錨卡、守恆殘差、tier 同欄、回流、
顯示門檻）。

使用者已定案（不再討論）：
- **只收新格式**，舊格式直接報「不合契約」；samples.js／samples/／stress/ 全部轉成新格式。
- 邊權重：`metrics.delta_bps` 優先；沒有就 `(read_bytes_per_sec + write_bytes_per_sec) × 8`（bytes/s → bps）；
  兩者都沒有→這條不畫。UI 不加 read/write 切換。
- **支援 application 中繼欄**：pod → application → namespace（靠 `parent` 鏈）。
- 節點 `status/usage/health/hardware/perf/alerts`：**要畫**（外框色、副標、`<title>`）。
- 追查起點：**頂層 `investigation` 選填**；沒給就沒有錨卡、不查 root。
- `tier: pod-node` 邊：接受並忽略（只是擺放資訊）。
- **Python CLI（tools/trace_sankey.py）直接移除**，連同 Mermaid／plotly 輸出與 `make draw/mermaid/html`。

## 新契約（README 要照這個寫）

```jsonc
{
  "apiVersion": "v1",                 // 選填，忽略
  "clusters": ["prod"],               // 選填，忽略
  "kind": "destination" | "source",   // 選填；否則看 investigation.direction（out→source）；預設 destination
  "investigation": {                  // 選填（我們的擴充）。沒給＝無錨卡、無 root
    "node_id": "sw-edge-a",           // 必須是 hop 型節點
    "iface": "xe-0/0/1", "delta_bps": 1e10,   // delta_bps > 0
    "direction": "in" | "out", "note": ""
  },
  "elements": {
    "nodes": [{ "data": {
      "id": "…", "type": "…",         // 必填；id 不可重複
      "name": "…",                    // 選填，卡片標題，缺就用 id
      "parent": "…",                  // 選填，群組鏈（namespace / application）
      "labels": { "namespace": "…", "tier": "…" },   // 選填，純字串對應表；tier＝同欄鎖（我們的擴充）
      "status": "normal|warning|critical",           // 選填；其他值視同沒有
      "usage": { "used_bytes": 0, "capacity_bytes": 0 },
      "health": "…", "hardware": {…}, "perf": {…}, "alerts": [...],
      "other_in_bps": 0, "other_out_bps": 0          // 我們的擴充，≥ 0，顯式殘差
    }}],
    "edges": [{ "data": {
      "id": "e1", "type": "network-flow" | "storage-flow",   // 其他 type 整條忽略
      "source": "…", "target": "…",                          // 一律封包方向
      "labels": { "tier": "…", "source_iface": "…", "target_iface": "…", "attribution": "split" },
      "metrics": { "delta_bps": 0, "read_bytes_per_sec": 0, "write_bytes_per_sec": 0,
                   "read_ops": 0, "write_ops": 0, "read_latency_us": 0, "write_latency_us": 0,
                   "max_iops": 0, "max_bytes_per_sec": 0 }
    }}]
  }
}
```

型別分三類（`model.js` 常數）：
- `HOP_TYPES = switch, node, pod, netapp-node, netapp-aggr, netapp-svm, pvc` → hop 盒（`kind:'node'`，`role = type`）。
- `GROUP_TYPES = namespace, application, cluster, storage-cluster, controller` → 不直接畫；只透過 `parent` 鏈推導 ns／app 終點卡。
- 其他任何 type（`host`、`router`…）→ 灰色「追查終止」葉卡。葉卡不能有「往下走」的 flow 邊
  （destination：無 out 邊；source：無 in 邊）→ 驗證錯誤。
- **葉 pod** = `type:"pod"` 且沒有往下走的 flow 邊 → pod 卡 ＋ 推導邊到 application／namespace；
  有往下走的邊 = proxy pod hop 盒（同現況，不接 ns）。
- pod 的 ns 解析順序：有 `application` 祖先 → app 卡，再取 app 的 `namespace` 祖先；否則 pod 的
  `namespace` 祖先；否則 `labels.namespace`；都沒有 → pod 卡不接 ns（合法，不報錯、不警告）。
- `tier:"pod-node"` 邊忽略；只被 pod-node 邊碰到的 `type:"node"` 節點靜默丟掉。
- 邊的 `labels.tier` 其他值（含缺）一律畫（我們的 switch 拓樸沒有 tier 詞彙；參考資料的合法 tier 自然通過）。
- `metrics` 有 `rate` 鍵 → 整個 metrics 忽略（RED 家族）→ 不畫。數值非有限數 → 該欄丟掉。
  `delta_bps`／`read_*`／`write_*` 負數 → 驗證錯誤（負殘差破圖那條規則）。
- 同 `(source, target, source_iface, target_iface)` 的多條邊 → bps 相加（取代舊「同 port 跨 hop 合併」）。
- 原始輸入裡一條可畫 flow 邊都沒接到的 hop 節點 → **no-flow 卡**（hop 盒、無槽位、無殘差、
  給了 other_*_bps 就警告並歸零）。門檻濾成孤兒的仍照 4b 移除。
- 全圖沒有任何可畫節點 → `{ok:false, errors:['圖上沒有任何可畫的節點。']}`（避免 render 算出 NaN viewBox）。
- `pruning` 從契約移除（出現就忽略）。顯示門檻套在**加總後**的 flow 邊；錨邊、推導的 pod→app／ns 邊豁免。

驗證（錯誤、不是丟棄）：最外層非物件；`elements`／`nodes`／`edges` 型別；節點缺 `id`／`type`、id 重複、
`labels` 不是純字串表、`other_*_bps` 負或非數、`usage` 非物件；邊缺 `id`／`type`／`source`／`target`、
id 重複、端點不存在、端點是 GROUP_TYPES、metrics 負數；葉型節點有往下走的邊；`investigation.node_id`
不存在或不是 hop 型；`kind`／`direction` 列舉；`status` 非法值**不**報錯（視同沒有）。

## 實作步驟（依序）

### 0. 基準
- `node tools/golden.mjs dump <scratch>/golden-before`（改碼前，舊碼＋舊 samples）。

### 1. 拋棄式轉換器（scratchpad，不進 repo）
`<scratch>/convert-old-to-new.mjs`：`convert(oldDoc) → newDoc`。規則：hop → `{id, type: role∈{node,pod}?role:'switch', name:label, labels:{tier, namespace}, other_in_bps, other_out_bps}`；
port → 邊 `e<i>`／`network-flow`／`metrics:{delta_bps}`／`labels.source_iface`／`target_iface`
（source 模式反接）；對端不在 hops → 葉節點 `{id: peerId||peerSwitchId, type: peerKind||'host', labels:{namespace}}`
（pod → `type:'pod'`）；`investigation` → `{node_id, iface, delta_bps, direction, note}`；`pruning` 丟掉。
**節點順序**：hop 依首次出現順序、葉依 port 發現順序；邊依 port 順序（配合 model 的 lazy-leaf 規則才能重現舊 `order`）。
用 `git show HEAD:packages/trace-sankey/src/samples.js` 拷到 scratchpad 供 `--samples` 模式讀。
跑遍 samples.js（9）、samples/*.json（9）、stress/*.json（5）。

### 2. `packages/trace-sankey/src/model.js`（核心）
- 常數 `HOP_TYPES`／`GROUP_TYPES`／`FLOW_TYPES`；helpers `classOf(type)`、`isStringMap`、`weightOf(metrics)`、
  `indexRaw(doc)`（id 索引 + `ancestorOf(id, type)`，**要帶 visited set**，parent 鏈可能成環／懸空）。
- `validate(doc)` 全部重寫（訊息表見上，繁中，README 對照表同步）。
- `direction(doc)`：`kind` 優先，再 `investigation.direction`；不變。
- `build()` 步驟 0–3 重寫，**4–7 保留**：
  - 0. `indexRaw`；`nsOfPod`／`appOf`。
  - 1a. 掃 `elements.edges`：非 FLOW_TYPES 跳過；`pod-node` 記 `podNodeTouch` 後跳過；記 `flowTouch`、
    方向計數 `contOut[src]++ / contIn[tgt]++`（不看 metrics）；`weightOf` 為 null → 跳過（統計進一則警告）；
    否則 `drawTouch` 並以 `src\0tgt\0sif\0tif` 為鍵**加總**進 `agg`（保留首次出現順序 `aggOrder`；attribution／extra 取先到值）。
  - 1b. 掃 `elements.nodes`：group 跳過；`node` 只被 pod-node 碰到 → 跳過；葉型與葉 pod **不在這裡建**（lazy）；
    其餘 `mkHop(data)` → `{id, label:name||id, role:type, kind:'node', tier:labels.tier||null,
    namespace: type==='pod' ? nsOfPod(id) : labels.namespace||null, otherInBps/otherOutBps, noFlow:!drawTouch[id],
    status, usage, info:{health,hardware,perf,alerts}, inEdges, outEdges, col:0}`。**沒有 `hopCount`／`portsOut`／`portsIn`**。
  - 2. 依 `aggOrder` 建邊：先做門檻（加總後的值；`dropOut[from]`／`dropIn[to]` 只記 hop 端）；
    `ensureLeaf(id, e, side)` 在第一條存活邊時才建葉並 push 進 `order`（`role: type==='pod'?'pod':'leaf'`，
    `iface`＝葉自己那側的 iface、`localIface`＝hop 側；多條邊 iface 不一致就留空）；`mkEdge` 多帶
    `type/attribution/extra`，端點是葉時 `namespace` 帶葉的 ns（tooltip `ns` 列不變）；
    `linkPod(pod, bps)`：**第一次**在 hop→pod 邊之後立刻建 pod→app（或 pod→ns）與 app→ns 推導邊
    （位置同舊 model.js 262-268，維持邊序＝z-order），之後同 pod 只 `+= bps`；`nsFor` 保留 `ns-N`，
    新增 `appFor` → `{id:'app-N', kind:'leaf', role:'app', label, namespace}`；source 模式全部反接。
  - 3. `if (inv)` 才建錨卡與 `anchorEdge`；回傳 `investigation: inv||null, root: root||null, anchorEdge: anchorEdge||null`，移除 `pruning`。
  - 4b：`if (n.noFlow) return true;` 豁免。
  - 6：noFlow 短路（traced/other/total 全 0、`resEps=1`）；**所有葉** `bps = sum(edges)`（單邊葉結果不變；
    campus 的 rtr-tanet 變單一多邊葉、app 卡需要）；ns／app 葉算 `podCount`（直接或經一層 app 到達的 pod 數）。
  - 1b 之後若 `order` 為空 → 回 `ok:false`。
  - 移除不再成立的警告（tier 衝突、port ns 標錯位、peerKind 衝突）。
- `fmtBytes(bytes)` 新 helper（usage 副標用），一併 export。

### 3. `packages/trace-sankey/src/render.js`、`tooltip.js`、`styles/trace-sankey.css`
- `layout()`：槽位重排 guard 加 `role!=='app'`；`headerH(n) = HEADER_H + (n.usage ? 12 : 0)` 取代
  render.js:95／207-208／444-445 四處的固定 `HEADER_H`。
- `render()` meta：只在有值時加 `type`／`attr`／`extra`（缺就 `undefined`，stringify 會丟掉 → 舊輸出不變）；
  leaf dispatch 加 `role==='app'`。
- `nodeBox`：外框色優先序 **status(critical `#fb7185` / warning `#f59e0b`) > isRoot `#22d3ee` > k8s > 預設**，
  `isRoot` 仍決定 stroke-width 1.8；刪 `×N hop 合併` tspan；副標在 `switch/node/pod` 以外的 type 加 ` · <type>`；
  有 usage 就在 y+41 畫「使用 X / Y (N%)」並把分隔線移到 `headerH-6`；有 health/hardware/perf/alerts 就在 `<g>` 第一個子節點
  輸出 `<title>`（tooltip.js 只剝 `.band` 內的 title，盒子的會留著）。
- `podCard`：`namespace` 為 null 時跳過 ns 行、iface 行上移；`leafH` 對應 70。
- `nsCard` → `groupCard(n, model, nsColor, word)`；`nsCard = groupCard(…,'namespace')`（byte-identical）、
  `appCard = groupCard(…,'application')`；「N 個 pod」改讀 `n.podCount`（render.js:527、:605）。
- `colCaption`：錨欄判定改 `kinds.anchor && col.length===1`（避免 no-flow 節點混進去被標成「追查起點」）；
  整欄 app → `第 N 跳 · application`；整欄同一非 switch type → `第 N 跳 · <type>`（現有 k8s node 文案不變）。
- `anchorCard`：讀 `inv.delta_bps`。`summary()`：刪 hopCount 欄位字樣。
- `tooltip.js`：`ns` 列之後條件式加 `type`、`attribution`、`extra` 各鍵（ops／latency／max_*）列；沒有就不輸出。
- CSS：不必新增變數（render 顏色是硬編碼，見 CLAUDE.md §8 雙份定義的說明）。

### 4. 資料
- `src/samples.js`：9 個範例貼轉換器輸出（保留 `G()`、註解、desc，dci-uturn 的 IIFE 改吐 `elements`），
  另加第 10 個 `storage`：參考文件 §7 最小範例＋ `status: "warning"`、`usage`、一個 `application` 群組，
  展示新功能；`defaultKey` 仍 `classic`。`types/samples.d.ts` 型別名跟著改。
- `samples/*.json`：轉換器輸出覆蓋（仍是 samples.js 的檔案雙胞胎，golden 與拖放測試用；§11.1 重複維護不變）。
- `stress/gen.py`：`build()` 改回傳 `(nodes, edges)`，輸出新格式；刪 `--top-n`；重生 5 支：
  `--depth 3/4/5 --fan 3`、`--chain 16 --fan 6`、`--depth 6 --fan 4`（皆 `--gbps 64`），指令寫進 `stress/README.md`。
  重生檔與轉換器輸出 build 後應相同（順便驗 gen.py）。

### 5. 移除 CLI、工具與 Makefile
- 刪 `tools/trace_sankey.py`。`Makefile`：刪 `PYTHON/CLI/FILE/KIND/OUT`、`draw/mermaid/html`、help 文案、
  `clean` 的 `$(OUT)`；`check` 改 `node tools/golden.mjs check`（build 全部範例，任何 `ok:false` 即失敗）。
- `tools/golden.mjs`：刪 `loadLegacy`（assets/js 早已不存在）；加 `check` 子命令共用 `inputs()`。
- `.dockerignore` 的 `__pycache__`／`out.html` 留著無害。

### 6. 型別與 app
- `types/index.d.ts`：`TracePort/TraceHop/TraceInvestigation/TraceDoc` 換成 `WireGraph/WireNodeData/WireEdgeData/WireIoMetrics/WireInvestigation`；
  `TraceNode.kind` 改 `'node'|'leaf'|'anchor'`（現在就寫錯）、`TraceEdge` 改 `fromId/toId`；`TraceModelOk` 的
  `investigation/root/anchorEdge` 改 `| null`、刪 `pruning`。
- `app/src/useTraceDoc.js`：只改錯誤標題文案（「不合追查 JSON 契約」→ 提到 elements 格式）。舊格式的 localStorage
  內容會被 `validate` 擋掉、靜默退回內建範例（可接受）。`App.jsx` 不讀 doc 欄位，不用改；圖例若要可加
  「status 外框色」一行（選做）。

### 7. 文件
- `README.md`：快速開始拿掉 `make draw`；§輸入 JSON 規格（347–558）整段重寫成上面契約＋新錯誤對照表＋警告清單；
  「追查方向」拿掉 outputs/inputs 敘述；「守恆與殘差」改欄位名 `other_in_bps/other_out_bps`；「畫法」加 application 卡、
  status 外框、usage 副標、no-flow 卡；刪 `## CLI` 整章與 Mermaid 句；檔案清單刪 CLI、samples 說明更新。
- `CLAUDE.md`：§1（CLI／pruning 句）、§2（刪 Python 條目、Makefile target 列表）、§3 樹、§5 整段、§6 步驟 1–3 與回傳形狀、
  §9 整段刪除、§10 `make check` 說明、§11 第 1、3、4、5、8 條。
- 注意：遠端分支 `origin/feat/api-trace-query` 也改 README／CLAUDE／useTraceDoc，合併會衝突。

## 既有工具可重用
- `nsFor`（model.js:196）、`mkEdge`（:536）、步驟 4–7 全部、`sum()`。
- render：`nsCard` 當 `groupCard` 底、`leafCard`／`podCard` 的 ns 色條、`colCaption` 分支。
- `tools/golden.mjs` 的 `inputs()`／dump 流程。

## 驗證
1. **golden 對拍**：改完＋換好資料後 `node tools/golden.mjs dump <scratch>/golden-after`，`diff -r` 對 before。
   **只允許**這些差異：`sample-dual-uplink.*`／`samples-dual-uplink.*`（少了 `×2 hop 合併`／`(合併 2 hop)` 字樣）、
   `sample-campus.*`／`samples-campus.*`（rtr-tanet 兩張葉卡併成一張多邊葉）。其餘含全部 `stress-*` 與
   `*.min500000000.*` 必須 byte-identical；`warnings.json` 全部相同。`data-tip` 有差＝新 meta 鍵沒用 `undefined` 漏出來。
2. `make check`（新版）：所有內建範例＋samples/＋stress/ build 皆 `ok:true`。
3. 參考文件 §7 最小範例原封不動丟進 `build()` → `ok:true`，畫出 netapp-node→aggr→svm→pvc→pod→namespace 六欄，
   aggr 有 usage 副標。再加 `status:"critical"`、application 群組、一條沒 metrics 的邊、一條 `pod-node` 邊、
   一個只被 pod-node 碰到的 `node` → 分別驗證外框色、app 卡、不畫、忽略、靜默丟掉。
4. 錯誤路徑：舊格式檔 → 錯誤橫幅列出新訊息；空 `elements.nodes` → 「圖上沒有任何可畫的節點」；parent 成環不卡死。
5. `make dev` 用 playwright／瀏覽器實測：拖入新格式 JSON、門檻調整仍守恆、StrictMode 下 body 只留一個 tooltip、
   hover 帶子看到 attribution／latency 列、no-flow 卡不會被門檻 pill 算成「隱藏 1 台」。
6. `make build` 通過（Vite）。
