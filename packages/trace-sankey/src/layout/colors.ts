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
  green: '#4ade80',         /* status normal 的外框色 */
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

/* **沒有 namespace 色盤**（曾經有 10 色，已移除，理由在 svg/cards.tsx 檔頭）：外框色只表達 status，
   別為了「分組好看」再加回來。 */

/* 三色都上框（參考面板：有 status 就以 status 框，normal 也是一個判定）；沒有 status 維持中性框。 */
export const STATUS_COLOR: Record<string, string> = {
  critical: COLORS.rose, warning: COLORS.amber, normal: COLORS.green
};
