@echo off
tasklist /nh /fi "ImageName eq Streamer.bot.exe" 2>nul | find /i "Streamer.bot.exe">nul
if "%ERRORLEVEL%" NEQ "0" (
  echo Starting Streamer.bot...
  start streamer.bot\Streamer.bot.exe
  timeout /T 10 > nul
) else (
  echo Streamer.bot is already running, continuing...
)

@REM tasklist /nh /fi "ImageName eq LiveSplit.exe" 2>nul | find /i "LiveSplit.exe">nul
@REM if "%ERRORLEVEL%" NEQ "0" (
@REM   echo Starting LiveSplit, activate the WebSocket server before continuing!
@REM   start L:\LiveSplitDevBuild\LiveSplit.exe
@REM   pause
@REM )

echo Starting music-stem-server...
cd music-stem-server
start cmd /k "npm run build && npm start"
timeout /T 10 > nul

echo Starting electron-overlays...
cd ../electron-overlays
start cmd /k npm start
