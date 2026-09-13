/* build() 包成 hook：doc／門檻／通道／layout／roots 任一變了才重算。會改 model 的選項一定要在
   deps 裡，不然改了不會重畫。doc 與 roots 請先過 useStableJson，否則每個新物件都會重算。 */
import { useMemo } from 'react';
import type { BuildOptions, TraceModel } from '../model/types.js';
import { build } from '../model/build.js';

export const useTraceModel = (doc: unknown, opts?: BuildOptions): TraceModel => {
  const minBps = opts?.minBps || 0;
  const channels = opts?.channels || 'both';
  const layout = opts?.layout === 'node' ? 'node' : 'flat';
  const roots = opts?.roots ?? null;
  return useMemo(() => build(doc, { minBps, channels, layout, roots }), [doc, minBps, channels, layout, roots]);
};
