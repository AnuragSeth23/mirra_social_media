@echo off
rem One click start for SocialAmbak on Windows: database (port 3308), API (4000) and web app (5173).
rem Edit the two paths below if your MySQL lives somewhere else, or start MySQL yourself and delete that block.
setlocal
set "ROOT=%~dp0"
set "MYSQLD=C:\Users\Anurag Seth\mysql-local\app\mysql-8.4.9-winx64\bin\mysqld.exe"
set "MYSQLCFG=C:\Users\Anurag Seth\mysql-mirra\my.ini"

netstat -ano | findstr ":3308 " | findstr LISTENING >nul
if errorlevel 1 (
  echo Starting MySQL on port 3308...
  start "" /min "%MYSQLD%" --defaults-file="%MYSQLCFG%"
  timeout /t 8 /nobreak >nul
) else (
  echo MySQL is already running on port 3308.
)

cd /d "%ROOT%server"
if not exist node_modules ( echo Installing server packages... & call npm install )
echo Applying database migrations...
call npm run migrate
start "SocialAmbak API (4000)" cmd /k "npm run dev"

cd /d "%ROOT%web"
if not exist node_modules ( echo Installing web packages... & call npm install )
start "SocialAmbak Web (5173)" cmd /k "npm run dev"

timeout /t 6 /nobreak >nul
start "" http://localhost:5173
echo.
echo SocialAmbak is starting. Close the two console windows to stop it.
endlocal
