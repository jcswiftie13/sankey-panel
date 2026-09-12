| investigation.node_id 必填。／investigation.delta_bps 必須是正數（bps）。 | 還在用 deprecated 的頂層寫法且 `switchId`／`deltaBps` 沒改名；直接改成第 9 節的節點寫法 |
| 頂層 investigation 與 nodes[i].data.investigation 兩處都給了… | 搬進節點後忘了刪頂層 |# 從舊格式遷移到 elements wire JSON

這份文件講怎麼把舊的 `investigation + hops[].outputs/inputs` 追查 JSON **手動**改成新的
`elements.nodes / elements.edges` 格式。新版**只擋不轉**：載入舊檔會直接報「缺少 elements」。
沒有內建轉換腳本——規則不多，照下面的表逐欄改就好；改完拖進網頁，驗證訊息會告訴你漏了什麼。

新契約的完整說明在 [README「輸入 JSON 規格」](../README.md#輸入-json-規格)。

## 1. 為什麼要換

新格式與參考面板（kube-state-graph-frontend 的 Storage Flow Sankey）吃同一份 cytoscape-style wire JSON，
同一份資料兩邊都能畫；節點與邊變成一等公民（有自己的 id、type、labels），不再把對端藏在 port 裡。
舊格式的每個概念都有對應位置，沒有東西會丟——除了 `pruning`（純註記，新版直接忽略）。

## 2. 一眼對照

```
舊                                            新
{                                             {
  kind, investigation{switchId,deltaBps,…},     kind, investigation{node_id,delta_bps,…},   ← 選填了
  pruning{…},                                   （丟掉）
  hops: [                                       elements: {
    { switchId, label, role, tier, namespace,     nodes: [ { data: { id, name, type, labels{tier,namespace}, other_*_bps } }, … ],
      otherInBps, otherOutBps,                    edges: [ { data: { id, type:"network-flow", source, target,
      outputs: [ { iface, deltaBps,                                   labels{source_iface,target_iface},
                   peerSwitchId|peerId,                               metrics{delta_bps} } }, … ]
                   peerIface, peerKind, namespace } ] }   }
  ]                                           }
}
```

一句話：**每個 hop 變一個 node、每個 port 變一條 edge、每個對端（不管接不接下去）都變一個 node**。

## 3. 欄位對照表

### 頂層

| 舊 | 新 | 備註 |
| --- | --- | --- |
| `kind` | `kind` | 不變 |
| `investigation` | `investigation` | 欄位改名（下表）；新版**選填**，沒給就沒有錨卡 |
| `pruning` | — | 丟掉。出現也不會報錯，只是被忽略 |
| `hops[]` | `elements.nodes[]` ＋ `elements.edges[]` | 一個 hop 拆成一個 node 與 N 條 edge |

### `investigation`

| 舊 | 新 | 備註 |
| --- | --- | --- |
| `switchId` | `node_id` | 必須是 hop 型節點（switch／node／pod／netapp-*／pvc）的 id |
| `deltaBps` | `delta_bps` | 仍須 > 0 |
| `iface`、`direction`、`note` | 同名 | 不變 |

### `hops[]` → `nodes[].data`

| 舊 | 新 | 備註 |
| --- | --- | --- |
| `switchId` | `id` | **不可重複**（見規則 3） |
| `label` | `name` | 缺就用 id 當標題 |
| `role` | `type` | `"node"`／`"pod"` 原樣；**其他值一律 `"switch"`**（舊的 `core`／`border`／`spine`／`tor` 註記本來就畫成一般 switch） |
| `tier` | `labels.tier` | 同欄鎖，語意不變 |
| `namespace` | `labels.namespace` | proxy pod 的 ns；也可以改用 `parent` 鏈接到 `type:"namespace"` 的群組節點 |
| `otherInBps` | `other_in_bps` | 仍須 ≥ 0 |
| `otherOutBps` | `other_out_bps` | 仍須 ≥ 0 |
| `outputs[]`／`inputs[]` | → `edges[]` | 見下表 |

### port（`outputs[]`／`inputs[]` 的元素）→ `edges[].data`

| 舊 | 新 | 備註 |
| --- | --- | --- |
| — | `id` | **自己編**，不可重複（`e0`、`e1`… 就好） |
| — | `type` | 一律 `"network-flow"` |
| （本機 hop） | `source`／`target` 之一 | 追終點：本機是 `source`；追來源：本機是 `target`（規則 1） |
| `peerSwitchId`／`peerId` | `target`／`source` 之一 | 對端 id；對端**一定要在 `nodes` 裡**（規則 2） |
| `deltaBps` | `metrics.delta_bps` | 仍須 ≥ 0 |
| `iface` | `labels.source_iface`（追終點）／`labels.target_iface`（追來源） | 本機那一側的 iface。沒有就整個鍵不寫 |
| `peerIface` | `labels.target_iface`（追終點）／`labels.source_iface`（追來源） | 對端那一側的 iface。沒有就不寫，不猜 |
| `peerKind` | 對端節點的 `type` | `"pod"` → `type:"pod"`；`"switch"` 對端若也是 hop 就是那個 hop 的 type；沒給就 `"host"` |
| `namespace`（port 上的） | 對端節點的 `labels.namespace` | 標在對端 node 上，不再標在邊上 |

## 4. 表格講不完的五條規則

1. **方向：邊一律照封包方向寫。** 舊格式 `outputs` 是「本機 → 對端」，直接變 `source: 本機, target: 對端`；
   `inputs` 是「對端 → 本機」，要**反接**成 `source: 對端, target: 本機`，iface 跟著對調
   （port 的 `iface` 變 `target_iface`、`peerIface` 變 `source_iface`）。`kind:"source"` 照樣保留，
   追查方向由它決定，不由邊決定。

2. **對端節點要自己建。** 舊格式的葉（host、router、pod…）只靠 port 上的 `peerId`／`peerKind` 隱含存在；
   新格式的每條邊 `source`／`target` 都必須在 `nodes` 裡找得到。對端不接下去的就補一個
   `{ "data": { "id": "<peerId>", "type": "<peerKind 或 host>" } }`；pod 再加 `labels.namespace`。

3. **同 `switchId` 出現多次的 hop 要自己合併成一個 node。** 新格式 id 不可重複。
   `otherInBps`／`otherOutBps` 相加，`label`／`tier` 取先出現的；它的 port 各自變成邊即可。

4. **同 `(iface, peer)` 的 port 拆在多個 hop 寫的**：新格式會依 `(source, target, source_iface, target_iface)`
   自動加總，所以可以留成多條邊，也可以自己先加好寫成一條——結果一樣。

5. **`role` 的自由字串註記**（`core`／`border`／`spine`／`tor`）：新格式的 `type` 一樣是自由字串，
   但只有 hop／群組／葉三類語意，不認得的值會變成**葉卡**。所以這些註記一律改成 `"switch"`；
   真的要區分層級，用 `labels.tier` 鎖同欄，或用 `name` 標。

## 5. 完整前後對照

### 5a. `samples/classic.json`（最小 switch 追查）

舊：

```json
{
  "kind": "destination",
  "investigation": { "switchId": "sw-edge-a", "iface": "xe-0/0/1", "direction": "in", "deltaBps": 10000000000,
                     "note": "Edge A 的 access port 進來 +10 Gbps" },
  "pruning": { "topN": 3, "minShare": 0.1 },
  "hops": [
    { "switchId": "sw-edge-a", "label": "Edge A", "role": "switch",
      "outputs": [ { "iface": "et-0/0/48", "deltaBps": 20000000000,
                     "peerKind": "switch", "peerSwitchId": "sw-core-1", "peerIface": "et-1/0/1" } ] },
    { "switchId": "sw-core-1", "label": "Core 1", "role": "switch",
      "outputs": [ { "iface": "et-1/0/9", "deltaBps": 20000000000,
                     "peerKind": "host", "peerId": "srv-db-07", "peerIface": "eno1" } ] }
  ]
}
```

新：

```json
{
  "kind": "destination",
  "investigation": { "node_id": "sw-edge-a", "iface": "xe-0/0/1", "delta_bps": 10000000000, "direction": "in",
                     "note": "Edge A 的 access port 進來 +10 Gbps" },
  "elements": {
    "nodes": [
      { "data": { "id": "sw-edge-a", "type": "switch", "name": "Edge A" } },
      { "data": { "id": "sw-core-1", "type": "switch", "name": "Core 1" } },
      { "data": { "id": "srv-db-07", "type": "host" } }
    ],
    "edges": [
      { "data": { "id": "e0", "type": "network-flow", "source": "sw-edge-a", "target": "sw-core-1",
                  "labels": { "source_iface": "et-0/0/48", "target_iface": "et-1/0/1" },
                  "metrics": { "delta_bps": 20000000000 } } },
      { "data": { "id": "e1", "type": "network-flow", "source": "sw-core-1", "target": "srv-db-07",
                  "labels": { "source_iface": "et-1/0/9", "target_iface": "eno1" },
                  "metrics": { "delta_bps": 20000000000 } } }
    ]
  }
}
```

注意：`pruning` 丟了；`srv-db-07` 從 port 裡的 `peerId` 變成一個真的節點（規則 2）。

### 5b. `samples/k8s.json`（省略 iface 的 port、node 當葉、pod → ns、混入的非 k8s host）

舊：

```json
{
  "kind": "destination",
  "investigation": { "switchId": "sw-tor-k8s", "iface": "et-0/0/48", "direction": "in", "deltaBps": 30000000000 },
  "hops": [
    { "switchId": "sw-tor-k8s", "label": "ToR k8s", "role": "switch",
      "outputs": [
        { "iface": "xe-0/0/11", "deltaBps": 14000000000, "peerKind": "node", "peerSwitchId": "node-w-11", "peerIface": "bond0" },
        { "iface": "xe-0/0/12", "deltaBps": 8000000000,  "peerKind": "node", "peerSwitchId": "node-w-12", "peerIface": "bond0" },
        { "iface": "xe-0/0/13", "deltaBps": 5000000000,  "peerKind": "node", "peerSwitchId": "node-w-13", "peerIface": "bond0" },
        { "iface": "xe-0/0/20", "deltaBps": 3000000000,  "peerKind": "host", "peerId": "srv-log-01", "peerIface": "eno1" } ] },
    { "switchId": "node-w-11", "role": "node", "otherOutBps": 2500000000,
      "outputs": [
        { "iface": "veth3a1f", "deltaBps": 8000000000, "peerKind": "pod", "peerId": "ingest-7d9c", "namespace": "telemetry" },
        { "iface": "veth9b02", "deltaBps": 3500000000, "peerKind": "pod", "peerId": "kafka-2", "namespace": "stream" } ] },
    { "switchId": "node-w-12", "role": "node",
      "outputs": [
        { "deltaBps": 5500000000, "peerKind": "pod", "peerId": "ingest-4f11", "namespace": "telemetry" },
        { "deltaBps": 2500000000, "peerKind": "pod", "peerId": "debug-shell", "namespace": "debug" } ] },
    { "switchId": "node-w-13", "role": "node" }
  ]
}
```

新：

```json
{
  "kind": "destination",
  "investigation": { "node_id": "sw-tor-k8s", "iface": "et-0/0/48", "delta_bps": 30000000000, "direction": "in" },
  "elements": {
    "nodes": [
      { "data": { "id": "sw-tor-k8s", "type": "switch", "name": "ToR k8s" } },
      { "data": { "id": "node-w-11", "type": "node", "name": "node-w-11", "other_out_bps": 2500000000 } },
      { "data": { "id": "node-w-12", "type": "node", "name": "node-w-12" } },
      { "data": { "id": "node-w-13", "type": "node", "name": "node-w-13" } },
      { "data": { "id": "srv-log-01", "type": "host" } },
      { "data": { "id": "ingest-7d9c", "type": "pod", "labels": { "namespace": "telemetry" } } },
      { "data": { "id": "kafka-2", "type": "pod", "labels": { "namespace": "stream" } } },
      { "data": { "id": "ingest-4f11", "type": "pod", "labels": { "namespace": "telemetry" } } },
      { "data": { "id": "debug-shell", "type": "pod", "labels": { "namespace": "debug" } } }
    ],
    "edges": [
      { "data": { "id": "e0", "type": "network-flow", "source": "sw-tor-k8s", "target": "node-w-11",
                  "labels": { "source_iface": "xe-0/0/11", "target_iface": "bond0" }, "metrics": { "delta_bps": 14000000000 } } },
      { "data": { "id": "e1", "type": "network-flow", "source": "sw-tor-k8s", "target": "node-w-12",
                  "labels": { "source_iface": "xe-0/0/12", "target_iface": "bond0" }, "metrics": { "delta_bps": 8000000000 } } },
      { "data": { "id": "e2", "type": "network-flow", "source": "sw-tor-k8s", "target": "node-w-13",
                  "labels": { "source_iface": "xe-0/0/13", "target_iface": "bond0" }, "metrics": { "delta_bps": 5000000000 } } },
      { "data": { "id": "e3", "type": "network-flow", "source": "sw-tor-k8s", "target": "srv-log-01",
                  "labels": { "source_iface": "xe-0/0/20", "target_iface": "eno1" }, "metrics": { "delta_bps": 3000000000 } } },
      { "data": { "id": "e4", "type": "network-flow", "source": "node-w-11", "target": "ingest-7d9c",
                  "labels": { "source_iface": "veth3a1f" }, "metrics": { "delta_bps": 8000000000 } } },
      { "data": { "id": "e5", "type": "network-flow", "source": "node-w-11", "target": "kafka-2",
                  "labels": { "source_iface": "veth9b02" }, "metrics": { "delta_bps": 3500000000 } } },
      { "data": { "id": "e6", "type": "network-flow", "source": "node-w-12", "target": "ingest-4f11",
                  "metrics": { "delta_bps": 5500000000 } } },
      { "data": { "id": "e7", "type": "network-flow", "source": "node-w-12", "target": "debug-shell",
                  "metrics": { "delta_bps": 2500000000 } } }
    ]
  }
}
```

注意：

- port 上的 `namespace` 搬到 pod 節點的 `labels.namespace`；四個 pod 都是新建的節點。
- 沒有 iface 的邊就不寫 `labels`（`e6`、`e7`），只有一側有就只寫那一側（`e4`、`e5`）。
- `node-w-13` 沒有任何往下的邊 → 仍然是「node 當葉」，進來的 5G 由平衡式補成其他輸出。

追來源（`kind:"source"`）的檔案照規則 1 反接：舊 `inputs` 裡的 `{ iface: "et-1/0/1", peerSwitchId: "sw-edge-a",
peerIface: "et-0/0/48" }`（本機 `sw-core-1`）變成
`{ source: "sw-edge-a", target: "sw-core-1", labels: { source_iface: "et-0/0/48", target_iface: "et-1/0/1" } }`。
`samples/source.json` 與 `samples/k8s-source.json` 都是這樣改的。

## 6. 遷移後會不一樣的地方

三處畫面差異，都是格式語意改了的自然結果，不是 bug：

1. **`×N hop 合併` 字樣消失**：新格式一個 id 就是一個節點，沒有「同一台出現幾次」的概念
   （`samples/dual-uplink.json`）。
2. **同一個對端 id 出現在不同 hop 的 port 上**：舊格式畫成多張葉卡（每個 port 一張），
   新格式合併成**一張多邊葉卡**，卡上的 iface 因為多條邊不一致而留空、數字是總量
   （`samples/campus.json` 的 `rtr-tanet`）。要維持多張卡，就給不同的 id。
3. **`pruning` 註記不再顯示**。

其他一切（欄位、帶寬、殘差、回流、tier 弧帶、門檻）逐 byte 相同——這是用 `tools/golden.mjs`
在 9 個內建範例與 5 個 stress 檔上對拍過的。

## 7. 手動遷移檢查清單

- [ ] 每個 node 的 `id` 唯一；同一台在舊檔出現多次的已合併（規則 3）
- [ ] 每條 edge 的 `source`／`target` 都在 `nodes` 裡（規則 2：葉也要建）
- [ ] 每條 edge 有 `id`（唯一）與 `type: "network-flow"`
- [ ] 追來源檔案的邊已反接、iface 已對調（規則 1）
- [ ] 追查起點寫在起點節點的 `data.investigation`（沒有 `node_id`），那個節點是 hop 型（`switch`／`node`／`pod`／`netapp-*`／`pvc`）；頂層 `investigation` 已 deprecated（見第 9 節）
- [ ] `role` 的自由字串已改成 `"switch"`（規則 5）；要鎖同欄的改用 `labels.tier`
- [ ] pod 葉的 ns 放在 pod 節點的 `labels.namespace`（或 `parent` 鏈）
- [ ] `other_in_bps`／`other_out_bps` 非負
- [ ] `pruning` 已刪（留著也無害）

## 8. 常見錯誤訊息 → 通常是漏了哪一步

| 訊息 | 漏了 |
| --- | --- |
| 缺少 elements（必須是物件，含 nodes 與 edges 陣列）。 | 整份還是舊格式；從第 3 節開始 |
| investigation.node_id 必填。／investigation.delta_bps 必須是正數（bps）。 | `switchId`／`deltaBps` 沒改名 |
| nodes[i].data.id「X」重複。 | 規則 3：同一台多次出現要合併 |
| edges[i].data.target「X」在 nodes 裡找不到。 | 規則 2：對端（葉）沒建成節點 |
| edges[i].data.source「X」在 nodes 裡找不到。 | 追來源檔案：對端在 `source` 側，也要建節點 |
| edges[i]：「X」（type: core）不是 hop 型節點，畫成追查終止葉卡，不能再有往下走的 flow 邊… | 規則 5：`role` 的註記沒改成 `"switch"`，被當成葉了 |
| edges[i].data.id／type／source／target 必填（非空字串）。 | 邊忘了編 `id` 或忘了 `type` |
| nodes[i] 必須是 { data: {...} } 物件。 | 節點忘了包一層 `data` |
| investigation.node_id「X」在 nodes 裡找不到。 | 起點那台的 id 打錯或沒建 |

全部訊息的意思見 [README「驗證錯誤對照」](../README.md#驗證錯誤對照)。

## 9. 追查起點從頂層搬進起點節點的 `data`

頂層的 `investigation` 是這份契約裡**唯一放在 `elements` 外面的資訊**：同一份文件丟給 cytoscape
（只吃 `elements`）就看不到起點。現在起點寫在起點節點自己的 `data.investigation`，
節點本身就是起點，所以 `node_id` 不再需要：

```jsonc
// 舊（deprecated，仍接受，build 會發一則警告）
{ "kind": "destination",
  "investigation": { "node_id": "sw-edge-a", "iface": "xe-0/0/1", "delta_bps": 10000000000, "direction": "in" },
  "elements": { "nodes": [ { "data": { "id": "sw-edge-a", "type": "switch", "name": "Edge A" } }, … ] } }

// 新
{ "kind": "destination",
  "elements": { "nodes": [
    { "data": { "id": "sw-edge-a", "type": "switch", "name": "Edge A",
                "investigation": { "iface": "xe-0/0/1", "delta_bps": 10000000000, "direction": "in" } } }, … ] } }
```

- 兩種寫法畫出來**逐 byte 相同**（`make check` 會把每份範例程式化搬回頂層形式再比對）。
- 兩處都寫是驗證錯誤「請只留節點那一份」——遷移失誤要明確，不挑一個。
- 全圖最多一個節點帶 `investigation`，且必須是 hop 型；被丟掉的 k8s node（只被 `pod-node` 邊碰到）不能當起點。
- `kind` 仍在頂層（選填、由 `direction` 推得）；cytoscape 忽略它沒有資訊損失。
