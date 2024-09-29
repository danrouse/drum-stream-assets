@echo off
tasklist /nh /fi "ImageName eq Streamer.bot.exe" 2>nul | find /i "Streamer.bot.exe">nul
if "%ERRORLEVEL%" NEQ "0" (
  echo Starting Streamer.bot...
  start streamer.bot/Streamer.bot.exe
  timeout /T 10 > nul
) else (
  echo Streamer.bot is already running, continuing...
)

echo Starting music-stem-server...
cd music-stem-server
start cmd /k npm run dev
timeout /T 3 > nul

echo Starting electron-overlays...
cd ../electron-overlays
start cmd /k npm run dev
