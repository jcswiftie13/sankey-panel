/* doc 專用的 useStableJson（保留這個名字：react.ts 對外匯出過） */
import { useStableJson } from './useStableJson.js';

export const useStableDoc = (doc: unknown): unknown => useStableJson(doc);
