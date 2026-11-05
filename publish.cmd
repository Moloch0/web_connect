@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish.ps1" %*
if errorlevel 1 (
  echo.
  echo Publish failed. See the error above.
  pause
  exit /b 1
)
