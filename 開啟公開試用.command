#!/bin/bash
# 開啟「公開試用網址」：在這台電腦跑示範版（假名資料），並透過 Cloudflare 產生 https://xxxx.trycloudflare.com
# 使用期間電腦需保持開機（本程式會防止睡眠）；關掉這個視窗網址就失效。
# 網路中斷時會自動重新連線；若通道重建，網址會改變，最新網址寫在 data/公開網址.txt
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || { python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; }
[ -x tools/cloudflared ] || { echo "缺少 tools/cloudflared，請先下載 Cloudflare 官方 cloudflared"; read; exit 1; }
mkdir -p data
[ -f data/demo_work.db ] || cp demo/demo.db data/demo_work.db
if ! lsof -ti tcp:5051 -sTCP:LISTEN >/dev/null; then
  CARE_DEMO=1 CARE_DB=data/demo_work.db caffeinate -dims .venv/bin/python app.py --port 5051 >> data/demo_server.log 2>&1 &
  APP=$!; trap "kill $APP 2>/dev/null" EXIT; sleep 2
fi
while true; do
  echo "正在產生公開網址…"
  tools/cloudflared tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:5051 2>&1 | tee -a data/tunnel.log | while read -r line; do
    url=$(echo "$line" | grep -o "https://[a-z0-9-]*\.trycloudflare\.com")
    if [ -n "$url" ]; then echo "$url" > data/公開網址.txt; echo ""; echo "★ 公開網址：$url"; echo ""; fi
  done
  echo "通道中斷，5 秒後自動重新連線…"; sleep 5
done
