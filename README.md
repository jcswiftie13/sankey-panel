# Interface Increment 追查 Sankey

讀入一份規範格式的追查 JSON，畫成守恆的 Sankey。

追一台 switch 的 interface increment 時，一跳可能有多條 uplink，所以下游看到的 out 增加
可以大於你剛追進來的那一條 in（A→B 10G，B→C 20G）。這個工具把那個現象畫出來，
但不會暗示流量是這台 switch 憑空生出來的——多出來的量一律用「其他輸入／其他輸出」補齊，
讓圖在視覺上守恆。

只有一種讀圖方式：**平衡 Sankey**。圖上與 tooltip 的數字一律是**你實際量到的速率增量 Δ**，
沒有任何推估值：bps 本身就是「每秒多少 bit」的速率，increment 是這個速率的差，所以數字帶 `+` 號。
不另外做一張只畫貢獻的圖。

不做的事：不自動偵測 switch／counter、不掃網、沒有帳號與資料庫、不上傳你的 JSON、
不把追來源畫成整張圖左右鏡射。

## 快速開始

純靜態，沒有 build step，只需要 `python3`。

```bash
git clone <repo> && cd sankey-panel

make serve                    # http://127.0.0.1:8765/index.html
make open                     # 順便開瀏覽器
make demo                     # 不開 server，直接 file:// 開，離線可用
make draw FILE=my-trace.json  # 不開瀏覽器，CLI 文字報告
make help                     # 所有 target
```

沒有 `make` 也行：

```bash
python3 -m http.server 8765 --bind 127.0.0.1
# 或直接用瀏覽器開 index.html（file://）
```

`file://` 也能用：全部是傳統 `<script>`，沒有 module、沒有 `fetch`。

### 三條載入路徑

| 方式 | 怎麼做 |
| --- | --- |
| 開檔 | 按「開啟 JSON 檔…」，選一份 `.json` |
| 拖放 | 把 `.json` 拖進頁面，放開就畫 |
| 範例 | 點「範例展示」的 chip，看內建示範資料 |

載入的檔案只在瀏覽器裡讀（`FileReader`），不會送到任何地方。內容存在 `localStorage`，
重新整理還在；按 JSON 分頁的「還原範例」就清掉。

分頁與範例狀態在 query string，控制項是真的 `<a href>`：

```
index.html?sample=campus&tab=chart
```

| 參數 | 值 |
| --- | --- |
| `sample` | `classic` `dual-uplink` `campus` `pruned` `source` `k8s` `k8s-source` `dci-tier` `dci-uturn`（`custom` = 你載入的那份） |
| `tab` | `chart` `json` `mermaid-sankey` `mermaid-flow` `notes` |

## 看圖：縮放與平移

switch 與 interface 一多，圖就會遠大於畫面。圖區是一塊固定尺寸的畫布，
內容在裡面縮放平移，不再靠捲軸：

| 操作 | 動作 |
| --- | --- |
| 滾輪／觸控板雙指 | 以游標為中心縮放（不會捲到頁面） |
| 按住拖曳 | 平移 |
| `＋` `−` | 放大／縮小一格 |
| `0` | 符合視窗（整張圖塞進畫布） |
| `1` | 1:1 原始大小 |
| `F` | 專注模式：收起頁首與控制列，圖填滿整個視窗；`Esc` 離開 |

右下角的工具列有同樣的按鈕，中間顯示目前倍率（`100%`＝原始大小，點一下回到 1:1）。

開場是「符合視窗，但不放大超過原始大小」——小圖維持原尺寸，大圖才縮到看得見全貌。
換一份資料會重新回到這個開場視角；只是切分頁再切回來則會保留你的縮放。
縮放狀態刻意不進 query string（滾一格就推一筆瀏覽紀錄會很難用）。

## 輸入 JSON 規格

單位一律是 **bps**（10 Gbps 寫成 `10000000000`）。網頁與 CLI 吃同一份契約。

### 頂層

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `investigation` | object | ✔ | 你看到增加的那個 counter |
| `hops` | array | ✔ | 非空。每一跳一筆；同一台 switch 可以出現多次 |
| `kind` | `"destination"` \| `"source"` | | 追查方向。沒給就看 `investigation.direction`，再沒給就當 `destination` |
| `pruning` | object | | 只是註記你當初怎麼截斷的，會顯示在圖上方；工具本身不會幫你截斷 |

### `investigation`

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `switchId` | string | ✔ | 必須在 `hops` 裡找得到同一個 `switchId` |
| `iface` | string | ✔ | 你看到增加的那條 interface |
| `deltaBps` | number > 0 | ✔ | 速率增量 Δ，bps |
| `direction` | `"in"` \| `"out"` | | `in` = 追終點，`out` = 追來源。`kind` 優先 |
| `note` | string | | 一句話備註，顯示在 CLI 報告 |

### `pruning`

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `topN` | number | 你每層只跟了前幾名 |
| `minShare` | number 0–1 | 你每層的佔比門檻，`0.1` = 10% |

### `hops[]`

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `switchId` | string | ✔ | 合併鍵。同一個 id 出現多次會**合併成一個盒子**，不畫成兩台 |
| `label` | string | | 顯示名稱，沒給就用 `switchId` |
| `role` | string（非空） | | 自由字串。繪製只認 `node`（天藍虛線盒，k8s node）與 `pod`（pod 當中繼 hop 時用），**其他值一律畫成一般 switch 盒**（範例拿 `core`／`border` 等當註記）。預設 `switch` |
| `namespace` | string（非空） | `role:"pod"` ✔ | `role: "pod"` 的中繼 hop **必填**（pod 一定屬於某個 ns），顯示在盒副標與匯出 |
| `tier` | string（非空） | | 同層標籤。同 `tier` 的 hop **鎖在同一欄**，彼此之間的邊畫成右側弧帶；字串內容自訂，程式只比對相同與否。見下方「同層互連（tier）」 |
| `outputs` | array of port | 追終點 | 跟下去的出口 |
| `inputs` | array of port | 追來源 | 往回追的入口 |
| `otherInBps` | number ≥ 0 | | 顯式的其他輸入。不給就由平衡式補 |
| `otherOutBps` | number ≥ 0 | | 顯式的其他輸出。不給就由平衡式補 |

### port（`outputs[]` / `inputs[]` 的元素）

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `iface` | string | switch hop ✔ | 本機這一側的 interface。`role: "node"` / `"pod"` 的 hop **可省略**（k8s 內部沒有 switch interface；有 veth／bond 名想記的照填），**省略時必須給 `peerSwitchId` 或 `peerId`**。沒填的 port 槽位不印 iface 字樣 |
| `deltaBps` | number ≥ 0 | ✔ | 這條的速率增量 Δ，bps |
| `peerSwitchId` | string | | 對端 switch／node 的 id |
| `peerId` | string | | 對端不是 switch 時用（host / router / pod） |
| `peerIface` | string | | 對端那一側的 interface。對端 iface 只由這裡決定，沒填就留空、不猜 |
| `peerKind` | string（非空） | | 自由字串註記；**唯一有語意的值是 `pod`**（畫成 pod 中繼卡、流量匯進 ns 終點），其他值畫一般灰葉 |
| `namespace` | string（非空） | `peerKind:"pod"` ✔ | `peerKind: "pod"` 且對端不在 `hops`（即將畫成 pod 卡）時**必填**——pod 流量自動匯進這個 ns 的終點節點。其他葉有給就顯示 `ns/<namespace>`。同 ns 的 pod **在同一欄相鄰排列、左緣掛同色 ns 色條**（色盤依首次出現順序取色、超過 5 個循環）。標在「對端已接進 hops」的 port 上不會標在盒上（會警告），請改標在該 hop |

對端接不接下去，看的是 `peerSwitchId`（沒有就看 `peerId`）**在 `hops` 裡有沒有同 id 的那一跳**：
有就接成下一台，沒有就畫成灰色「追查終止」小卡。

### 追終點（destination）

```json
{
  "kind": "destination",
  "investigation": {
    "switchId": "sw-edge-a", "iface": "xe-0/0/1",
    "direction": "in", "deltaBps": 10000000000
  },
  "pruning": { "topN": 3, "minShare": 0.1 },
  "hops": [
    {
      "switchId": "sw-edge-a", "label": "Edge A", "role": "switch",
      "outputs": [
        { "iface": "et-0/0/48", "deltaBps": 20000000000,
          "peerKind": "switch", "peerSwitchId": "sw-core-1", "peerIface": "et-1/0/1" }
      ]
    },
    {
      "switchId": "sw-core-1", "label": "Core 1", "role": "switch",
      "outputs": [
        { "iface": "et-1/0/9", "deltaBps": 20000000000,
          "peerKind": "host", "peerId": "srv-db-07", "peerIface": "eno1" }
      ]
    }
  ]
}
```

Edge A 只追進來 10G 卻出去 20G，缺的 10G 會自動變成 Edge A 的「其他輸入」。

### 追來源（source）

```json
{
  "kind": "source",
  "investigation": {
    "switchId": "sw-core-1", "iface": "et-1/0/9",
    "direction": "out", "deltaBps": 20000000000
  },
  "hops": [
    {
      "switchId": "sw-core-1", "label": "Core 1",
      "inputs": [
        { "iface": "et-1/0/1", "deltaBps": 12000000000,
          "peerKind": "switch", "peerSwitchId": "sw-edge-a", "peerIface": "et-0/0/48" }
      ]
    },
    {
      "switchId": "sw-edge-a", "label": "Edge A",
      "otherInBps": 2000000000,
      "inputs": [
        { "iface": "xe-0/0/1", "deltaBps": 7000000000,
          "peerKind": "host", "peerId": "lab-gpu-01", "peerIface": "eno1" }
      ]
    }
  ]
}
```

### k8s（node / pod / namespace）

edge switch 接的是 k8s node 時，同一條 Sankey 直接接下去（完整版在 `samples/k8s.json`）：

```jsonc
{
  "kind": "destination",
  "investigation": { "switchId": "sw-tor-k8s", "iface": "et-0/0/48", "direction": "in", "deltaBps": 30000000000 },
  "hops": [
    { "switchId": "sw-tor-k8s", "label": "ToR k8s", "role": "switch",
      "outputs": [
        { "iface": "xe-0/0/11", "deltaBps": 14000000000, "peerKind": "node", "peerSwitchId": "node-w-11", "peerIface": "bond0" },
        { "iface": "xe-0/0/12", "deltaBps": 8000000000,  "peerKind": "node", "peerSwitchId": "node-w-12", "peerIface": "bond0" },
        { "iface": "xe-0/0/13", "deltaBps": 5000000000,  "peerKind": "node", "peerSwitchId": "node-w-13", "peerIface": "bond0" },
        { "iface": "xe-0/0/20", "deltaBps": 3000000000,  "peerKind": "host", "peerId": "srv-log-01", "peerIface": "eno1" }
      ] },
    { "switchId": "node-w-11", "role": "node", "otherOutBps": 2500000000,
      "outputs": [
        { "iface": "veth3a1f", "deltaBps": 8000000000, "peerKind": "pod", "peerId": "ingest-7d9c", "namespace": "telemetry" },
        { "iface": "veth9b02", "deltaBps": 3500000000, "peerKind": "pod", "peerId": "kafka-2", "namespace": "stream" }
      ] },
    { "switchId": "node-w-12", "role": "node",
      "outputs": [
        { "deltaBps": 5500000000, "peerKind": "pod", "peerId": "ingest-4f11", "namespace": "telemetry" },
        { "deltaBps": 2500000000, "peerKind": "pod", "peerId": "debug-shell", "namespace": "debug" }
      ] },
    { "switchId": "node-w-13", "role": "node" }
  ]
}
```

五個情境一次示範：`node-w-11` 是標準 switch → node → pod → ns（veth 名照填）；`node-w-12`
的 port **省略 iface**（k8s 內部沒有 switch interface，靠 `peerId` 認 port）；`node-w-13`
是 **node 當葉**（沒列 pod，進來的 5G 由平衡式補成其他輸出）；`srv-log-01` 是混在其中的
非 k8s host 葉；`telemetry` 的兩個 pod 掛在不同 node 上，圖上**相鄰排列、共用同色 ns 色條**，
而且**自動匯進同一個 telemetry 終點節點**（13.5G 直接在圖上讀）。追來源方向見
`samples/k8s-source.json`（ns 終點在最左欄，`batch` 兩個 pod 跨 node 匯流）。

`samples/` 底下是網頁上那些範例的 JSON，可以直接拿來改。

### 驗證錯誤對照

載入失敗時會直接印出這些訊息，照著改欄位就好：

| 訊息 | 意思 |
| --- | --- |
| 最外層必須是 JSON 物件。 | 檔案最外面是陣列或字串 |
| 缺少 investigation。 | 沒有 `investigation` 這個 key |
| investigation.switchId 必填。 | 沒給、或給了空字串 |
| investigation.iface 必填。 | 同上 |
| investigation.deltaBps 必須是正數（bps）。 | 不是數字、是 0、或是負數；別寫成 `"10G"` |
| investigation.direction 只能是 "in" 或 "out"。 | 拼錯，例如寫成 `"input"` |
| kind 只能是 "destination" 或 "source"。 | 拼錯 |
| hops 必須是非空陣列。 | `hops` 不是陣列，或是空的 `[]` |
| hops[i] 不是物件。 | 陣列裡混了字串或數字 |
| hops[i].switchId 必填。 | 那一跳沒給 id，就沒得合併 |
| hops[i].tier 必須是非空字串。 | `tier` 給了數字、空字串或其他型別 |
| hops[i].role 必須是非空字串。 | `role` 給了數字、空字串或其他型別（`namespace` 同款訊息） |
| hops[i].outputs 必須是陣列。 | 給了單一物件，忘了包 `[]` |
| hops[i].outputs[j] 不是物件。 | port 陣列裡混了別的東西 |
| hops[i].outputs[j].iface 必填。 | 一般 switch hop 的 port 沒給 interface 名 |
| hops[i].outputs[j] 省略 iface 時必須給 peerSwitchId 或 peerId。 | `role: "node"/"pod"` 的 port 才能省 iface，但沒 iface 又沒對端 id 就沒得認 port |
| hops[i].outputs[j].deltaBps 必須是非負數。 | port 的量不是數字或是負數 |
| hops[i].outputs[j].peerKind 必須是非空字串。 | `peerKind` 給了數字或空字串（`namespace` 同款訊息） |
| hops[i].outputs[j] 的 peerKind 為 "pod" 時 namespace 必填（pod 一定屬於某個 namespace）。 | 即將畫成 pod 卡的 port 沒給 `namespace`；pod 流量要匯進 ns 終點節點。對端接進 `hops` 的 proxy pod 不受此限 |
| hops[i] 的 role 為 "pod" 時 namespace 必填。 | `role: "pod"` 的中繼 hop 沒給 `namespace` |
| hops[i].otherInBps 必須是非負數（bps）。 | 給了負數或非數字；負殘差會讓色塊算出負高度、SVG 破圖 |
| hops[i].otherOutBps 必須是非負數（bps）。 | 同上 |
| investigation.switchId「X」在 hops 裡找不到。 | 起點那台沒有出現在 `hops`，通常是 id 打錯或大小寫不一致 |

（`inputs` 的訊息一樣，只是把 `outputs` 換成 `inputs`。）

另外有幾種**警告**，不會擋著不畫，會列在圖下方：

- `otherInBps／otherOutBps 兩個都給了但湊不出平衡式` — 圖照你給的顯式值畫，那台的左右兩疊
  色塊厚度就不會相等。訊息會把兩邊算式攤開、指出哪邊多多少；拿掉其中一個讓平衡式自動補就會守恆
- `拓樸疑似有環` — hops 兜出了環，欄位順序會不準
- `同一台在不同 hop 給了不同 tier` — 同 `switchId` 的 hop 標了兩種 tier，採用先出現的
- `逆著多數流量方向` — 兩群之間雙向都有流量，總量小的方向畫成回流帶、不參與排欄
- `群組間仍繞成環` — 環繞過三群以上，移除環上流量最小的那個方向破環
- `在不同 hop 給了不同 peerKind／namespace` — 同一個 port 拆在多個 hop 寫、標註衝突，採先出現的值
- `標了 namespace，但對端已是 hop` — port 上的 ns 只會出現在帶的 tooltip、不會標在盒上；請改標在該 hop 的 `namespace` 欄位

### 同層互連（tier）

欄位預設照最長路徑排：每條邊都逼下游至少右一欄。同一層彼此互連時（例如 bdr↔dci 跨 DC），
互連下游的機器會被推到右邊一欄，同一層被拆成兩欄。把同層的 hop 都標同一個 `tier` 就能鎖回同欄：

- 同 `tier` 的機器整群視為一個節點跑最長路徑，欄位順序仍由拓樸自動推，**不用宣告層級編號**；tier 內部的邊不參與排欄。沒標 `tier` 的 hop 行為完全不變。
- tier 內部的邊畫成**欄右側的弧帶**（往右凸再折回），厚度與青帶共用同一把比例尺，守恆照常經過。
  它不是另一種狀態，就是一條已追查的帶，只是兩端排在同一欄才改畫成馬蹄形；馬蹄形讀不出方向，
  所以弧的終點端有個**箭頭指流向**。
- 範例見 `samples/dci-tier.json`（網頁上的「同層互連（tier）」）。

## 追查方向

封包方向永遠左到右。不做兩套座標、不左右翻圖。差別只在追查起點釘在哪一側。

| 模式 | 你看的 counter | 下一跳 | 起點位置 | JSON |
| --- | --- | --- | --- | --- |
| 追終點 | 某條 in 增加 | 貢獻大的 out | 最左 | `kind:"destination"` 或 `investigation.direction:"in"` |
| 追來源 | 某條 out 增加 | 貢獻大的 in | 最右 | `kind:"source"` 或 `investigation.direction:"out"` |

追終點 hop 填 `outputs`；追來源 hop 填 `inputs`。
同一台 switch 在 `hops` 出現多次（雙 uplink 匯入核心）會合併成一個盒子，不會畫成兩台。

## 守恆與殘差

每層只跟前 N 名或佔比 ≥ 門檻（例如前 3 名 / ≥ 10%）時：

- **其他輸出**（玫瑰）：這層 focus 增加量裡，沒跟下去的 port（截斷、太小、已滿 N 名）
- **其他輸入**（琥珀）：跟下去的出口／入口總量比剛追進來那條更大（別的上聯、沒追的來源）

同一層可以兩種都有。平衡式：

```
已知 in + 其他輸入 = 已追查 out + 其他輸出
```

`otherInBps` / `otherOutBps` **不給就由平衡式自動補缺口**，所以最少只要填實際跟到的 port 就會守恆。
兩個都給又對不上，圖照顯式值畫並在摘要下方出警告。

## 畫法（目前生效的定案）

- 青色長帶＝有跟下去的 uplink／追查路徑，帶寬用**速率增量 Δ**，數字帶 `+` 號。
- 殘差不進走廊：不畫成穿越別台的長色帶，也不做盒子內底部 chips。
- 殘差貼在該台外側的虛線色塊：其他輸入在左、其他輸出在右；**高度跟 Gbps 等比，
  跟青帶共用同一把比例尺**（`maxVal` 也把殘差算進去），標籤與數量寫在色塊旁。
  這樣「有追查」跟「沒追查」的比例一眼看得出來。
- 殘差是盒子左右 port 疊裡的**真槽位**，跟已追查 port 一起排版。同一台左右兩側的
  **色塊厚度總和完全相等**（守恆等式保證）；但每一列有 24px 最小高度、列間 9px 間距，
  所以**兩疊的總高度不會剛好一樣**——守恆看色塊厚度，不是看疊起來的總高度。
- 小於該台自己讀數誤差（`max(已知 in, 已追查 out) × 0.5% + 1 bps`）的殘差不畫，
  免得浮點雜訊在圖上長出一塊。圖、hop 摘要、Mermaid 用同一個門檻。
- 盒子裡只畫已追查 port，殘差不用斜線填滿整台 switch。
- 追查終止葉節點是灰色虛線小卡（「追查終止」「未再往下追」＋ iface ＋ 帶寬），不是又一台 switch。
- k8s 接在同一條 Sankey 上：switch → node（天藍虛線盒）→ pod（天藍虛線中繼卡，標 name 與
  `ns/<namespace>`）→ namespace（ns 色終點卡）。不是每個 switch iface 都接 node；node 可以
  當葉（不列 `outputs` 就整台由平衡式補成其他輸出）；pod 一定屬於某個 namespace（驗證強制）。
  node 用同一套截斷，沒跟的 pod 併成該 node 的其他輸出。
- **namespace 是自動推導的終點節點**：每個 pod 卡自動再接一條邊匯進所屬 ns 的終點卡，
  pod → ns 這條邊的值就是 pod 自己的量測 Δ——**同一筆數字的重新分組，不是推估**。
  **全圖同 ns 合一個節點**（跨 node 的 pod 匯流），「這個 ns 總共多少」直接在圖上讀；
  追來源模式鏡像，ns 終點落在最左欄。列進 `hops` 的中繼 pod（proxy pod）**不接** ns——
  它的流量已流向自己的下游，再接會重複計量破壞守恆，它的 ns 只是盒副標。
  同 ns 的 pod 在欄內**相鄰排列**、左緣掛同色 ns 色條（色盤 5 色依首次出現順序取用、
  超過循環）；pod 落在不同深度時各 ns 各自落欄，是預期行為。彙總數字同步在圖下方
  「namespace 流量小計」表。
- 整欄都是 k8s node 時欄標題標「第 N 跳 · k8s node」；整欄都是 pod 卡標「第 N 跳 · pod」；
  整欄都是 ns 終點標「追查終止 · namespace」。
- hop 數字摘要放圖下方，是圖外資訊，不是盒子內標籤。
- 圖區是固定尺寸畫布：SVG 填滿容器，`viewBox` 的 meet-fit 就是「符合視窗」，
  縮放平移只改一層 `<g>` 的 `transform`。字級與線寬跟著等比縮放（真幾何縮放）。

## CLI

`tools/trace_sankey.py`：先算 residual 再畫／印。純文字離線可用；本機裝了 plotly 就能出互動 HTML。

```bash
make draw    FILE=samples/classic.json          # python3 tools/trace_sankey.py samples/classic.json
make mermaid FILE=samples/k8s.json KIND=sankey  # ... --mermaid sankey
make mermaid FILE=samples/campus.json KIND=flow # ... --mermaid flow
make html    FILE=trace.json OUT=out.html       # ... --plotly out.html（需要 plotly）
make check                                      # 所有 samples 跑一次

python3 tools/trace_sankey.py samples/pruned.json --json   # 印算好的模型
cat trace.json | python3 tools/trace_sankey.py -           # 吃 stdin
```

## 檔案

```
Makefile                   跑起來與驗證的入口（make help）
index.html                 版面與五個分頁
assets/css/app.css
assets/js/samples.js       八個內建範例（純資料）
assets/js/model.js         驗證、合併 hop、算殘差
assets/js/render.js        SVG Sankey、等比殘差色塊、終止小卡、hop 摘要
assets/js/zoom.js          圖的縮放與平移（滾輪定位游標、拖曳、雙指、符合視窗／1:1）
assets/js/exports.js       Mermaid sankey-beta / flowchart
assets/js/app.js           query string、分頁、開檔／拖放、JSON 編輯器、tooltip、
                           縮放按鈕與快捷鍵、圖區高度
samples/*.json             範例 JSON（CLI 也吃同一份；make check 會全部跑一次）
stress/                    縮放平移的壓力測試資料與產生器（刻意不放 samples/，
                           免得 make check 被超大檔拖慢）
tools/serve.py             開發用 server：送 no-store、不回 304，改完 js/css 不會拿到舊檔
tools/trace_sankey.py      CLI：文字報告 / Mermaid / plotly
```
