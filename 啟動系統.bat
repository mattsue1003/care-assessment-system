@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo 第一次啟動，正在安裝需要的元件...
  python -m venv .venv && .venv\Scripts\pip install -q -r requirements.txt
)
start "" http://127.0.0.1:5050
echo 系統啟動中...使用期間請不要關閉這個視窗。預設帳號 1111／密碼 1111
.venv\Scripts\python app.py %*
