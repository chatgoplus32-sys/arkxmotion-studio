@echo off
echo ========================================
echo   ARKXMotion Studio - Starting Servers
echo ========================================
echo.
echo Starting backend server...
start "Backend Server" cmd /k "cd /d D:\clone\arkxmotion-studio && npx tsx server/index.ts"
timeout /t 2 /nobreak >nul
echo Starting frontend server...
start "Frontend Server" cmd /k "cd /d D:\clone\arkxmotion-studio && npm run dev"
echo.
echo Both servers starting...
echo Backend:  http://localhost:3001
echo Frontend: http://localhost:5173
echo.
pause
