/* 版面常數。顏色是三份定義沒有連動的其中一份（另兩份：styles/trace-sankey.css 的 CSS 變數、
   app/src/app.css 的圖例色票），改配色要三處一起改。 */

export const NODE_W = 208, LEAF_W = 178, ANCHOR_W = 152;
export const HEADER_H = 40, ROW_H = 24, ROW_GAP = 9, BODY_PAD = 12, BODY_MIN = 26;
export const COL_GAP = 218, VGAP = 34;
export const PAD_TOP = 46, PAD_BOTTOM = 26, PAD_SIDE = 122;
export const THICK_MAX = 86, THICK_MIN = 3;
/* 歸屬線的線寬：不帶量，不能照 thick() 佔一般帶的視覺重量；
   但 fill:none 的帶 hover 判定就是 stroke-width，太細會點不到 */
export const OWN_T = 2.4;
/* layout:'node' 的 k8s node 外框：pod 卡縮排 WRAP_PAD、外框上緣留型別標＋名字＋pod 數三行 */
export const WRAP_PAD = 10, WRAP_HEADER_H = 52;
/* 每張卡同一套版式：第 1 行型別標（y+17）、第 2 行名字（y+31）、之後一行一個屬性（每行 LINE_H）。
   卡高＝名字行之後的屬性行數決定：0 行 57、1 行 70、2 行 84、3 行 97…（CARD_BASE + LINE_H*行數 + 底邊留白） */
export const LINE_H = 13, CARD_BASE = 44;
export const RES_LEN = 34, RES_GAP = 8;   /* 高度改用 thick()，不再有固定的 RES_H／RES_PAD */

/* namespace 色盤：依「首次出現順序」配色、超過就循環。不用 hash——hash 撞色不可控，
   相鄰兩組同色比跨檔案顏色不穩更傷可讀性；出現順序在同一份 JSON 裡是確定的，
   與 tier 先到先贏同一套哲學。刻意避開語意色：青（追查）、琥珀（其他入）、
   玫瑰（其他出）、灰（葉）、#7dd3fc 天藍（k8s node 框）。
   **前 5 色不准動**（色值與順序）：既有圖的顏色與 golden 的 .svg 都靠它，改一個字元就是全圖換色。
   後 5 色是把上限從 5 個 ns 拉到 10 個時補的，分兩種來源、順序也有意義：
   6～7 是色輪上真正還空著的兩個色相（洋紅 292°、黃綠 84°，與既有色與語意色都差 25° 以上），
   區分力最強所以排前面；8～10 才是綠／黃／藍的暗變體，靠亮度與原色拉開（差 0.27／0.41／0.14）。
   **試過「同色淺變體」，實測失敗、不要再走回去**：淺紫 #d1c7f0 與淺粉 #eec8dc 的 WCAG 對比度
   有 10.8～11.4 很漂亮，但飽和度掉到 0.53～0.58，在深色底上一律讀成白／淺灰——色相資訊沒了、
   兩者彼此難分，還撞上「灰＝葉卡／歸屬線」。對比度量的是看不看得見，不是認不認得出是什麼顏色；
   選色要一起看飽和度（全盤下限 0.64）。往暗也有底：走到小字門檻 4.5:1 就是亮度 0.225，
   而紫／粉原色本來就落在 0.34 附近，硬做暗變體只剩 0.11 深淺差，所以紫／粉不做變體、改用新色相。
   4.5:1 這個門檻是小字要求：ns 色不只畫色塊與外框，也是 hop／pod 卡上 10px 那行 `ns/<ns>` 的字色。
   第 11 個 ns 回到第 1 色、仍然撞色——語意色已經佔掉青／琥珀／玫瑰／灰／燃橘／天藍六個色位，
   10 組是剩下的色彩空間擠得出來的上限，再多只能靠文字（卡上有名字、pod 卡有 ns 行），刻意不再擴充。 */
export const NS_COLORS = [
  '#a78bfa', '#34d399', '#facc15', '#60a5fa', '#f472b6',
  '#d946ef', '#84cc16', '#209469', '#9e7f03', '#1e80f8'
];

/* 葉卡上的 client 表格：一列一台、全部列出，欄位對齊並印表頭。
   欄寬以「半形 1、CJK 2」的估寬單位換算（.leaf-sub 是 10px，實測 5.09～5.12px 一個半形單位，
   取 5.15 留餘裕）。**欄寬要容得下 budget + 1 個單位**——clip() 截斷後還會再補一個 '…'，
   照 budget 抓欄寬會讓最長的那格戳進欄距（實測 24 單位的 hostname 截完是 127px、欄寬只有 123px）。
   ip 欄要放得下完整的 IPv4（255.255.255.255 ＝ 15 單位）才不會把位址截掉。
   某一欄所有 client 都沒值就整欄不畫，卡也跟著窄——只有一個 IP 的 port 不該撐成一張大表。 */
export interface ClientCol { key: 'hostname' | 'ip' | 'owner'; budget: number; w: number }
export const CLIENT_COLS: ClientCol[] = [
  { key: 'hostname', budget: 24, w: 130 },
  { key: 'ip', budget: 16, w: 90 },
  { key: 'owner', budget: 18, w: 100 }
];
export const CLIENT_GAP = 10, CLIENT_PAD = 12;

/* 非 switch 的設備型別（k8s node／pod、netapp 三型別）畫虛線框；pvc／app／ns 實線，與參考面板一致 */
export const DEVICE_TYPES = ['node', 'pod', 'netapp-node', 'netapp-aggr', 'netapp-svm'];
/* 三色都上框（參考面板：有 status 就以 status 框，normal 也是一個判定）；沒有 status 維持中性框。
   綠刻意避開 ns 色盤的 #34d399 */
export const STATUS_COLOR: Record<string, string> = { critical: '#fb7185', warning: '#f59e0b', normal: '#4ade80' };
