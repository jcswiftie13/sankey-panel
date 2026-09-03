# 多階段：build 階段產出 app/dist，runtime 只留 nginx + 靜態檔。

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

FROM nginx:1.27-alpine
COPY --from=build /src/app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
# 不寫 CMD：官方 nginx 映像自帶前景模式的 entrypoint。
