/* build() 各處共用的小工具：型別守衛、組合鍵分隔字元、邊的加總。 */

export const num = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
export const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
export const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export const isStringMap = (v: unknown): v is Record<string, string> =>
  isObj(v) && Object.keys(v).every((k) => typeof v[k] === 'string');

/* 組合鍵的分隔字元：id／tier 是自由字串，用 NUL 才不會撞。寫成跳脫序列，
   別讓編輯器把看不見的字元吃掉。 */
export const SEP = '\u0000';

export const sum = (edges: { bps: number }[]): number => edges.reduce((s, e) => s + e.bps, 0);
