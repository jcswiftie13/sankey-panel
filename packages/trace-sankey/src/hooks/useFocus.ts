/* 專注模式：純 CSS（body.chart-focus），刻意不用 Fullscreen API——tooltip 掛在 body、進了全螢幕
   會消失。套件 CSS 只管容器去框；使用端要藏自己的工具列／圖例，自己對 body.chart-focus 加規則。
   進出專注容器尺寸會變，所以順手 refresh 縮放（重夾平移、更新倍率）。
   cleanup 一律移除 class：卸載（或 StrictMode 的 mount→unmount→mount）不會把 body 留在專注狀態。 */
import { useEffect, useRef } from 'react';

export const useFocus = (on: boolean, refresh: () => void): void => {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('chart-focus', on);
    refreshRef.current();
    return () => { document.body.classList.remove('chart-focus'); };
  }, [on]);
};
