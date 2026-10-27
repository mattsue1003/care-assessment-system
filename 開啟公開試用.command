#!/bin/bash
# 開啟「公開試用網址」：在這台電腦跑示範版（假名資料），並透過 Cloudflare 產生 https://xxxx.trycloudflare.com
# 使用期間電腦需保持開機（本程式會防止睡眠）；關掉這個視窗網址就失效。重開會得到新網址。
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || { python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; }
[ -x tools/cloudflared ] || { echo "缺少 tools/cloudflared，請先下載 Cloudflare 官方 cloudflared"; read; exit 1; }
mkdir -p data
[ -f data/demo_work.db ] || cp demo/demo.db data/demo_work.db
CARE_DEMO=1 CARE_DB=data/demo_work.db caffeinate -dims .venv/bin/python app.py --port 5051 > data/demo_server.log 2>&1 &
APP=$!
trap "kill $APP 2>/dev/null" EXIT
sleep 2
echo "正在產生公開網址…（網址會出現在下方，形如 https://xxxx.trycloudflare.com）"
tools/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:5051 2>&1 | tee data/tunnel.log | grep --line-buffered -o "https://[a-z0-9-]*\.trycloudflare\.com"
