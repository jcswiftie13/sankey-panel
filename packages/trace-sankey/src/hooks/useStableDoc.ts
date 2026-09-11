/* 「內容相同的新物件」沿用舊參考：使用端每次 setState 給一份 JSON.parse 出來的新 doc，
   內容沒變就不該重算 model、更不該重新 fit 縮放。比對只在 identity 變時做一次
   （舊 mount.js 是每次 update 都 JSON.stringify）。回傳的參考變了才代表「換了一份資料」，
   useZoom 拿它決定要不要重設縮放。 */
import { useRef } from 'react';

export const useStableDoc = (doc: unknown): unknown => {
  const ref = useRef<{ doc: unknown; key: string } | null>(null);
  const cur = ref.current;
  if (!cur || cur.doc !== doc) {
    const key = JSON.stringify(doc);
    if (!cur || cur.key !== key) ref.current = { doc, key };
  }
  return ref.current!.doc;
};
