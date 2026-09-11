/* build() 包成 hook：doc／門檻／通道任一變了才重算。門檻與通道一定要在 deps 裡，不然改了不會重畫。
   doc 請先過 useStableDoc，否則每個新物件都會重算。 */
import { useMemo } from 'react';
import type { BuildOptions, TraceModel } from '../model/types.js';
import { build } from '../model/build.js';

export const useTraceModel = (doc: unknown, opts?: BuildOptions): TraceModel => {
  const minBps = opts?.minBps || 0;
  const channels = opts?.channels || 'both';
  return useMemo(() => build(doc, { minBps, channels }), [doc, minBps, channels]);
};
