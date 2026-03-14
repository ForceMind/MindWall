@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0deploy-update.ps1" %*
if errorlevel 1 (
  echo.
  echo Deploy failed. Review the error above.
  pause
)
endlocal

