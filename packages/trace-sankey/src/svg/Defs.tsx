/* 漸層定義：留在 zoom-layer 外面（縮放不該動到漸層座標）。
   顏色是三份定義沒有連動的其中一份（另兩份：styles/trace-sankey.css、app/src/app.css），改配色要三處一起改。
   語意：青＝已追查／read、燃橘＝write、玫瑰＝回流。 */
import type { TraceModelOk } from '../model/types.js';

export const Defs = ({ model }: { model: TraceModelOk }) => (
  <defs>
    <linearGradient id="gband" x1="0" x2="1">
      <stop offset="0" stopColor="#22d3ee" stopOpacity=".85" />
      <stop offset="1" stopColor="#0e7490" stopOpacity=".85" />
    </linearGradient>
    <linearGradient id="gband-h" x1="0" x2="1">
      <stop offset="0" stopColor="#67e8f9" />
      <stop offset="1" stopColor="#22d3ee" />
    </linearGradient>
    <linearGradient id="gband-back" x1="1" x2="0">
      <stop offset="0" stopColor="#fb7185" stopOpacity=".75" />
      <stop offset="1" stopColor="#9f1239" stopOpacity=".75" />
    </linearGradient>
    <linearGradient id="gband-back-h" x1="1" x2="0">
      <stop offset="0" stopColor="#fda4af" />
      <stop offset="1" stopColor="#be123c" />
    </linearGradient>
    {/* write 通道（storage 資料）：燃橘。read 沿用青帶——read 與無通道的 switch 帶同色。
        只在圖上真的有 write 帶時才輸出這兩個漸層：switch 追查資料的輸出不變 */}
    {model.edges.some((e) => e.channel === 'write') && (
      <>
        <linearGradient id="gband-w" x1="0" x2="1">
          <stop offset="0" stopColor="#c2410c" stopOpacity=".85" />
          <stop offset="1" stopColor="#7c2d12" stopOpacity=".85" />
        </linearGradient>
        <linearGradient id="gband-w-h" x1="0" x2="1">
          <stop offset="0" stopColor="#fb923c" />
          <stop offset="1" stopColor="#c2410c" />
        </linearGradient>
      </>
    )}
  </defs>
);
