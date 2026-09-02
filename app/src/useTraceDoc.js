/* 資料來源 hook：App 只消費 { doc, name, error, openFile, reset }，
   不知道 doc 是檔案來的還是 API 來的——「資料怎麼來」全部關在這一個檔案裡。

   ── 未來怎麼換成 API ──
   前後端分離後，把下面的 initial() 換成 fetch，開檔整段刪掉即可，App 的圖零改動：
     const [doc, setDoc] = useState(null);
     useEffect(() => {
       fetch('/api/trace/' + traceId)
         .then(r => r.json())
         .then(setDoc)
         .catch(e => setError({ title: '載入失敗', messages: [String(e)] }));
     }, [traceId]);
   App.jsx 那邊再把「開啟 JSON…」按鈕與拖放的 useEffect 刪掉就完成切換。

   ── iframe 鑲嵌注意 ──
   之後用 <iframe> 鑲進別的應用時：sandbox 屬性至少要 allow-scripts；
   沒給 allow-same-origin 的話 localStorage 一碰就 throw——
   所以這裡所有 localStorage 存取都包在 try/catch，被擋就當作沒有續存功能。 */
import { useState } from 'react';
import { validate } from 'trace-sankey';
import { byKey, defaultKey } from 'trace-sankey/samples';

/* localStorage 鍵沿用舊靜態頁時代的名字，升級過來的使用者資料還在 */
const LS_KEY = 'trace-sankey/custom';
const LS_NAME = 'trace-sankey/custom-name';

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

const SAMPLE = byKey[defaultKey];

/* 開場：localStorage 有存過檔就用它（壞了就靜默退回內建範例） */
function initial() {
  const raw = lsGet(LS_KEY);
  if (raw) {
    try {
      const doc = JSON.parse(raw);
      if (validate(doc).length === 0) {
        return { doc, name: lsGet(LS_NAME) || '自訂 JSON', custom: true };
      }
    } catch (e) { /* 存的內容壞了：走 fallback */ }
  }
  return { doc: SAMPLE.json, name: '內建範例：' + SAMPLE.name, custom: false };
}

export function useTraceDoc() {
  const [src, setSrc] = useState(initial);
  const [error, setError] = useState(null);

  /* 三種失敗（副檔名、JSON 語法、契約驗證）都只設 error、不動現有的 doc——
     壞檔不該毀掉你正在看的圖 */
  async function openFile(file) {
    if (!file) return;
    if (!/\.json$/i.test(file.name)) {
      setError({ title: '只接受 .json 檔案', messages: ['收到：' + file.name] });
      return;
    }
    let raw, doc;
    try { raw = await file.text(); }
    catch (e) { setError({ title: '讀不到檔案', messages: [file.name] }); return; }
    try { doc = JSON.parse(raw); }
    catch (e) {
      setError({ title: file.name + '：JSON 語法錯誤', messages: [e.message] });
      return;
    }
    const errs = validate(doc);
    if (errs.length) {
      setError({ title: file.name + '：不合追查 JSON 契約', messages: errs });
      return;
    }
    lsSet(LS_KEY, raw);
    lsSet(LS_NAME, file.name);
    setSrc({ doc, name: file.name, custom: true });
    setError(null);
  }

  function reset() {
    lsDel(LS_KEY);
    lsDel(LS_NAME);
    setSrc({ doc: SAMPLE.json, name: '內建範例：' + SAMPLE.name, custom: false });
    setError(null);
  }

  return { doc: src.doc, name: src.name, custom: src.custom, error, openFile, reset };
}
