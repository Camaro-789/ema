@echo off
title Servidor FiberMap Tachira

echo ===================================================
echo     Iniciando el servidor de FiberMap Tachira...
echo ===================================================
echo.

:: El backend sirve TAMBIEN el frontend (main.py monta la carpeta frontend),
:: asi que un solo servidor levanta todo: la web y la API, juntos.
set "BACKEND=%~dp0backend"

:: 1) Liberar el puerto 8000 si ya estaba ocupado por una instancia previa
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    echo Cerrando instancia previa en puerto 8000 - PID %%a ...
    taskkill /F /PID %%a >nul 2>&1
)

:: 2) Verificar que existe el backend
if not exist "%BACKEND%\app\main.py" goto :sin_backend

:: 3) Buscar un Python que tenga uvicorn instalado
set "PY="
call :buscar "python"
call :buscar "py"
call :buscar "%LOCALAPPDATA%\Programs\Python\Python314\python.exe"
if not defined PY goto :sin_python
echo Python: %PY%
echo.

:: 4) Ir a la carpeta del backend
cd /d "%BACKEND%"

:: 5) Abrir el navegador 3 segundos despues, cuando el servidor ya responda
echo Abriendo la web en http://127.0.0.1:8000 ...
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:8000"

:: 6) Encender el servidor (sirve la web Y la API)
echo.
echo Encendiendo el servidor... (No cierres esta ventana negra)
echo.
"%PY%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

:: 7) Si el servidor se detiene, deja la ventana abierta para leer el error
echo.
echo [AVISO] El servidor se detuvo. Revisa el mensaje de arriba.
pause
exit /b 0

:: ---------------------------------------------------------------
:buscar
:: :buscar "programa" -> si sabe importar uvicorn, lo usa como Python
"%~1" -c "import uvicorn" >nul 2>&1
if %errorlevel% equ 0 if not defined PY set "PY=%~1"
exit /b 0

:sin_python
echo.
echo [ERROR] No se encontro ningun Python con uvicorn/fastapi instalados.
echo Instala las dependencias asi:
echo     cd backend
echo     python -m pip install -r requirements.txt
echo.
pause
exit /b 1

:sin_backend
echo.
echo [ERROR] No se encontro el backend en: "%BACKEND%"
echo.
pause
exit /b 1
