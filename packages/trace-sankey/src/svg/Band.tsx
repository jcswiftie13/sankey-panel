/* 帶（一條邊）與帶上的數字。
   .band 與 data-tip 是套件對外契約：tooltip 靠 .band／g[data-tip] 委派、CSS 靠 .band:hover 換 fill。
   headless（Node 端字串渲染）才輸出原生 <title>：瀏覽器有 JS tooltip，留著會多一個瀏覽器自己的提示框。 */
import type { EdgeGeom } from '../layout/geometry.js';
import type { TraceEdge, TraceModelOk } from '../model/types.js';
import { OWN_T } from '../layout/constants.js';
import { backwardRibbon, lateralRibbon, ownLine, ribbon } from '../layout/paths.js';
import { bandMeta, bandTitle } from '../layout/tips.js';
import { fmtRate } from '../model/format.js';

export interface BandProps { e: TraceEdge; g: EdgeGeom; model: TraceModelOk; headless: boolean; p: string }

export const Band = ({ e, g, model, headless, p }: BandProps) => {
  const meta = bandMeta(e, model);
  const tip = JSON.stringify(meta);
  const isW = e.channel === 'write';
  const tt = bandTitle(e, meta);
  if (e.backward) {
    const backTitle = headless ? <title>{tt + '（回流）'}</title> : null;
    return g.backNear ? (
      /* 相鄰欄回流：整條活在兩欄之間的走廊，反向的一般帶 */
      <path className="band band-back" d={ribbon(g)} fill={'url(#' + p + 'gband-back)'}
        stroke="#fb7185" strokeOpacity=".35" strokeWidth="1" data-tip={tip}>{backTitle}</path>
    ) : (
      /* band-loop：fill 是 none，hover 只能加深 stroke，CSS 得認得出來 */
      <path className="band band-back band-loop" d={backwardRibbon(g)} fill="none"
        stroke="#fb7185" strokeOpacity=".55" strokeWidth={g.backT}
        strokeLinejoin="round" strokeLinecap="butt" data-tip={tip}>{backTitle}</path>
    );
  }
  /* 歸屬線：只表達「這個 port 掛的機器屬於誰」，量停在 port。灰虛線沿用葉卡外框的語彙，
     不新增顏色；stroke-linecap 留預設，短虛線才不會糊在一起。 */
  if (e.owns) {
    return (
      <path className="band band-own" d={ownLine(g)} fill="none"
        stroke="#94a3b8" strokeOpacity=".55" strokeWidth={OWN_T} strokeDasharray="5 4" data-tip={tip}>
        {headless ? <title>{meta.from + ' → ' + meta.to + '：歸屬（量停在 port）'}</title> : null}
      </path>
    );
  }
  /* 馬蹄弧一定終止在 target 右緣、且是朝 -x 進來的，所以固定一個朝左的三角形
     就永遠指對方向，不用算路徑切線。兄弟節點而非包在 band 裡：包起來會打斷
     .band:hover 與 tooltip 委派的 closest('.band')。 */
  const as = Math.max(5, Math.min(9, g.t2 / 2));   /* 細帶也看得見，粗帶不誇張 */
  return (
    <>
      <path className={'band' + (e.lateral ? ' band-lat' : '') + (isW ? ' band-w' : '')}
        d={e.lateral ? lateralRibbon(g, g.bulge!) : ribbon(g)} fill={'url(#' + p + (isW ? 'gband-w' : 'gband') + ')'}
        stroke={isW ? '#c2410c' : '#22d3ee'} strokeOpacity=".35" strokeWidth="1" data-tip={tip}>
        {headless ? <title>{tt}</title> : null}
      </path>
      {e.lateral && (
        <path className={'lat-arrow' + (isW ? ' arrow-w' : '')}
          d={'M' + (g.x2 + 4 + as * 2) + ',' + (g.y2 - as) +
            ' L' + (g.x2 + 4) + ',' + g.y2 +
            ' L' + (g.x2 + 4 + as * 2) + ',' + (g.y2 + as) + ' Z'} />
      )}
    </>
  );
};

/* 帶上的數字。橫向弧帶的數字放弧頂，回流帶放底部水平段中點，放中點會壓在欄上。
   歸屬線沒有量，印數字就是憑空生一個值——呼叫端跳過。 */
export const BandLabel = ({ e, g }: { e: TraceEdge; g: EdgeGeom }) => {
  const loop = e.backward && !g.backNear;
  const mx = loop ? (g.backXD! + g.backXU!) / 2 : e.lateral ? g.x1 + 0.72 * g.bulge! : (g.x1 + g.x2) / 2;
  const my = loop ? g.backY! - g.backT! / 2 - 10 : (g.y1 + g.y2) / 2;
  return (
    <text x={mx} y={my + 4} textAnchor="middle" className="p-val"
      style={{ paintOrder: 'stroke', stroke: '#0b1017', strokeWidth: '3.5px' }}>{fmtRate(e.bps, e.unit)}</text>
  );
};
