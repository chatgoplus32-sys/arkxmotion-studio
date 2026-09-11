@echo off
echo Starting ArkX Motion Studio...
echo Backend: http://localhost:6000
echo Frontend: http://localhost:5173
echo.
cd /d D:\KOKO MITION\clone\arkxmotion-studio
npx concurrently "npx tsx server/index.ts" "npx vite"
