@echo off
rem Windows convenience launcher (used by local IDE previews): makes sure Node.js is on PATH, then runs "npm run dev".
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d %~dp0..
npm run dev
