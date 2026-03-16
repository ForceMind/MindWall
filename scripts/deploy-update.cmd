@echo off
setlocal
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-update.ps1" %*
if errorlevel 1 (
  echo.
  echo 部署失败，请查看上方日志。
  pause
)
endlocal
