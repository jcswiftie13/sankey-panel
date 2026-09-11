# 一個 Dockerfile、兩種交付方式（共用同一個 build 階段）：
#   --target content  → 只有靜態檔的小映像，給 compose / k8s 倒進共享 volume（主要）
#   不加 --target     → 自足映像：nginx + 靜態檔 + 設定全包（次要，一行 docker run 就能跑）
# standalone 刻意放最後，所以 `docker build -t x .` 的行為與拆分之前完全相同。

FROM node:22-alpine AS build
WORKDIR /src
# 先只帶入 manifest 再 npm ci：改原始碼不會讓依賴層的快取失效。
# app/package.json 的 "trace-sankey": "*" 只能由 root 的 workspaces 解析，
# 所以 packages/ 的 manifest 一定要在 install 之前就位。
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY packages/trace-sankey/package.json packages/trace-sankey/
RUN npm ci
COPY . .
# root 的 build script 先 tsc 編 trace-sankey 套件（exports 的 default 指 dist/），再 vite build app。
# 順序寫死在 root package.json，不賭 npm --workspaces 的排序。
RUN npm run build

# 內容映像：只放 dist。用 busybox 不用 scratch，是因為 compose 的 init service 與
# k8s 的 initContainer 都要在裡面跑 `sh -c 'cp -a …'` 把內容倒進共享 volume——
# scratch 沒有 shell 也沒有 cp。busybox 本體約 1.5MB，不影響「小映像」的目的。
FROM busybox:1.36-musl AS content
COPY --from=build /src/app/dist /dist

FROM nginx:1.27-alpine AS standalone
COPY --from=build /src/app/dist /usr/share/nginx/html
# 掛的是 template：官方映像的 entrypoint 會在啟動時 envsubst 成 /etc/nginx/conf.d/default.conf。
COPY deploy/templates/ /etc/nginx/templates/
# NGINX_ENVSUBST_FILTER 是強制的（沒有它 conf 裡的 $host、$uri… 會被換成空字串，
# 而且 try_files 那行換完仍是合法語法，整站會靜默壞掉）——見 template 檔頭。
# TRACE_API_AUTH 給空字串是為了讓它「已定義」：未定義的話 envsubst 不認得它，
# dollar-brace 參照會原樣留在渲染結果裡。空字串 → nginx 整個不送 X-API-Key，
# 行為與加這段之前完全一樣。要注入 token 就 docker run -e TRACE_API_AUTH='sk-…'。
ENV NGINX_ENVSUBST_FILTER="^TRACE_" \
    TRACE_API_AUTH=""
EXPOSE 80
# 不寫 CMD：官方 nginx 映像自帶前景模式的 entrypoint。
