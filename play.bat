@echo off
title Ludo Royal — Play Server
cd /d "%~dp0"
echo ==========================================================
echo    Starting LUDO ROYAL (Multi-Device + Public Share Link)
echo ==========================================================
echo.
start "Ludo Royal Public Link" /min node tunnel.js
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"
node server.js
if errorlevel 1 (
  echo.
  echo [Notice] If port 3000 is already running, just use the opened browser tab!
  pause
)
