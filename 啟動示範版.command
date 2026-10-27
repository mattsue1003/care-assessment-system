#!/bin/bash
# 雙擊啟動「示範版」：使用去識別化的示範資料，可以隨意操作，不影響正式資料
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "第一次啟動，正在安裝需要的元件（約 1 分鐘）…"
  python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt || { echo "安裝失敗，請確認已安裝 Python 3"; read; exit 1; }
fi
mkdir -p data
if [ "$1" == "--reset" ] || [ ! -f data/demo_work.db ]; then cp demo/demo.db data/demo_work.db; echo "已載入全新示範資料"; fi
(sleep 2; open "http://127.0.0.1:5051") &
echo "示範版啟動中（http://127.0.0.1:5051）…帳號 1111／密碼 1111。要還原示範資料：在終端機執行 ./啟動示範版.command --reset"
CARE_DB=data/demo_work.db .venv/bin/python app.py --port 5051
