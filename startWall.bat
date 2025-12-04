@echo off
setlocal

set BACKEND_TITLE=Backend Development (Node/Server)
set FRONTEND_TITLE=Frontend Development (Webpack/Vite)

echo Iniciando Backend e Frontend em janelas separadas...


start "%BACKEND_TITLE%" /d . cmd /c "npm run dev:backend"

start "%FRONTEND_TITLE%" /d . cmd /c "npm run dev:frontend -- --host"

echo.
echo =======================================================
echo.
echo Backend e Frontend iniciados.
echo Feche as janelas do console para parar os processos.
echo.
pause