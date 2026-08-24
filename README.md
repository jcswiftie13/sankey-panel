# Interface Increment 追查 Sankey

追一台 switch 的 interface increment：一跳可能有多條 uplink，所以下游看到的 out 增加
可以大於你剛追進來的那一條 in（A→B 10G，B→C 20G）。這個工具把那個現象畫出來，
但不會暗示流量是這台 switch 憑空生出來的——多出來的量一律用「其他輸入／其他輸出」補齊，
讓圖在視覺上守恆。

不做的事：不自動偵測 switch／counter、不掃網、沒有帳號與資料庫、不把追來源畫成整張圖左右鏡射。

## 跑起來

純靜態，沒有 build step。

```bash
cd sankey-trace
python3 -m http.server 8765
# http://127.0.0.1:8765/index.html
```

直接用瀏覽器開 `index.html`（file://）也可以：全部是傳統 `<script>`，沒有 module、沒有 fetch。

狀態都在 query string，控制項是真的 `<a href>`，前端 JS 沒載入也能靠連結切換：

```
index.html?sample=campus&mode=balanced&tab=chart
```

| 參數 | 值 |
| --- | --- |
| `sample` | `classic` `dual-uplink` `campus` `pruned` `source` `k8s`（`custom` = 編輯器套用的） |
| `mode` | `balanced`（預設）`contribution` `raw` |
| `tab` | `chart` `json` `mermaid-sankey` `mermaid-flow` `notes` |

## 追查方向

封包方向永遠左到右。不做兩套座標、不左右翻圖。差別只在追查起點釘在哪一側。

| 模式 | 你看的 counter | 下一跳 | 起點位置 | JSON |
| --- | --- | --- | --- | --- |
| 追終點 | 某條 in 增加 | 貢獻大的 out | 最左 | `kind:"destination"` 或 `investigation.direction:"in"` |
| 追來源 | 某條 out 增加 | 貢獻大的 in | 最右 | `kind:"source"` 或 `investigation.direction:"out"` |

追終點 hop 填 `inputIface` + `outputs`；追來源 hop 填 `outputIface` + `inputs`。
同一台 switch 在 `hops` 出現多次（雙 uplink 匯入核心）會合併成一個盒子，不會畫成兩台。

## 守恆與殘差

每層只跟前 N 名或佔比 ≥ 門檻（預設概念是前 3 名 / ≥ 10%）時：

- **其他輸出**（玫瑰）：這層 focus 增加量裡，沒跟下去的 port（截斷、太小、已滿 N 名）
- **其他輸入**（琥珀）：跟下去的出口／入口總量比剛追進來那條更大（別的上聯、沒追的來源）

同一層可以兩種都有。平衡式：

```
已知 in + 其他輸入 = 已追查 out + 其他輸出
```

JSON 可以顯式給 `otherInBps` / `otherOutBps`；沒給時由平衡式補缺口。兩個都給又對不上，
圖照顯式值畫並在摘要下方出警告。

## 畫法（目前生效的定案）

- 青色長帶＝有跟下去的 uplink／追查路徑，帶寬用實際 increment。
- 殘差不進走廊：不畫成穿越別台的長色帶，也不做盒子內底部 chips。
- 殘差貼在該台外側短虛線：其他輸入在左、其他輸出在右；虛線高度固定不跟 Gbps 等比放大，
  標籤與數量寫在虛線旁。
- 盒子裡只畫已追查 port，殘差不用斜線填滿整台 switch。
- 追查終止葉節點是灰色虛線小卡（「追查終止」「未再往下追」＋ iface ＋ 帶寬），不是又一台 switch。
- k8s 接在同一條 Sankey 上：switch → node（虛線盒）→ pod（葉，標 namespace/name）。
  node 用同一套截斷，沒跟的 pod 併成該 node 的其他輸出。
- hop 數字摘要放圖下方，是圖外資訊，不是盒子內標籤。

## 三種讀圖模式

| 模式 | 用途 |
| --- | --- |
| 平衡 Sankey（預設） | 實際量 ＋ 其他進／出，圖會守恆 |
| 只看貢獻 | 只留能歸因到追查起點的量；截斷的其他進／出會消失 |
| 原始實際量 | 不補缺口，只畫有跟下去的 interface，用來對照 counter |

## 追查 JSON

必要：

- `investigation`：`switchId`、`iface`、`direction`、`deltaBps`（bps）
- `hops`：非空陣列，每筆要有 `switchId`

選填：

- `kind`、`pruning.topN`、`pruning.minShare`
- hop：`label`、`role`（`switch` / `node` / `pod`）、`otherInBps`、`otherOutBps`
- port：`iface`、`deltaBps`、`peerKind`、`peerId` / `peerSwitchId`、`peerIface`、`namespace`

```json
{
  "kind": "destination",
  "investigation": { "switchId": "sw-edge-a", "iface": "xe-0/0/1", "direction": "in", "deltaBps": 10000000000 },
  "pruning": { "topN": 3, "minShare": 0.1 },
  "hops": [
    {
      "switchId": "sw-edge-a", "label": "Edge A", "inputIface": "xe-0/0/1",
      "outputs": [
        { "iface": "et-0/0/48", "deltaBps": 20000000000,
          "peerKind": "switch", "peerSwitchId": "sw-core-1", "peerIface": "et-1/0/1" }
      ]
    }
  ]
}
```

`samples/` 底下是網頁上那六個範例的 JSON，CLI 可以直接吃。

## CLI

`tools/trace_sankey.py`：先算 residual 再畫／印。純文字離線可用；本機裝了 plotly 就能出互動 HTML。

```bash
python3 tools/trace_sankey.py samples/classic.json
python3 tools/trace_sankey.py samples/source.json --mode contribution
python3 tools/trace_sankey.py samples/k8s.json --mermaid sankey
python3 tools/trace_sankey.py samples/campus.json --mermaid flow
python3 tools/trace_sankey.py samples/pruned.json --json
python3 tools/trace_sankey.py trace.json --plotly out.html      # 需要 plotly
cat trace.json | python3 tools/trace_sankey.py - --mode raw
```

## 檔案

```
index.html                 版面與五個分頁
assets/css/app.css
assets/js/samples.js       六個範例（純資料）
assets/js/model.js         驗證、合併 hop、算殘差與可歸因量
assets/js/render.js        SVG Sankey、殘差短虛線、終止小卡、hop 摘要
assets/js/exports.js       Mermaid sankey-beta / flowchart
assets/js/app.js           query string、分頁、JSON 編輯器、tooltip
samples/*.json             範例 JSON（CLI 用）
tools/trace_sankey.py      CLI：文字報告 / Mermaid / plotly
```
