@echo off
REM ============================================================
REM Orbit CRM — Master Startup Script (Windows CMD/PowerShell)
REM Starts: OpenClaw Gateway + FastAPI backend + Cloudflare Tunnel + opens browser
REM ============================================================

setlocal enabledelayedexpansion

REM ======================== CONFIG =========================
set "PROJECT_DIR=%~dp0"
set "BACKEND_DIR=%PROJECT_DIR%backend"
set "VENV_DIR=%BACKEND_DIR%\venv"
set "LOG_DIR=%PROJECT_DIR%logs"
set "BACKEND_LOG=%LOG_DIR%\backend.log"
set "TUNNEL_LOG=%LOG_DIR%\tunnel.log"
set "BACKEND_PORT=8000"
set "OPENCLAW_PORT=18789"
set "TUNNEL_URL_FILE=%PROJECT_DIR%\.tunnel_url"
REM ==========================================================

REM Colors (ANSI)
for /f %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "RED=%ESC%[0;31m"
set "GREEN=%ESC%[0;32m"
set "YELLOW=%ESC%[1;33m"
set "BLUE=%ESC%[0;34m"
set "NC=%ESC%[0m"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo.
echo %GREEN%╔══════════════════════════════════════════════╗%NC%
echo %GREEN%║   🚀 Orbit CRM — Local Backend Launcher     ║%NC%
echo %GREEN%╚══════════════════════════════════════════════╝%NC%
echo.

REM ------------------- Check dependencies --------------------
echo %BLUE%[INFO]%NC% Проверка зависимостей...

where python >nul 2>nul
if errorlevel 1 (
    echo %RED%[ERR]%NC% Python не найден. Установите с https://python.org
    pause
    exit /b 1
)
python --version

where ollama >nul 2>nul
if errorlevel 1 (
    echo %GREEN%[OK]%NC% Ollama не установлен, и это нормально для удалённого LLM-провайдера.
) else (
    echo %YELLOW%[WARN]%NC% Ollama найден, но для этой сборки он не требуется.
)

where docker >nul 2>nul
if errorlevel 1 (
    echo %YELLOW%[WARN]%NC% Docker не найден. Нужен для OpenClaw и Google Maps Scraper
) else (
    docker --version
)

where cloudflared >nul 2>nul
if not errorlevel 1 (
    cloudflared --version
) else (
    where ngrok >nul 2>nul
    if not errorlevel 1 (
        ngrok version 2>&1 | findstr /r "^ngrok"
    ) else (
        echo %YELLOW%[WARN]%NC% Ни cloudflared, ни ngrok не найдены. Туннель НЕ запустится.
    )
)

REM ------------------- Start OpenClaw -----------------------
echo %BLUE%[INFO]%NC% Запуск OpenClaw Gateway...

if exist "%PROJECT_DIR%services\openclaw" (
    cd /d "%PROJECT_DIR%services\openclaw"

    REM Build image if needed
    docker image inspect openclaw:local >nul 2>nul
    if errorlevel 1 (
        echo %BLUE%[INFO]%NC% Собираю Docker image OpenClaw...
        docker compose build 2>nul
    )

    docker compose up -d openclaw-gateway 2>nul
    cd /d "%PROJECT_DIR%"

    REM Wait for health
    set "RETRIES=45"
    :WAIT_OPENCLAW
    curl -s "http://localhost:%OPENCLAW_PORT%/healthz" >nul 2>&1
    if not errorlevel 1 (
        echo %GREEN%[OK]%NC% OpenClaw Gateway запущен (порт %OPENCLAW_PORT%)
        goto OPENCLAW_READY
    )
    timeout /t 1 /nobreak >nul
    set /a RETRIES-=1
    if !RETRIES! gtr 0 goto WAIT_OPENCLAW
    echo %YELLOW%[WARN]%NC% OpenClaw не ответил за 45 сек
) else (
    echo %YELLOW%[WARN]%NC% services\openclaw не найден. OpenClaw не запущен.
)

:OPENCLAW_READY

REM ------------------- Setup venv ----------------------------
if not exist "%VENV_DIR%" (
    echo %BLUE%[INFO]%NC% Создаю виртуальное окружение...
    python -m venv "%VENV_DIR%"
    echo %GREEN%[OK]%NC% venv создан в %VENV_DIR%
)

call "%VENV_DIR%\Scripts\activate.bat"

set "NEED_INSTALL=0"
if not exist "%VENV_DIR%\.deps_installed" set "NEED_INSTALL=1"
if "%BACKEND_DIR%\requirements.txt" gtr "%VENV_DIR%\.deps_installed" set "NEED_INSTALL=1"

if "%NEED_INSTALL%"=="1" (
    echo %BLUE%[INFO]%NC% Устанавливаю зависимости Python...
    python -m pip install --upgrade pip -q
    python -m pip install -r "%BACKEND_DIR%\requirements.txt" -q
    type nul > "%VENV_DIR%\.deps_installed"
    echo %GREEN%[OK]%NC% Зависимости установлены
)

REM ------------------- Start gmaps scraper -------------------
echo %BLUE%[INFO]%NC% Запуск Google Maps Scraper...
if exist "%PROJECT_DIR%gmaps_scraper\docker-compose.yml" (
    cd /d "%PROJECT_DIR%gmaps_scraper"
    docker compose up -d 2>nul
    if not errorlevel 1 (
        echo %GREEN%[OK]%NC% Google Maps Scraper запущен на http://localhost:8080
    ) else (
        echo %YELLOW%[WARN]%NC% Не удалось запустить Google Maps Scraper (Docker)
    )
    cd /d "%PROJECT_DIR%"
) else (
    echo %YELLOW%[WARN]%NC% Папка gmaps_scraper не найдена
)

REM ------------------- Start Backend -------------------------
echo %BLUE%[INFO]%NC% Запускаю FastAPI бэкенд на порту %BACKEND_PORT%...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%BACKEND_PORT%') do (
    taskkill /F /PID %%a 2>nul
)
timeout /t 2 /nobreak >nul

cd /d "%BACKEND_DIR%"
set "PYTHONPATH=%PROJECT_DIR%"
start /B "" cmd /c "uvicorn backend.main:app --host 0.0.0.0 --port %BACKEND_PORT% --reload >> "%BACKEND_LOG%" 2>&1"

for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq python.exe" /FI "WINDOWTITLE eq *" /FO CSV ^| findstr /i uvicorn') do set "BACKEND_PID=%%~a"
echo %BACKEND_PID% > "%LOG_DIR%\backend.pid"

set "RETRIES=30"
:WAIT_BACKEND
curl -s "http://localhost:%BACKEND_PORT%/api/health" >nul 2>&1
if not errorlevel 1 (
    echo %GREEN%[OK]%NC% Бэкенд запущен (PID: %BACKEND_PID%)
    goto BACKEND_READY
)
timeout /t 1 /nobreak >nul
set /a RETRIES-=1
if %RETRIES% gtr 0 goto WAIT_BACKEND

echo %RED%[ERR]%NC% Бэкенд не ответил за 30 секунд. Смотри: %BACKEND_LOG%
pause
exit /b 1

:BACKEND_READY

REM ------------------- Start Tunnel --------------------------
where cloudflared >nul 2>nul
if not errorlevel 1 (
    echo %BLUE%[INFO]%NC% Запускаю Cloudflare Tunnel...
    start /B "" cmd /c "cloudflared tunnel --url http://localhost:%BACKEND_PORT% >> "%TUNNEL_LOG%" 2>&1"

    set "RETRIES=30"
    :WAIT_CF_URL
    for /f "tokens=*" %%a in ('type "%TUNNEL_LOG%" 2^>nul ^| findstr /R "https://.*\.trycloudflare\.com"') do (
        set "TUNNEL_URL=%%a"
    )
    if defined TUNNEL_URL (
        echo %TUNNEL_URL% > "%TUNNEL_URL_FILE%"
        echo %GREEN%[OK]%NC% Cloudflare Tunnel: %TUNNEL_URL%
        goto TUNNEL_DONE
    )
    timeout /t 1 /nobreak >nul
    set /a RETRIES-=1
    if %RETRIES% gtr 0 goto WAIT_CF_URL
    echo %YELLOW%[WARN]%NC% Cloudflare Tunnel не получил URL за 30 сек. Смотри: %TUNNEL_LOG%
    goto TUNNEL_DONE
)

where ngrok >nul 2>nul
if not errorlevel 1 (
    echo %BLUE%[INFO]%NC% Запускаю Ngrok...
    start /B "" cmd /c "ngrok http %BACKEND_PORT% >> "%TUNNEL_LOG%" 2>&1"

    set "RETRIES=30"
    :WAIT_NG_URL
    for /f "tokens=*" %%a in ('curl -s http://localhost:4040/api/tunnels 2^>nul ^| findstr /R "\"public_url\":\"https://[^\"]*"') do (
        set "LINE=%%a"
        for /f "tokens=2 delims=:" %%b in ("%%a") do set "TUNNEL_URL=%%b"
        set "TUNNEL_URL=!TUNNEL_URL:"=!"
        set "TUNNEL_URL=!TUNNEL_URL:,=!"
    )
    if defined TUNNEL_URL (
        echo %TUNNEL_URL% > "%TUNNEL_URL_FILE%"
        echo %GREEN%[OK]%NC% Ngrok Tunnel: %TUNNEL_URL%
        goto TUNNEL_DONE
    )
    timeout /t 1 /nobreak >nul
    set /a RETRIES-=1
    if %RETRIES% gtr 0 goto WAIT_NG_URL
    echo %YELLOW%[WARN]%NC% Ngrok не получил URL за 30 сек. Смотри: %TUNNEL_LOG%
    goto TUNNEL_DONE
)

echo %YELLOW%[WARN]%NC% Ни cloudflared, ни ngrok не найдены. Туннель НЕ запущен.

:TUNNEL_DONE

REM ------------------- Open Browser --------------------------
timeout /t 3 /nobreak >nul
echo %BLUE%[INFO]%NC% Открываю браузер...
start "" "http://localhost:%BACKEND_PORT%/docs"

REM ------------------- Summary ----------------------
echo.
echo %GREEN%━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%NC%
echo   🤖 OpenClaw:  %BLUE%http://localhost:%OPENCLAW_PORT%%NC%
echo   📡 Backend:    %BLUE%http://localhost:%BACKEND_PORT%%NC%
echo   📖 API Docs:   %BLUE%http://localhost:%BACKEND_PORT%/docs%%NC%
echo   🗺️  GMaps API:   %BLUE%http://localhost:8080%%NC%
if exist "%TUNNEL_URL_FILE%" (
    for /f "tokens=*" %%a in ('type "%TUNNEL_URL_FILE%"') do echo   🌍 Tunnel:     %BLUE%%%a%NC%
)
echo   📁 Logs:       %BLUE%%LOG_DIR%%NC%
echo %GREEN%━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%NC%
echo.
echo %BLUE%[INFO]%NC% Нажмите Ctrl+C для остановки
echo.

pause
