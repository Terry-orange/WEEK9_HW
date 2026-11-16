@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在啟動「菜單與即時價格收集」本機伺服器...
start "" http://127.0.0.1:3000/
node server.js
pause
