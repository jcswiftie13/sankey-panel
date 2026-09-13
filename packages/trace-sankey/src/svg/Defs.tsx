/* 漸層定義：留在 zoom-layer 外面（縮放不該動到漸層座標）。
   id 帶前綴 p（<TraceSankey> 用 useId 產生）：漸層 id 是文件層級的，同一頁掛兩張圖會互相搶；
   headless 字串渲染前綴是空字串，輸出跟以前同名。
   色值全部來自 layout/colors.ts（全套件唯一的色票，CSS 變數也由它產生）。
   刻意不吃 var(--cyan)：render() 產出的 SVG 字串不掛任何 CSS，單獨嵌用時顏色會整片消失。
   語意：青＝已追查／read、燃橘＝write、玫瑰＝回流。 */
import type { TraceModelOk } from '../model/types.js';
import { channelsIn } from '../model/classify.js';
import { COLORS as C } from '../layout/colors.js';

export const Defs = ({ model, p }: { model: TraceModelOk; p: string }) => (
  <defs>
    <linearGradient id={p + 'gband'} x1="0" x2="1">
      <stop offset="0" stopColor={C.cyan} stopOpacity=".85" />
      <stop offset="1" stopColor={C.cyanD} stopOpacity=".85" />
    </linearGradient>
    <linearGradient id={p + 'gband-h'} x1="0" x2="1">
      <stop offset="0" stopColor={C.cyanH} />
      <stop offset="1" stopColor={C.cyan} />
    </linearGradient>
    <linearGradient id={p + 'gband-back'} x1="1" x2="0">
      <stop offset="0" stopColor={C.rose} stopOpacity=".75" />
      <stop offset="1" stopColor={C.roseD} stopOpacity=".75" />
    </linearGradient>
    <linearGradient id={p + 'gband-back-h'} x1="1" x2="0">
      <stop offset="0" stopColor={C.roseH} />
      <stop offset="1" stopColor={C.roseHD} />
    </linearGradient>
    {/* write 通道（storage 資料）：燃橘。read 沿用青帶——read 與無通道的 switch 帶同色。
        只在圖上真的有 write 帶時才輸出這兩個漸層：switch 追查資料的輸出不變 */}
    {channelsIn(model.edges).includes('write') && (
      <>
        <linearGradient id={p + 'gband-w'} x1="0" x2="1">
          <stop offset="0" stopColor={C.orange} stopOpacity=".85" />
          <stop offset="1" stopColor={C.orangeD} stopOpacity=".85" />
        </linearGradient>
        <linearGradient id={p + 'gband-w-h'} x1="0" x2="1">
          <stop offset="0" stopColor={C.orangeH} />
          <stop offset="1" stopColor={C.orange} />
        </linearGradient>
      </>
    )}
  </defs>
);
