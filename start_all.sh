#!/usr/bin/env bash
# ============================================================
# Orbit CRM — Master Startup Script (macOS)
# Starts: FastAPI backend + Cloudflare Tunnel + opens browser
# ============================================================

set -euo pipefail

# ======================== CONFIG =========================
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
VENV_DIR="$BACKEND_DIR/venv"
LOG_DIR="$PROJECT_DIR/logs"
BACKEND_LOG="$LOG_DIR/backend.log"
TUNNEL_LOG="$LOG_DIR/tunnel.log"
BACKEND_PORT=8000
TUNNEL_URL_FILE="$PROJECT_DIR/.tunnel_url"
# ==========================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

mkdir -p "$LOG_DIR"

log()  { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }

# ------------------- Port check & kill --------------------
check_port() {
    local port=$1
    local pid
    pid=$(lsof -ti tcp:"$port" 2>/dev/null || true)
    if [ -n "$pid" ]; then
        warn "Порт $port занят (PID: $pid). Освобождаю..."
        kill "$pid" 2>/dev/null || true
        sleep 2
        # Force kill if still running
        if lsof -ti tcp:"$port" >/dev/null 2>&1; then
            kill -9 "$pid" 2>/dev/null || true
            sleep 1
        fi
        ok "Порт $port освобождён"
    fi
}

# ------------------- Setup venv ----------------------------
setup_venv() {
    if [ ! -d "$VENV_DIR" ]; then
        log "Создаю виртуальное окружение..."
        python3 -m venv "$VENV_DIR"
        ok "venv создан в $VENV_DIR"
    fi

    source "$VENV_DIR/bin/activate"

    # Install/upgrade deps if needed
    if [ ! -f "$VENV_DIR/.deps_installed" ] || \
       [ "$BACKEND_DIR/requirements.txt" -nt "$VENV_DIR/.deps_installed" ]; then
        log "Устанавливаю зависимости Python..."
        pip install --quiet --upgrade pip
        pip install --quiet -r "$BACKEND_DIR/requirements.txt"
        touch "$VENV_DIR/.deps_installed"
        ok "Зависимости установлены"
    fi
}

# ------------------- Start Backend -------------------------
start_backend() {
    check_port "$BACKEND_PORT"

    log "Запускаю FastAPI бэкенд на порту $BACKEND_PORT..."
    cd "$BACKEND_DIR"

    # Add project root to PYTHONPATH so "backend.config" works
    PYTHONPATH="$PROJECT_DIR" \
    uvicorn backend.main:app \
        --host 0.0.0.0 \
        --port "$BACKEND_PORT" \
        --reload \
        >> "$BACKEND_LOG" 2>&1 &

    BACKEND_PID=$!
    echo "$BACKEND_PID" > "$LOG_DIR/backend.pid"

    # Wait for backend to be ready
    local retries=30
    while [ $retries -gt 0 ]; do
        if curl -s "http://localhost:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
            ok "Бэкенд запущен (PID: $BACKEND_PID)"
            return 0
        fi
        sleep 1
        retries=$((retries - 1))
    done

    err "Бэкенд не ответил за 30 секунд. Смотри: $BACKEND_LOG"
    return 1
}

# ------------------- Start Tunnel --------------------------
start_tunnel() {
    # Try cloudflared first, then ngrok
    if command -v cloudflared &>/dev/null; then
        log "Запускаю Cloudflare Tunnel..."
        cloudflared tunnel --url "http://localhost:$BACKEND_PORT" \
            >> "$TUNNEL_LOG" 2>&1 &
        TUNNEL_PID=$!
        echo "$TUNNEL_PID" > "$LOG_DIR/tunnel.pid"

        # Extract URL from log
        local retries=30
        while [ $retries -gt 0 ]; do
            TUNNEL_URL=$(grep -oP 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)
            if [ -n "$TUNNEL_URL" ]; then
                echo "$TUNNEL_URL" > "$TUNNEL_URL_FILE"
                ok "Cloudflare Tunnel: $TUNNEL_URL"
                return 0
            fi
            sleep 1
            retries=$((retries - 1))
        done
        warn "Cloudflare Tunnel не получил URL за 30 сек. Смотри: $TUNNEL_LOG"

    elif command -v ngrok &>/dev/null; then
        log "Запускаю Ngrok..."
        ngrok http "$BACKEND_PORT" >> "$TUNNEL_LOG" 2>&1 &
        TUNNEL_PID=$!
        echo "$TUNNEL_PID" > "$LOG_DIR/tunnel.pid"

        local retries=30
        while [ $retries -gt 0 ]; do
            TUNNEL_URL=$(curl -s http://localhost:4040/api/tunnels | \
                grep -oP '"public_url":"https://[^"]+' | head -1 | cut -d'"' -f4 || true)
            if [ -n "$TUNNEL_URL" ]; then
                echo "$TUNNEL_URL" > "$TUNNEL_URL_FILE"
                ok "Ngrok Tunnel: $TUNNEL_URL"
                return 0
            fi
            sleep 1
            retries=$((retries - 1))
        done
        warn "Ngrok не получил URL за 30 сек. Смотри: $TUNNEL_LOG"
    else
        warn "Ни cloudflared, ни ngrok не найдены. Туннель НЕ запущен."
        warn "Установите: brew install cloudflared  или  brew install ngrok"
    fi
}

# ------------------- Open Browser --------------------------
open_browser() {
    sleep 3
    log "Открываю браузер..."
    open "http://localhost:$BACKEND_PORT/docs" 2>/dev/null || true

    # Also try to open Vercel frontend if deployed
    if [ -f "$PROJECT_DIR/.vercel_url" ]; then
        VERCEL_URL=$(cat "$PROJECT_DIR/.vercel_url")
        open "$VERCEL_URL" 2>/dev/null || true
    fi
}

# ------------------- Cleanup on exit ----------------------
cleanup() {
    echo ""
    warn "Остановка сервисов..."
    [ -f "$LOG_DIR/backend.pid" ] && kill "$(cat "$LOG_DIR/backend.pid")" 2>/dev/null || true
    [ -f "$LOG_DIR/tunnel.pid" ] && kill "$(cat "$LOG_DIR/tunnel.pid")" 2>/dev/null || true
    ok "Сервисы остановлены. Логи: $LOG_DIR"
    exit 0
}

trap cleanup SIGINT SIGTERM

# ======================= MAIN =============================
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   🚀 Orbit CRM — Local Backend Launcher     ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""

setup_venv
start_backend
start_tunnel
open_browser

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  📡 Backend:  ${BLUE}http://localhost:$BACKEND_PORT${NC}"
echo -e "  📖 API Docs: ${BLUE}http://localhost:$BACKEND_PORT/docs${NC}"
[ -f "$TUNNEL_URL_FILE" ] && \
    echo -e "  🌍 Tunnel:   ${BLUE}$(cat "$TUNNEL_URL_FILE")${NC}"
echo -e "  📁 Logs:     ${BLUE}$LOG_DIR${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
log "Нажми Ctrl+C для остановки"
echo ""

# Keep script running
wait
