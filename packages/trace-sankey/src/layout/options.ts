/* layout() 的選項。刻意不進 BuildOptions：換 order 不改 model（build 的輸出逐 byte 不變），
   只換版面——所以它不在 useTraceModel 的 deps 裡，而是在 layout 的 useMemo deps 裡。
   放獨立一支而不是塞進 geometry.ts（那個檔的檔頭明寫「layout() 的輸出」）或 model/types.ts
   （緊鄰 BuildOptions，遲早有人寫 build(doc, { order })）。 */

/** 欄內上下順序 */
export type NodeOrder =
  /** 流量大的在上（預設）。ns 分組與 k8s node 外框分區都保留，組之間與組內都照流量 */
  | 'flow'
  /** 上游重心（barycenter）：帶子最不互穿，是加上這個選項之前唯一的排法 */
  | 'barycenter';

export interface LayoutOptions {
  /** 欄內上下順序，預設 'flow' */
  order?: NodeOrder;
}

/** 預設只有這一份：layout() 與 <TraceSankey> 的 prop 預設都讀它，不抄第二遍 */
export const DEFAULT_ORDER: NodeOrder = 'flow';
