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

/* 色票（含 STATUS_COLOR）全部住在 layout/colors.ts：
   同一批色值原本散在 CSS、SVG 屬性、這裡與 app.css 四處，已經漂移過。
   這裡 re-export 是為了不動既有 import 路徑（layout.ts／cards.tsx／tables.ts 都從這支拿）。 */
export { STATUS_COLOR } from './colors.js';


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
