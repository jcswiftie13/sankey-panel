/* 「內容相同的新物件」沿用舊參考：使用端每次 setState 給一份 JSON.parse 出來的新 doc（或每次 render
   都寫一個新的 roots 字面值），內容沒變就不該重算 model、更不該重新 fit 縮放。比對只在 identity 變時
   做一次（舊 mount.js 是每次 update 都 JSON.stringify）。回傳的參考變了才代表「換了一份資料」，
   useZoom 拿它決定要不要重設縮放。 */
import { useRef } from 'react';

export const useStableJson = <T>(v: T): T => {
  const ref = useRef<{ v: T; key: string } | null>(null);
  const cur = ref.current;
  if (!cur || cur.v !== v) {
    const key = JSON.stringify(v);
    if (!cur || cur.key !== key) ref.current = { v, key };
  }
  return ref.current!.v;
};
