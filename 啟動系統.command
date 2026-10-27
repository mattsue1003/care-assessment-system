#!/bin/bash
# 雙擊啟動「照護評估系統」（正式資料：data/care.db），瀏覽器會自動開啟 http://127.0.0.1:5050
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "第一次啟動，正在安裝需要的元件（約 1 分鐘）…"
  python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt || { echo "安裝失敗，請確認已安裝 Python 3"; read; exit 1; }
fi
(sleep 2; open "http://127.0.0.1:5050") &
echo "系統啟動中…使用期間請不要關閉這個視窗。預設帳號 1111／密碼 1111"
.venv/bin/python app.py "$@"
