# 追查 Sankey：trace-sankey 套件 + React app + CLI。
# 網頁在 app/（Vite dev server）；CLI 只需要 python3。
PYTHON ?= python3
CLI    := $(PYTHON) tools/trace_sankey.py
FILE   ?= samples/classic.json
KIND   ?= sankey
OUT    ?= out.html
IMAGE  ?= trace-sankey
PORT   ?= 8080

.DEFAULT_GOAL := help
.PHONY: help dev serve build docker-build content-build up up-dev down draw mermaid html check golden clean

help:  ## 列出所有 target
	@echo "追查 Sankey — 可用指令："
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk -F':.*?## ' '{printf "  make %-10s %s\n", $$1, $$2}'
	@echo ""
	@echo "變數：FILE=<追查 JSON>  KIND=sankey|flow  OUT=<輸出 html>  DIR=<golden 輸出>"
	@echo "      IMAGE=<映像名>  PORT=<對外 port，會傳給 compose，不必改 yml>"
	@echo ""
	@echo "上 Kubernetes：kubectl apply -k deploy（設定走 ConfigMap，見 README）"

dev:  ## 起 React app 的 dev server（第一次要先 npm install）
	@npm run dev --workspace app

serve: dev  ## dev 的別名（沿用舊指令習慣）

build:  ## 建置前端靜態檔到 app/dist
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

draw:  ## CLI 文字報告（FILE=trace.json）
	@$(CLI) $(FILE)

mermaid:  ## 印 Mermaid（KIND=sankey 或 flow）
	@$(CLI) $(FILE) --mermaid $(KIND)

html:  ## 產 plotly 互動 HTML（需要 plotly；OUT=out.html）
	@$(CLI) $(FILE) --plotly $(OUT)

check:  ## 所有內建範例都跑一次 CLI
	@fail=0; for f in samples/*.json; do \
	  $(CLI) "$$f" >/dev/null 2>&1 || { echo "FAIL $$f"; fail=1; }; \
	done; \
	[ $$fail -eq 0 ] && echo "所有範例都通過。" || exit 1

golden:  ## dump 目前 render/summary 輸出（重構前後 diff -r 對拍用；DIR=輸出目錄）
	@node tools/golden.mjs dump $(or $(DIR),/tmp/golden)

clean:  ## 刪掉產生的輸出
	@rm -f $(OUT)
	@rm -rf app/dist
	@echo "清乾淨了。"
