/* 數字的人類可讀格式。圖上一律是實際量測值：delta_bps 是「速率的差」帶 + 號，
   bytes/s 是絕對速率不帶號——同一個數字兩種尺，讀者才不會把增量當成當下吞吐量。 */
import type { RateUnit } from './types.js';

const round = (v: number): string => String(Math.round(v * 100) / 100);

export const fmtBps = (bps: number): string => {
  const n = Number(bps) || 0, a = Math.abs(n);
  if (a >= 1e12) return round(n / 1e12) + ' Tbps';
  if (a >= 1e9) return round(n / 1e9) + ' Gbps';
  if (a >= 1e6) return round(n / 1e6) + ' Mbps';
  if (a >= 1e3) return round(n / 1e3) + ' kbps';
  return round(n) + ' bps';
};
/* 值是「速率的差」，不是絕對速率：帶號顯示，讀者才不會當成當下吞吐量。 */
export const fmtDelta = (bps: number): string => (Number(bps) > 0 ? '+' : '') + fmtBps(bps);
export const gbps = (bps: number): number => Math.round((Number(bps) || 0) / 1e8) / 10;

/* bytes 的人類可讀格式：SI 1000 進位、3 位有效數字、先四捨五入再決定單位
   （999999 → 1 MB 而不是 1000 KB）。跟參考面板的 formatBytes 同規則，兩邊數字才對得上。
   小於 1 的非零值走指數表示（3.86e-7 B），不會被寫成 0。 */
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
export const fmtBytes = (bytes: number): string => {
  const n = Number(bytes) || 0;
  if (n === 0) return '0 B';
  let v = Math.abs(n), i = 0;
  for (;;) {
    const r = Number(v.toPrecision(3));
    if (r >= 1000 && i < BYTE_UNITS.length - 1) { v = v / 1000; i++; continue; }
    return (n < 0 ? '-' : '') + String(r) + ' ' + BYTE_UNITS[i];
  }
};
/* 依邊的單位選尺：delta_bps 是「速率的差」→ 帶 + 號的 bps；
   read/write_bytes_per_sec 是絕對速率 → bytes/s、不帶號（帶號會被誤讀成增量）。 */
export const fmtRate = (v: number, unit: RateUnit): string =>
  unit === 'bytesPerSec' ? fmtBytes(v) + '/s' : fmtDelta(v);
/* 同上但不帶號（殘差、摘要表用） */
export const fmtAmount = (v: number, unit: RateUnit): string =>
  unit === 'bytesPerSec' ? fmtBytes(v) + '/s' : fmtBps(v);
