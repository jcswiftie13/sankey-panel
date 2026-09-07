import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  /* 開發時也讓 /api 走同源相對路徑，行為與正式環境（nginx proxy_pass）一致——
     前端程式裡永遠只有 '/api/trace'，沒有任何後端網址可以被 Vite 烤進 bundle。
     後端不在預設位置就用 VITE_DEV_API 指過去，例如：
       VITE_DEV_API=http://10.0.0.5:8000 make dev */
  server: {
    proxy: {
      '/api': { target: process.env.VITE_DEV_API || 'http://localhost:8000', changeOrigin: true },
    },
  },
});
