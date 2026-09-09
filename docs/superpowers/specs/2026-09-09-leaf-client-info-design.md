# 無鄰居 interface 的 client 資訊（IP／hostname／owner）

## Context

追查到某台 switch 的某個 interface 沒有 LLDP 鄰居時，追查就斷在那裡。目前 wire JSON 的表達方式是
在 `nodes` 補一個 `type:"host"`（慣例，見 `docs/migration-wire-format.md` 規則 2）、常常連 `name` 都沒有的
節點，畫成灰虛線「追查終止」葉卡，卡上只有 `id`、iface 與流量——看圖的人只知道「流量從這個 port 出去了」，
不知道那頭是誰。

後端已經能在「沒有鄰居」時改用別的方式（ARP／MAC table／DHCP／CMDB）查出這個 port 上掛了哪些 client、
它們的 IP／hostname／登記人。這次要把那份資訊接進契約並畫到葉卡上，讓追查的最後一哩從「不明終點」
變成「找得到人的端點」。

設計約束（沿用 repo 既有哲學）：

- **圖上只放實際量測值**。後端量得到的是整個 port 的 Δ bps，量不到 per-client，所以
  **一個 client 一張卡／一條帶是不做的**——那需要把 port 的量攤分給各 client，就是 commit `5499b24`
  移除過的推估。一個 port ＝ 一張葉卡，卡上列出它的 client。
- **沒有 client 資料的圖，輸出必須逐 byte 不變**。所有新增的版面（卡高、行）都只在
  節點真的帶 `clients` 時才發生，比照 `render.js` 只在圖上真有 write 帶時才輸出 `gband-w` 漸層的做法。
- **這一版只做 `ip`／`hostname`／`owner` 三個欄位**。MAC、VLAN、探測來源、last_seen 等都先不做；
  格式設計成陣列＋全選填，之後要加欄位就往同一個物件裡加，不會破壞既有資料。

## 資料格式

### 為什麼是新欄位，不是重用現有的

盤點過現有可重用的欄位，都不適合：

- `labels`：契約是「純字串對字串的表」（`validate()` 的 `isStringMap`），而且 `mkHop`／`ensureLeaf`
  只讀 `namespace`／`tier`／`ontap_cluster` 三個鍵，其他鍵不進 model 也不進 tooltip。就算改成讀，
  字串表也塞不下「一個 port 多個 client」。
- `health`／`hardware`／`perf`／`alerts`（`infoOf()`）：語義是 storage 設備的健康與效能讀數，
  把 IP 塞進 `health` 只會讓 tooltip 印出 `health  10.42.7.31`。
- README 已把 `ipaddress`／`owner` 列為「參考 wire 會帶、我們不讀也不報錯」的鍵，但它們在節點頂層、
  一個節點只能有一組，同樣撐不住多 client。**這次不動它們**（維持不讀），避免影響 storage 範例的輸出。

### 新增 `nodes[].data.clients`（陣列）

```jsonc
{
  "data": {
    "id": "sw-tor-1:xe-0/0/12",     // 後端對「無鄰居的 port」合成的葉節點 id
    "type": "host",                  // 維持葉型，畫成追查終止卡
    "clients": [
      {
        "ip": "10.42.7.31",          // string，選填
        "hostname": "lab-gpu-01",    // string，選填
        "owner": "網管部 王小明"       // string，選填；原字串照印，不拆部門／人
      }
    ]
  }
}
```

規則：

- 三個欄位都選填，但**至少要有 `ip` 或 `hostname`**，否則該筆靜默丟棄
  （只有 owner 的項目在圖上認不出是哪台機器）。認不得的鍵忽略，比照 `infoOf()` 對 `alerts` 的寬鬆處理——
  之後後端先送 `mac`／`vlan` 也不會壞，只是還沒有畫面。
- 放在**節點**上而不是邊上：一個無鄰居 port 已經對應到一張葉卡，1:1；卡片是身分的落點，
  邊上會遇到「同一葉卡多條邊要合併 client 清單」的麻煩（`campus.json` 的 `rtr-tanet` 就是這種卡）。
- 任何節點都可以帶 `clients`（hop 也行，只進 tooltip）；只有葉卡會把它畫到卡面上。
- 驗證：`clients` 存在但不是陣列 → 驗證錯誤 `nodes[i].data.clients 必須是陣列。`
  （我們自己的擴充要驗，比照 `other_in_bps`；陣列內的爛項目則靜默丟棄，比照 `alerts`）。

## 顯示方式

葉卡維持 `LEAF_W = 178`、灰虛線、`fill:#0e151d` 不變，只在有 `clients` 時**長高**並插入 1–3 行。

### 單一 client

```
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
  追查終止              client     ← 右上角由「未再往下追」換成 client 標記
  lab-gpu-01                       ← 標題：node 沒給 name 時用唯一 client 的 hostname
  10.42.7.31                       ← client 行：ip · hostname（hostname 已當標題就不重複）
  網管部 王小明                     ← owner 行（沒有 owner 就整行不畫）
  xe-0/0/12 · 20 Gbps              ← 既有的 iface · 量，永遠在最後一行
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

### 多個 client（未管理小 switch、IP phone 串 PC…）

```
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
  追查終止          3 個 client
  sw-tor-1:xe-0/0/12               ← 標題維持 name／id，不挑其中一個 client 當代表
  10.42.7.31 · lab-gpu-01
  10.42.7.32 · lab-gpu-02
  還有 1 個…                        ← 完整清單在 tooltip
  xe-0/0/12 · 20 Gbps
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

多筆時卡面不印 owner（一行塞不下 ip＋hostname＋owner），owner 一律在 tooltip 看得到。

### tooltip（hover 看全部）

```
┌────────────────────────────────────┐
│ host / sw-tor-1:xe-0/0/12          │
│ id        sw-tor-1:xe-0/0/12       │
│ 流量      20 Gbps                   │
│ client 1  10.42.7.31 · lab-gpu-01  │
│           · 網管部 王小明            │
│ client 2  10.42.7.32 · lab-gpu-02 …│
│ client 3  10.42.7.33 · …           │
└────────────────────────────────────┘
```

每個 client 一列（key 在單一時是 `client`、多個時是 `client N`），value 把有值的欄位用 ` · ` 串起來，
**tooltip 不截斷、列出全部**。`tooltip.js` 完全不用改——它對節點只是啞管線，格式化全在 `nodeTip()`。

### 版面規則

- 右上角文字：`clients` 有值時，「未再往下追」換成 `client`（1 筆）或 `N 個 client`（多筆）。
- 卡面文字沒有任何截斷機制（SVG 沒有 text-overflow，全 repo 也沒有一處在截），
  所以要加一個 `clip(s, budget)` helper：**以半形為 1、CJK 為 2 估寬**，超過就截並補 `…`；
  `.leaf-sub` 是 10px、扣掉左右 padding 各 12 後可用約 154px ≈ 30 個半形單位。完整值一律進 tooltip。
- 卡高：`leafH()` 改成 `(n.namespace ? 80 : 70) + 新增行數 * 14`——**沒有 clients 時回傳值完全不變**。
  現有 `leafCard()` 裡 `var ly = n.y + 48; … ly += 14;` 的遞增模式直接沿用，client 行插在
  ns 行之後、iface 行之前。
- **寬度不動**（`LEAF_W = 178`）。若實測太擠，`n.w` 改成「有 clients 就回 208」是安全的一行改動：
  `layout()` 的欄寬本來就以 `NODE_W = 208` 為下限（`render.js` 欄位 x 那段），加到 208 不影響任何欄距。
- 不新增 CSS 類別／顏色。client 行沿用既有的 `.leaf-sub`、右上角沿用 `.leaf-stop`——
  配色是三處沒有連動的定義（見 CLAUDE.md §8），能不碰就不碰。

## 要改的檔案

### `packages/trace-sankey/src/model.js`

1. 新增 `clientsOf(d)`（放在 `infoOf()` 旁邊，同一種寬鬆風格）：`Array.isArray` 才處理，逐筆用
   既有的 `str()`／`isObj()` guard 正規化成 `{ ip, hostname, owner }`，
   `ip` 與 `hostname` 都缺就丟掉該筆，全空回 `null`。
2. `ensureLeaf()`（葉卡的生產者）與 `mkHop()` 的物件字面量各加一個 `clients: clientsOf(d)`，
   緊接在既有的 `status: statusOf(...), usage: usageOf(...), info: infoOf(d)` 那一行後面。
   注意 `ensureLeaf` 的 `if (n)` 早退分支只收斂 iface，不用碰。
3. `validate()` 的節點迴圈加一條：`clients` 存在且不是陣列 → 推錯誤訊息。

### `packages/trace-sankey/src/render.js`

1. 新增 `clip(s, budget)` 截斷 helper 與 `clientLines(n)`（回傳 0–3 個已截斷的字串）。
2. `leafH(n)` 改成加上 `clientLines(n).length * 14`。
3. `leafCard()`：右上角文字改成依 `n.clients` 分岐；在 ns 行與 iface 行之間插入 client 行
   （沿用 `ly += 14`）。其餘（外框、ns 色條、status 色）完全不動。
4. `nodeTip()`：在 `info.alerts` 那一輪之後，逐筆 push client 列。

### `packages/trace-sankey/types/index.d.ts`

新增 `WireClient` interface（`ip?`／`hostname?`／`owner?`，加 `[k: string]: unknown` 讓之後擴充免改型別），
`WireNodeData` 加 `clients?: WireClient[]`。（`TraceNode` 有 `[key: string]: unknown`，model 端不用加型別。）

### `README.md`

repo 慣例是新欄位要同步進四張表：`nodes[].data` 欄位表、節點 `type` 三類表的「葉」那一列
（補一句 client 清單）、「畫面對照：每個欄位出現在哪」的葉卡與 tooltip 兩列、驗證錯誤對照表。
另外在「輸入 JSON 規格」補一小段說明「無鄰居 port 的表達方式」。
**維持** `ipaddress`／`owner` 是「不讀也不報錯」的敘述。

### 範例：`samples/client.json` ＋ `packages/trace-sankey/src/samples.js`

新增**獨立的一份**範例，不要改既有範例——既有 9 份的 golden 輸出才能保持逐 byte 不變。
兩邊是重複維護的同一批資料（CLAUDE.md §10.1），一定要同時加。範例內容要蓋到：

- 單一 client、三個欄位齊全
- 單一 client、只有 IP（沒有 hostname／owner）
- 3 個 client 的 port（觸發「還有 N 個…」）
- 超長 hostname（驗截斷）
- 一個完全沒有 clients 的 `host` 葉（對照組，確認外觀沒變）

### `CLAUDE.md`

§5 契約濃縮版的節點欄位加 `clients`；§7 `leafCard` 的描述補一句 client 行與可變卡高。

## 驗證

1. **迴歸（最重要）**：改動前 `node tools/golden.mjs dump /tmp/a`、改動後 `node tools/golden.mjs dump /tmp/b`、
   `diff -r /tmp/a /tmp/b`。因為既有範例沒有一個帶 `clients`，**預期差異只有新範例多出來的檔案，
   既有檔案一個位元都不能變**——連 CLAUDE.md §10.12 那個 `data-tip` 正規化都不需要用到。
   有任何既有檔案出現 diff 就是做錯了。
2. `make check`：所有範例每個變體（minBps 0／5e8、有通道的多跑 read）都要 build ok。
3. **目視**：`node tools/golden.mjs dump /tmp/b` 產出的是 `.svg`，但樣式在套件的
   `styles/trace-sankey.css` 裡，直接開會沒有顏色。在 scratchpad 寫一頁極簡 HTML
   （`<link>` 那份 CSS ＋ 一個 `.trace-sankey > .chart` 容器塞進 SVG）用瀏覽器開，逐項確認：
   單一／多 client 的行數與卡高、超長字串有沒有戳出卡外、有 ns 色條時色條有跟著長高、
   `status` 有值時外框色仍優先、右上角文字沒有和左上角「追查終止」重疊。
4. **tooltip**：同一頁掛上 `createTooltip().bind()`，hover 每張 client 葉卡確認每筆 client 都列了出來、
   欄位串接順序正確、缺欄位不會留下空的 ` · `。
5. **契約錯誤**：手動把 `clients` 改成字串／物件，確認 `validate()` 報出新的錯誤訊息；
   把陣列裡塞一筆 `{ "owner": "x" }`（沒有 ip 也沒有 hostname），確認靜默丟棄、不報錯也不警告、
   卡片高度跟著少一行。

## 不在這次範圍

- `mac`／`vlan`／`discovered_via`／`last_seen`／`note` 等欄位。格式已經預留（陣列裡的物件、
  認不得的鍵靜默忽略），之後加不必改契約版本。
- 葉卡 tooltip 目前沒有 iface 列（只有錨卡有）——是個既有的洞，但補上會改到所有既有範例的
  卡片 `data-tip`，破壞上面第 1 點那個「既有輸出逐 byte 不變」的強保證。要補請另開一次改動。
- 一個 client 一張卡／一條帶（需要 per-client 流量，等後端真的量得到 per-MAC／per-IP 再談）。
- app 端不需要任何改動：`clients` 走的是 wire JSON，`useTraceDoc` → `validate` → `<TraceSankey>` 全程不變。

## 實作順序

依 repo 慣例（commit `5f735c7`「設計文件」→ `8f94f76`「實作」兩段式），這份文件先進版本庫，
**程式碼尚未改**。實作時照下面的順序走，每一步都能單獨跑 golden 對拍：

1. `model.js`：`clientsOf()` ＋ `ensureLeaf`／`mkHop` 掛上 `clients` ＋ `validate()` 的陣列檢查。
   此時 golden 應該完全沒有 diff（render 還沒讀這個欄位）。
2. 新增 `samples/client.json` 與 `samples.js` 的對應範例。golden 只多出新範例的檔案。
3. `render.js`：`clip()`／`clientLines()`／`leafH()`／`leafCard()`／`nodeTip()`。
   golden 只有新範例的檔案會變，既有 9 份仍須逐 byte 相同。
4. 文件：`README.md` 四張表、`CLAUDE.md` §5 與 §7、`types/index.d.ts`。
