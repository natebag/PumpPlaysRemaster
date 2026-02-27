@echo off
title PUMP PLAYS REMASTER
cd /d "%~dp0"

echo.
echo  ===========================================
echo     PUMP PLAYS REMASTER
echo     Pokemon 30th Anniversary Edition
echo  ===========================================
echo.

:: Read ACTIVE_GAME from .env
set "ACTIVE_GAME=pokemon-leafgreen"
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if "%%A"=="ACTIVE_GAME" set "ACTIVE_GAME=%%B"
)

echo  Game:     %ACTIVE_GAME%
echo  Backend:  http://localhost:4000
echo  Overlay:  http://localhost:4001
echo.

:: Kill stale processes on ports 4000/4001 from previous runs
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":4000.*LISTENING" 2^>nul') do taskkill /PID %%P /F >nul 2>&1
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":4001.*LISTENING" 2^>nul') do taskkill /PID %%P /F >nul 2>&1

:: Start the Node.js backend — it auto-launches the correct emulator
echo  Starting backend (emulator auto-launches based on game config)...
echo.
start "PUMP PLAYS - Backend" /D "%~dp0" cmd /c "node src/index.js & pause"

echo.
echo  ===========================================
echo     SYSTEM LAUNCHED!
echo  ===========================================
echo.
echo  The backend will automatically:
echo    - Connect to pump.fun chat
echo    - Launch the correct emulator for %ACTIVE_GAME%
echo    - Start the overlay server on port 4001
echo.
echo  Game schedule (config/schedule.json):
echo    Mon: Emerald Rogue    Fri: Pinball
echo    Tue: LeafGreen        Sat: Stadium 2 (N64)
echo    Wed: Mystery Dungeon  Sun: Stadium 2 (N64)
echo    Thu: LeafGreen
echo.
echo  Switching games automatically closes old emulator
echo  and opens the new one (BizHawk / Project64 / Dolphin).
echo.
echo  Manual switch: curl -X POST http://localhost:4000/api/game/switch -H "Content-Type: application/json" -d "{\"gameId\": \"pokemon-stadium-2\"}"
echo.

pause
