# 壓力測試資料

畫面縮放平移的測試檔，**不是**真的追查結果，也不是給人看的範例
（範例在 `samples/`）。`make check` 會連這個目錄一起 build 一遍當迴歸哨兵。

`make dev` 用 dev 那一列的「選檔…」選進來就會畫（拖放已經拿掉）。實測數字（1600×1000 視窗、Chrome）：

| 檔案 | switch | interface | viewBox | 開場 fit | 20 次滾輪 | 拖曳 |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| `01-small.json`  | 13 | 39 | 2156 × 2846 | 21% | 656ms | 338ms |
| `02-medium.json` | 40 | 120 | 2582 × 8462 | 7.2% | 670ms | 340ms |
| `03-large.json`  | 121 | 363 | 3008 × 25310 | 2.4% | 687ms | 345ms |
| `04-wide.json`   | 16 | 96 | 7694 × 4649 | 13% | 672ms | 337ms |
| `05-huge.json`   | 1365 | 5460 | 3434 × 426022 | 0.1% | 2607ms | 473ms |

`02` / `03` 最接近實際會痛的情境：開場 fit 只有 7%／2.4%，字小到讀不了，
要靠滾輪推到 `1:1` 才看得清 iface。`04` 是長鏈型，對應原本橫向捲軸最痛的圖。

`05` 是刻意做壞的極端值：54000 個 SVG 元素，每次變換都要整張重繪，
滾輪每格約 130ms（其他檔案約 33ms），會有明顯頓挫。這是手寫 SVG 的規模上限，
不是縮放本身的問題；真要撐這種量得做視野裁剪。它的 viewBox 高達 426022，
是既有版面演算法把 4096 個葉節點直堆成一欄造成的。

這五支就是用下面的指令產生的（`gen.py` 輸出 elements wire 格式）：

```
python3 stress/gen.py --depth 3 --fan 3 --gbps 64 -o stress/01-small.json
python3 stress/gen.py --depth 4 --fan 3 --gbps 64 -o stress/02-medium.json
python3 stress/gen.py --depth 5 --fan 3 --gbps 64 -o stress/03-large.json
python3 stress/gen.py --chain 16 --fan 6 --gbps 64 -o stress/04-wide.json
python3 stress/gen.py --depth 6 --fan 4 --gbps 64 -o stress/05-huge.json
```

自己調大小：

```
python3 stress/gen.py --depth 5 --fan 3  -o stress/x.json   # 樹狀擴散，圖會很高
python3 stress/gen.py --chain 20 --fan 8 -o stress/y.json   # 長鏈，圖會很寬
```
