@echo off
title Servidor FiberMap Tachira
echo ===================================================
echo     Iniciando el servidor de FiberMap Tachira...
echo ===================================================
echo.
echo Cambiando a la carpeta del backend...
cd /d "D:\Desktop\VS\ema\backend"

echo.
echo Abriendo tu navegador en la IP local...
start http://127.0.0.1:8000

echo.
echo Encendiendo el servidor... (No cierres esta ventana negra)
echo.
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
pause
