@echo off
rem Runs every automated test. Start the app first (run.bat).
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%server"
call npm run test:api
if errorlevel 1 ( echo API tests FAILED & exit /b 1 )
cd /d "%ROOT%e2e"
if not exist node_modules ( call npm install )
if "%WEB_URL%"=="" set "WEB_URL=http://localhost:5173"
call npm test
if errorlevel 1 ( echo Browser tests FAILED & exit /b 1 )
echo.
echo All tests passed.
endlocal
