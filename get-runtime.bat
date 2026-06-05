@echo off
echo.
echo  Downloading Node.js runtime...
echo  (This only needs to be done once)
echo.

mkdir runtime 2>nul

curl -L --progress-bar "https://nodejs.org/dist/v22.14.0/win-x64/node.exe" -o "runtime\node.exe"

if exist "runtime\node.exe" (
  echo.
  echo  Done! Double-click start.bat to launch Album Tool.
) else (
  echo.
  echo  Download failed. Check your internet connection and try again.
)

echo.
pause
