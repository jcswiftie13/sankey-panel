/* 全套件唯一的色票。**每一個十六進位色值只准出現在這個檔案裡**
   （tools/test/colors.test.mjs 會斷言這件事）。

   為什麼需要這個檔：原本同一批色值散在四個地方各寫一次——styles/trace-sankey.css 的
   CSS 變數、svg/Defs.tsx 與 svg/Band.tsx 與 svg/cards.tsx 的屬性字面值、layout/constants.ts
   的 STATUS_COLOR、app/src/app.css 的頁面色票。已經漂移過兩處：
   - sky（設備框天藍）在 cards.tsx 出現三次、卻沒有任何 CSS 變數對應，三處互抄字面值。
   - app.css 圖例的 write 漸層 linear-gradient(90deg,#c2410c,#7c2d12) 必須手動對齊
     Defs.tsx 的 gband-w 兩個 stop，中間沒有任何連結，改一邊圖例就跟圖上的帶不同色。

   收斂方向是「TS 是來源、CSS 由它產生」（scripts/gen-css.mjs），不是反過來讓 SVG 吃
   var(--cyan)：render() 是 SSR／headless 的純函式、產出的 SVG 字串**不掛任何 CSS**，
   改成 var() 之後單獨嵌用那份 SVG（存成圖檔、貼進不含該樣式表的頁面）顏色會整片消失。
   那是真的功能退化，所以 SVG 屬性刻意保留字面 hex——但字面值來自這裡，不是抄的。 */

export const COLORS = {
  /* ── 版面底色 ── */
  bg: '#0b1017',            /* 頁面底；也是 SVG 文字描邊光暈的顏色（在帶上才讀得到字） */
  bg2: '#111a24',
  panel: '#131d29',
  panelGlow: '#12202e',     /* 容器左上角的 radial 光暈 */
  line: '#22303f',
  line2: '#2c3e52',
  /* ── 文字 ── */
  fg: '#e6edf5',
  dim: '#93a4b8',
  dim2: '#6b7f95',
  /* ── 語意色：青＝已追查／read、燃橘＝write、琥珀＝其他輸入／warning、
        玫瑰＝其他輸出／回流／critical、綠＝normal、灰＝追查終止／歸屬線、天藍＝設備框 ── */
  cyan: '#22d3ee',
  cyanD: '#0e7490',         /* 青帶漸層的深色端 */
  cyanH: '#67e8f9',         /* 青帶 hover 漸層的亮色端 */
  amber: '#f59e0b',
  rose: '#fb7185',
  roseD: '#9f1239',         /* 回流帶漸層的深色端 */
  roseH: '#fda4af',
  roseHD: '#be123c',
  green: '#4ade80',         /* status normal 的外框色；刻意避開 ns 色盤的 #34d399 */
  gray: '#94a3b8',
  orange: '#c2410c',        /* storage 資料的 write 通道帶（read 沿用青） */
  orangeD: '#7c2d12',
  orangeH: '#fb923c',
  sky: '#7dd3fc',           /* 設備型別（k8s node／pod、netapp 三型別）的虛線框 */
  /* ── 卡片底色（只有 SVG 用得到，不進 CSS 變數） ── */
  cardBg: '#101c28',        /* hop 盒 */
  leafBg: '#0e151d',        /* 葉卡／群組卡／k8s node 外框 */
  anchorBg: '#0d1a22'       /* 追查起點的錨卡 */
} as const;

/* 進 CSS 變數的色票：兩個樣式表（styles/trace-sankey.css 的 .trace-sankey scope 與
   styles/tokens.css 的 :root）都用這一份清單，名字由 camelCase 自動轉 kebab
   （cyanD → --cyan-d、line2 → --line2）。卡片底色與 hover 漸層端不進來——CSS 用不到。 */
export const CSS_COLOR_KEYS = [
  'bg', 'bg2', 'panel', 'panelGlow', 'line', 'line2', 'fg', 'dim', 'dim2',
  'cyan', 'cyanD', 'amber', 'rose', 'roseD', 'green', 'gray', 'orange', 'orangeD', 'sky'
] as const;

/** camelCase → CSS 變數名（--cyan-d）。gen-css 與任何要印變數名的人共用同一份轉換 */
export const cssVarName = (key: string): string => '--' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

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

/* 三色都上框（參考面板：有 status 就以 status 框，normal 也是一個判定）；沒有 status 維持中性框。
   綠刻意避開 ns 色盤的 #34d399 */
export const STATUS_COLOR: Record<string, string> = {
  critical: COLORS.rose, warning: COLORS.amber, normal: COLORS.green
};
