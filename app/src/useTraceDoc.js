/* 資料來源 hook：App 只消費 { doc, error, loading, lastQuery, source, run, showDoc }，
   不知道 doc 是怎麼來的——「資料怎麼來」全部關在這一個檔案裡。
   （POC 時代這裡是開檔＋拖放＋localStorage 續存；現在改成查 API，介面換了但職責沒變。）

   兩條進 doc 的路：run() 打 API，showDoc() 收現成的一份（dev 專用的內建範例與選檔）。
   兩條都走同一個 validate()——手改的 JSON 打錯字時，錯誤要從 app 的橫幅出來，
   不是從套件內部噴出來。

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
  const [source, setSource] = useState(null);    /* { kind:'api' } | { kind:'local', label } */
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
      setError({ title: '回應不合 elements wire JSON 契約（見 README「輸入 JSON 規格」）', messages: errs });
      setLoading(false);
      return;
    }
    setDoc(d);
    setLastQuery(params);
    setSource({ kind: 'api' });
    setError(null);
    setLoading(false);
  }, []);

  /* 本機來源：不打 API，但驗證與錯誤形狀跟 run() 完全一致。
     一定要先 abort——慢的舊查詢回來會蓋掉你剛載進來的那份。
     JSON.parse 失敗的呼叫端直接傳 json = null 進來就好：validate(null) 會回
     「最外層必須是 JSON 物件。」，自然落進同一個橫幅，不必開第二條錯誤通道。 */
  const showDoc = useCallback((json, label) => {
    if (abortRef.current) abortRef.current.abort();
    const errs = validate(json);
    if (errs.length) {
      setError({ title: label + '：不合 elements wire JSON 契約（見 README「輸入 JSON 規格」）', messages: errs });
      setLoading(false);
      return;
    }
    setDoc(json);
    setSource({ kind: 'local', label });
    setError(null);
    setLoading(false);
  }, []);

  return { doc, error, loading, lastQuery, source, run, showDoc };
}
