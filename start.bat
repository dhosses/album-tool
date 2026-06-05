@echo off
title Album Tool
cd /d "%~dp0"
echo.
echo  Album Tool
echo  Starting server...
echo.

rem Use bundled runtime if available, otherwise fall back to system node
if exist "%~dp0runtime\node.exe" (
  set NODE=%~dp0runtime\node.exe
) else (
  where node >nul 2>&1
  if %ERRORLEVEL% neq 0 (
    echo  ERROR: Node.js runtime not found.
    echo  Double-click get-runtime.bat to download it automatically.
    echo.
    pause
    exit /b 1
  )
  set NODE=node
)

rem Open browser after 2 second delay (runs in background)
start /b "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

echo  Running at http://localhost:3000
echo  Close this window to stop the server.
echo.

%NODE% server.js
