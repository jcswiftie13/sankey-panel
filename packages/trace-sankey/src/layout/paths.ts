/* 三種帶的 SVG path 字串。純數學，吃 EdgeGeom。 */
import type { EdgeGeom } from './geometry.js';

export const ribbon = (e: EdgeGeom): string => {
  const mx = (e.x1 + e.x2) / 2;
  const a = e.t1 / 2, b = e.t2 / 2;
  return 'M' + e.x1 + ',' + (e.y1 - a) +
    ' C' + mx + ',' + (e.y1 - a) + ' ' + mx + ',' + (e.y2 - b) + ' ' + e.x2 + ',' + (e.y2 - b) +
    ' L' + e.x2 + ',' + (e.y2 + b) +
    ' C' + mx + ',' + (e.y2 + b) + ' ' + mx + ',' + (e.y1 + a) + ' ' + e.x1 + ',' + (e.y1 + a) + ' Z';
};

/* 歸屬線：ribbon() 的中線版本。fill 是 none、靠 stroke 畫，比照回流的 band-loop——
   帶狀路徑沒辦法畫成虛線，而虛線正是「這條沒有量」的視覺記號。 */
export const ownLine = (e: EdgeGeom): string => {
  const mx = (e.x1 + e.x2) / 2;
  return 'M' + e.x1 + ',' + e.y1 + ' C' + mx + ',' + e.y1 + ' ' + mx + ',' + e.y2 + ' ' + e.x2 + ',' + e.y2;
};

/* 同欄互連：兩端都在欄右緣的馬蹄形弧帶，往右凸 B 再折回。
   外緣接兩端「遠離中線」的邊界、內緣接近側，弧頂寬度才會 ≈ 平均帶寬。 */
export const lateralRibbon = (e: EdgeGeom, B: number): string => {
  const a = e.t1 / 2, b = e.t2 / 2;
  const s = e.y2 >= e.y1 ? 1 : -1;
  const k = (a + b) * 0.67, Bo = B + k, Bi = Math.max(8, B - k);
  return 'M' + e.x1 + ',' + (e.y1 - s * a) +
    ' C' + (e.x1 + Bo) + ',' + (e.y1 - s * a) + ' ' + (e.x2 + Bo) + ',' + (e.y2 + s * b) +
    ' ' + e.x2 + ',' + (e.y2 + s * b) +
    ' L' + e.x2 + ',' + (e.y2 - s * b) +
    ' C' + (e.x2 + Bi) + ',' + (e.y2 - s * b) + ' ' + (e.x1 + Bi) + ',' + (e.y1 + s * a) +
    ' ' + e.x1 + ',' + (e.y1 + s * a) + ' Z';
};

/* 回流帶（col 遞減）：source 右緣出來 → 右側走廊下潛 → 貼圖底下方的 lane 水平向左 →
   target 左側走廊上浮 → 接回左緣。等寬 stroke 路徑（stroke-width＝帶厚），圓角轉彎。 */
export const backwardRibbon = (e: EdgeGeom): string => {
  const r = Math.min(Math.max(14, e.backT!), (e.backY! - Math.max(e.y1, e.y2)) / 2);
  const xD = e.backXD!, xU = e.backXU!, yB = e.backY!;
  return 'M' + e.x1 + ',' + e.y1 +
    ' L' + (xD - r) + ',' + e.y1 +
    ' Q' + xD + ',' + e.y1 + ' ' + xD + ',' + (e.y1 + r) +
    ' L' + xD + ',' + (yB - r) +
    ' Q' + xD + ',' + yB + ' ' + (xD - r) + ',' + yB +
    ' L' + (xU + r) + ',' + yB +
    ' Q' + xU + ',' + yB + ' ' + xU + ',' + (yB - r) +
    ' L' + xU + ',' + (e.y2 + r) +
    ' Q' + xU + ',' + e.y2 + ' ' + (xU + r) + ',' + e.y2 +
    ' L' + e.x2 + ',' + e.y2;
};
