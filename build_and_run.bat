@echo off
REM One-click build and run for Token Zero Studio
REM Builds the Electron app and launches it

setlocal
cd /d "%~dp0"

echo.
echo [1/3] Installing dependencies (if needed)...
if not exist "node_modules" (
    npm install
)

echo.
echo [2/3] Building the app...
node scripts\build.mjs
if errorlevel 1 (
    echo Build failed!
    pause
    exit /b 1
)

echo.
echo [3/3] Launching Token Zero Studio...
echo.
npm start

endlocal
