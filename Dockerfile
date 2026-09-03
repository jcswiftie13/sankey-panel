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
# trace-sankey 套件沒有 build step（exports 直指 src/），整個建置只有這一步。
RUN npm run build --workspace app

# 內容映像：只放 dist。用 busybox 不用 scratch，是因為 compose 的 init service 與
# k8s 的 initContainer 都要在裡面跑 `sh -c 'cp -a …'` 把內容倒進共享 volume——
# scratch 沒有 shell 也沒有 cp。busybox 本體約 1.5MB，不影響「小映像」的目的。
FROM busybox:1.36-musl AS content
COPY --from=build /src/app/dist /dist

FROM nginx:1.27-alpine AS standalone
COPY --from=build /src/app/dist /usr/share/nginx/html
COPY deploy/conf.d/ /etc/nginx/conf.d/
EXPOSE 80
# 不寫 CMD：官方 nginx 映像自帶前景模式的 entrypoint。
