# 追查 Sankey：靜態網頁 + CLI。除了 python3 以外沒有相依。
PYTHON ?= python3
PORT   ?= 8765
HOST   ?= 127.0.0.1
CLI    := $(PYTHON) tools/trace_sankey.py
FILE   ?= samples/classic.json
KIND   ?= sankey
OUT    ?= out.html
URL    := http://$(HOST):$(PORT)/index.html

.DEFAULT_GOAL := help
.PHONY: help serve open demo draw mermaid html check clean

help:  ## 列出所有 target
	@echo "追查 Sankey — 可用指令："
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk -F':.*?## ' '{printf "  make %-10s %s\n", $$1, $$2}'
	@echo ""
	@echo "變數：FILE=<追查 JSON>  KIND=sankey|flow  OUT=<輸出 html>  PORT=$(PORT)"

serve:  ## 起本機 server（只綁 127.0.0.1，不讓瀏覽器快取）
	@echo "$(URL)"
	@$(PYTHON) tools/serve.py --host $(HOST) --port $(PORT)

open:  ## 起 server 並開瀏覽器
	@( sleep 1; command -v xdg-open >/dev/null && xdg-open "$(URL)" >/dev/null 2>&1 \
	   || echo "沒有 xdg-open，請自己開 $(URL)" ) &
	@$(MAKE) serve

demo:  ## 不開 server，直接用 file:// 開（離線可用）
	@command -v xdg-open >/dev/null && xdg-open "file://$(CURDIR)/index.html" >/dev/null 2>&1 \
	  || echo "請用瀏覽器開 file://$(CURDIR)/index.html"

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

clean:  ## 刪掉產生的輸出
	@rm -f $(OUT)
	@echo "清乾淨了。"
