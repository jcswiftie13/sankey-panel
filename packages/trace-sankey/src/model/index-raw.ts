/* 步驟 0：id 索引 + parent 鏈查詢。parent 鏈可能成環或懸空：帶 visited set，懸空就回 null。 */
import type { RawIndex, WireGraph, WireNodeData } from './types.js';
import { str } from './util.js';

export const indexRaw = (doc: WireGraph): RawIndex => {
  const byId: Record<string, WireNodeData> = {};
  for (const nd of doc.elements.nodes) byId['k:' + nd.data.id] = nd.data;
  const get = (id: string): WireNodeData | null => byId['k:' + id] || null;
  const ancestorOf = (id: string, type: string): WireNodeData | null => {
    const seen = new Set<string>();
    let cur = get(id);
    while (cur && str(cur.parent) && !seen.has(cur.parent)) {
      seen.add(cur.parent);
      const p = get(cur.parent);
      if (!p) return null;
      if (p.type === type) return p;
      cur = p;
    }
    return null;
  };
  /* pod 的 ns 與 application：application 祖先優先，再 pod 自己的 namespace 祖先，最後 labels.namespace */
  const appOf = (id: string): WireNodeData | null => ancestorOf(id, 'application');
  const nsOfPod = (id: string): string | null => {
    const app = appOf(id);
    let ns = app ? ancestorOf(app.id, 'namespace') : null;
    if (!ns) ns = ancestorOf(id, 'namespace');
    if (ns) return str(ns.name) ? ns.name : ns.id;
    const d = get(id);
    return d && d.labels && str(d.labels.namespace) ? d.labels.namespace : null;
  };
  return { get, ancestorOf, appOf, nsOfPod };
};
