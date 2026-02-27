@echo off
title PUMP PLAYS - Setup Check
cd /d "%~dp0"
node scripts/verify-setup.js
pause
