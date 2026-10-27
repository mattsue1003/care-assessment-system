@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo 第一次啟動，正在安裝需要的元件...
  python -m venv .venv && .venv\Scripts\pip install -q -r requirements.txt
)
if not exist data mkdir data
if "%1"=="--reset" copy /y demo\demo.db data\demo_work.db >nul
if not exist data\demo_work.db copy demo\demo.db data\demo_work.db >nul
start "" http://127.0.0.1:5051
echo 示範版啟動中...帳號 1111／密碼 1111
set CARE_DEMO=1
set CARE_DB=data\demo_work.db
.venv\Scripts\python app.py --port 5051
