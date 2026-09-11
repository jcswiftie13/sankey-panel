# 追查 Sankey：trace-sankey 套件 + React app。
# 網頁在 app/（Vite dev server）；check／golden 只需要 node。
IMAGE  ?= trace-sankey
PORT   ?= 8080

.DEFAULT_GOAL := help
.PHONY: help dev serve build pkg-build docker-build content-build up up-dev down electron check golden clean

help:  ## 列出所有 target
	@echo "追查 Sankey — 可用指令："
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk -F':.*?## ' '{printf "  make %-10s %s\n", $$1, $$2}'
	@echo ""
	@echo "變數：DIR=<golden 輸出目錄>"
	@echo "      IMAGE=<映像名>  PORT=<對外 port，會傳給 compose 與 make electron，不必改 yml>"
	@echo ""
	@echo "上 Kubernetes：kubectl apply -k deploy（設定走 ConfigMap，見 README）"

dev:  ## 起 React app 的 dev server（第一次要先 npm install）
	@npm run dev --workspace app

serve: dev  ## dev 的別名（沿用舊指令習慣）

build: pkg-build  ## 建置前端靜態檔到 app/dist（先編套件）
	@npm run build --workspace app

docker-build:  ## 只建自足映像（nginx + 靜態檔全包），不啟動
	@docker build -t $(IMAGE) .

content-build:  ## 只建內容映像（幾 MB，給 compose / k8s 掛載用）
	@docker build --target content -t $(IMAGE)-content .

up:  ## 起分離式的 nginx + 內容 volume（預設 http://localhost:8080）
	@PORT=$(PORT) docker compose up -d --build
	@echo "開 http://localhost:$(PORT)"

up-dev:  ## 起 nginx 直接讀主機的 app/dist（要先 make build；改檔即生效）
	@PORT=$(PORT) docker compose -f docker-compose.dev.yml up -d
	@echo "開 http://localhost:$(PORT)（bind mount app/dist）"

down:  ## 停掉並移除容器（兩種跑法都關）
	@docker compose down
	@docker compose -f docker-compose.dev.yml down

electron:  ## 起 Electron 測試殼載 nginx 的畫面（先 make up；開關見 electron/README.md）
	@test -d electron/node_modules || { \
	  echo "先跑：cd electron && npm install"; exit 1; }
	@cd electron && env -u ELECTRON_RUN_AS_NODE SANKEY_URL=http://localhost:$(PORT) npm start

pkg-build:  ## 編譯 trace-sankey 套件（tsc → packages/trace-sankey/dist）；golden／check／build 都先做這步
	@npm run build --workspace trace-sankey

check: pkg-build  ## 所有範例（內建 + samples/ + stress/）都 build 一次，任何一份失敗就非零退出
	@node tools/golden.mjs check

golden: pkg-build  ## dump 目前 build/render/summary 輸出（重構前後對拍用；DIR=輸出目錄；比對用 node tools/golden.mjs cmp A B）
	@node tools/golden.mjs dump $(or $(DIR),/tmp/golden)

clean:  ## 刪掉產生的輸出
	@rm -rf app/dist packages/trace-sankey/dist
	@echo "清乾淨了。"
