@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0start-local.ps1" %*
if errorlevel 1 (
  echo.
  echo Startup failed. Review the error above.
  pause
)
endlocal
