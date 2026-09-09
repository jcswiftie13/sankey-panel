/* dev 專用的本機資料來源列：內建範例下拉 ＋ 讀本機 .json。
   正式環境只能查 API——這支檔案只被 App 的 `if (import.meta.env.DEV)` 分支動態 import，
   production build 時 Vite 把 import.meta.env.DEV 靜態換成 false、整段 if 被消掉，
   連帶那個 import() 也消失，Rollup 根本不會產生這個 chunk。
   所以本檔可以放心「靜態」import 三十幾 KB 的範例資料，它不會有機會進 dist。
   （驗證方式見 README：build 完 grep app/dist 找範例字串，必須一行都沒有。） */
import { useRef, useState } from 'react';
import { list as SAMPLES } from 'trace-sankey/samples';

export function DevSampleBar({ onDoc }) {
  const [key, setKey] = useState('');
  const fileRef = useRef(null);

  function pick(k) {
    setKey(k);
    const s = SAMPLES.find(x => x.key === k);
    if (s) onDoc(s.json, '範例 ' + s.name);
  }

  /* 讀本機檔：samples/*.json 與 stress/*.json 都在 repo 根目錄、在 Vite root 之外，
     檔案挑選器是唯一不用改 vite.config.js（publicDir／fs.allow）就載得到它們的方式。
     用 <input type="file"> 而不是拖放：App 那個 capture 階段的 preventDefault effect
     會把 drop 事件吃掉（它擋的是「整頁導航到 file://」），不該為了這個功能去動它。 */
  function readFile(ev) {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    setKey('');                     /* 檔案與下拉選單互斥，選了檔就把下拉清成提示字 */
    const r = new FileReader();
    r.onload = () => {
      let json = null;
      let label = f.name;
      /* parse 失敗就把 null 送下去：showDoc 的 validate(null) 會回「最外層必須是
         JSON 物件。」，錯誤照樣從同一個橫幅出來，標題帶檔名與 parse 訊息。 */
      try { json = JSON.parse(String(r.result)); }
      catch (e) { label = f.name + '：不是合法 JSON — ' + e.message; }
      onDoc(json, label);
    };
    r.onerror = () => onDoc(null, f.name + '：讀不到檔案');
    r.readAsText(f);
    ev.target.value = '';           /* 連選兩次同一個檔也要觸發 change */
  }

  return (
    <div className="dev-src">
      <span className="dev-tag">dev</span>
      <select className="q-input" value={key} onChange={ev => pick(ev.target.value)} title="內建範例（trace-sankey/samples）">
        <option value="">內建範例…</option>
        {SAMPLES.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
      </select>
      <button className="btn" onClick={() => fileRef.current.click()} title="讀本機 .json（samples/、stress/）">
        選檔…
      </button>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={readFile} />
    </div>
  );
}
