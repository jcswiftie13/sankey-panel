import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

/* StrictMode 開發模式會故意 mount → unmount → mount 一輪，
   幫我們驗證套件的 destroy() 有把 listener 與 body 上的 tooltip 收乾淨 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
