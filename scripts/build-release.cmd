@echo off
setlocal
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-release.ps1" %*
if errorlevel 1 (
  echo.
  echo 发布包生成失败，请查看上方日志。
  pause
)
endlocal
