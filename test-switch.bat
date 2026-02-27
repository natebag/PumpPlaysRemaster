@echo off
title PUMP PLAYS - Game Switch Test
cd /d "%~dp0"

echo.
echo  ===========================================
echo     GAME SWITCH TEST
echo  ===========================================
echo.
echo  This test will:
echo    1. Start backend on port 5000
echo    2. Auto-launch BizHawk with LeafGreen
echo    3. Wait 60 seconds
echo    4. Auto-switch to Stadium 2 (kills BizHawk, starts ViGEm + Project64)
echo.

set "TEST_PORT=5000"
set "TEST_OVERLAY=5001"
set "SERVER_URL=http://localhost:%TEST_PORT%"

:: Kill anything on test ports
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%TEST_PORT%.*LISTENING" 2^>nul') do taskkill /PID %%P /F >nul 2>&1
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%TEST_OVERLAY%.*LISTENING" 2^>nul') do taskkill /PID %%P /F >nul 2>&1

:: Check ViGEm Python deps
echo  [PRE] Checking Python + vgamepad...
python -c "import vgamepad; print('  vgamepad OK')" 2>nul
if errorlevel 1 (
    echo  [WARN] vgamepad not installed. Installing now...
    pip install -r scripts\vigem\requirements.txt
)

:: Start backend with test ports (emulator auto-launches via adapter)
echo.
echo  [1/2] Starting backend on port %TEST_PORT%...
start "TEST - Backend" /D "%~dp0" cmd /c "set PORT=%TEST_PORT%&& set OVERLAY_PORT=%TEST_OVERLAY%&& set ACTIVE_GAME=pokemon-leafgreen&& node src/index.js & pause"

echo  Waiting for backend + BizHawk to launch...
timeout /t 6 /nobreak >nul

:: Verify backend is up
curl -s %SERVER_URL%/ >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Backend didn't start on port %TEST_PORT%
    pause
    exit /b 1
)

echo  [OK] Backend running
echo.
echo  ===========================================
echo     PHASE 1: LEAFGREEN (BizHawk)
echo  ===========================================
echo.
echo  Backend:   %SERVER_URL%
echo  Overlay:   http://localhost:%TEST_OVERLAY%
echo  Emulator:  BizHawk (auto-launched)
echo.
echo  Switching to Stadium 2 in 60 seconds...
echo  (Press Ctrl+C to cancel)
echo.

timeout /t 60 /nobreak

echo.
echo  ===========================================
echo     PHASE 2: SWITCHING TO STADIUM 2
echo  ===========================================
echo.
echo  [2/2] Sending game switch...
echo  (This will: kill BizHawk, start ViGEm server, launch Project64)
echo.

curl -s -X POST %SERVER_URL%/api/game/switch -H "Content-Type: application/json" -d "{\"gameId\": \"pokemon-stadium-2\"}"
echo.
echo.

:: Wait a few seconds for everything to spin up
timeout /t 5 /nobreak >nul

:: Show status
echo  Checking adapter status...
curl -s %SERVER_URL%/api/status 2>nul
echo.
echo.
echo  ===========================================
echo     SWITCH COMPLETE
echo  ===========================================
echo.
echo  BizHawk should be closed.
echo  Project64 should be open with Stadium 2.
echo  ViGEm server should be running on port 7777.
echo.
echo  Test an input:
echo    curl -X POST %SERVER_URL%/api/command -H "Content-Type: application/json" -d "{\"command\": \"a\"}"
echo.
echo  Switch back to LeafGreen:
echo    curl -X POST %SERVER_URL%/api/game/switch -H "Content-Type: application/json" -d "{\"gameId\": \"pokemon-leafgreen\"}"
echo.
echo  Press any key to shut down test...
pause >nul

:: Clean up everything
echo  Cleaning up...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%TEST_PORT%.*LISTENING" 2^>nul') do taskkill /PID %%P /F >nul 2>&1
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%TEST_OVERLAY%.*LISTENING" 2^>nul') do taskkill /PID %%P /F >nul 2>&1
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":7777.*LISTENING" 2^>nul') do taskkill /PID %%P /F >nul 2>&1
echo  Done.
