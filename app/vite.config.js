import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* make dev 不經過 nginx，所以正式環境由 nginx 注入的那個 X-API-Key header
   在這裡要自己補一份，否則 dev 打後端會 401、與正式環境行為分歧。
   值同樣是 API key 本身，從 shell 的環境變數來（沿用下面 VITE_DEV_API 的慣例）：
     TRACE_API_AUTH='sk-…' make dev
   注意這是 process.env 不是 import.meta.env：它只在跑 Vite 的 Node 行程裡看得到，
   不會被烤進 bundle，瀏覽器一樣拿不到 token。 */
const devAuth = process.env.TRACE_API_AUTH;

export default defineConfig({
  plugins: [react()],
  /* 開發時也讓 /api 走同源相對路徑，行為與正式環境（nginx proxy_pass）一致——
     前端程式裡永遠只有 '/api/trace'，沒有任何後端網址可以被 Vite 烤進 bundle。
     後端不在預設位置就用 VITE_DEV_API 指過去，例如：
       VITE_DEV_API=http://10.0.0.5:8000 make dev */
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API || 'http://localhost:8000',
        changeOrigin: true,
        /* 沒設就整個不要有 headers：寫成 { 'X-API-Key': undefined } 會讓 http-proxy 送出壞 header。 */
        ...(devAuth ? { headers: { 'X-API-Key': devAuth } } : {}),
      },
    },
  },
});
