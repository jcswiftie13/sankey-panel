/* 資料來源 hook：App 只消費 { doc, error, loading, lastQuery, run }，
   不知道 doc 是怎麼來的——「資料怎麼來」全部關在這一個檔案裡。
   （POC 時代這裡是開檔＋拖放＋localStorage 續存；現在改成查 API，介面換了但職責沒變。）

   兩個順序約束：
   - 新查詢送出時先 abort 前一個，否則慢的舊回應會蓋掉新結果。
   - 卸載時也要 abort：React StrictMode 開發模式會故意 mount→unmount→mount 一輪。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { validate } from 'trace-sankey';
import { fetchTrace } from './api.js';

export function useTraceDoc() {
  const [doc, setDoc] = useState(null);          /* 開場沒有資料，App 顯示空狀態 */
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastQuery, setLastQuery] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  /* 三種失敗（連不到／HTTP 非 2xx、回應不是 JSON、不合契約）都只設 error、
     不動現有的 doc——查壞了不該把你正在看的圖清掉。 */
  const run = useCallback(async params => {
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);

    let d;
    try {
      d = await fetchTrace(params, { signal: ac.signal });
    } catch (e) {
      /* 被新查詢取代（或元件卸載）：連 loading 都不要碰，那已經是新查詢的狀態 */
      if (ac.signal.aborted) return;
      setError(e.kind === 'json'
        ? { title: '回應不是合法 JSON', messages: [e.message, e.detail].filter(Boolean) }
        : { title: '查詢失敗', messages: [e.message, e.detail].filter(Boolean) });
      setLoading(false);
      return;
    }
    if (ac.signal.aborted) return;

    const errs = validate(d);
    if (errs.length) {
      setError({ title: '回應不合追查 JSON 契約', messages: errs });
      setLoading(false);
      return;
    }
    setDoc(d);
    setLastQuery(params);
    setError(null);
    setLoading(false);
  }, []);

  return { doc, error, loading, lastQuery, run };
}
