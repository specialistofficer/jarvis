@echo off
cd /d "%~dp0\..\.."
start "Jarvis Dashboard" http://localhost:5173
npm run dev:dashboard
