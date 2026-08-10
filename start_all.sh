#!/usr/bin/env bash
# ============================================================
# Orbit CRM — 1-Click Startup (macOS / Linux)
# Starts: FastAPI backend + Cloudflare Tunnel
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

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

mkdir -p "$LOG_DIR"

log()  { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[X]${NC} $1"; }

# ------------------- Port check & kill --------------------
check_port() {
    local port=$1
    local pid
    pid=$(lsof -ti tcp:"$port" 2>/dev/null || true)
    if [ -n "$pid" ]; then
        warn "Port $port is busy (PID: $pid). Freeing..."
        kill "$pid" 2>/dev/null || true
        sleep 2
        if lsof -ti tcp:"$port" >/dev/null 2>&1; then
            kill -9 "$pid" 2>/dev/null || true
            sleep 1
        fi
        ok "Port $port freed"
    fi
}

# ------------------- Setup venv ----------------------------
setup_venv() {
    if [ ! -d "$VENV_DIR" ]; then
        log "Creating Python virtual environment..."
        python3 -m venv "$VENV_DIR"
        ok "venv created at $VENV_DIR"
    fi

    source "$VENV_DIR/bin/activate"

    if [ ! -f "$VENV_DIR/.deps_installed" ] || \
       [ "$BACKEND_DIR/requirements.txt" -nt "$VENV_DIR/.deps_installed" ]; then
        log "Installing Python dependencies..."
        pip install --quiet --upgrade pip
        pip install --quiet -r "$BACKEND_DIR/requirements.txt"
        touch "$VENV_DIR/.deps_installed"
        ok "Dependencies installed"
    fi
}

# ------------------- Start Backend -------------------------
start_backend() {
    check_port "$BACKEND_PORT"

    log "Starting FastAPI backend on port $BACKEND_PORT..."
    cd "$BACKEND_DIR"

    PYTHONPATH="$PROJECT_DIR" \
    uvicorn backend.main:app \
        --host 0.0.0.0 \
        --port "$BACKEND_PORT" \
        --reload \
        >> "$BACKEND_LOG" 2>&1 &

    BACKEND_PID=$!
    echo "$BACKEND_PID" > "$LOG_DIR/backend.pid"

    local retries=30
    while [ $retries -gt 0 ]; do
        if curl -s "http://localhost:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
            ok "Backend running (PID: $BACKEND_PID)"
            return 0
        fi
        sleep 1
        retries=$((retries - 1))
    done

    err "Backend did not respond in 30s. Check: $BACKEND_LOG"
    return 1
}

# ------------------- Start Cloudflare Tunnel ---------------
start_tunnel() {
    log "Starting Cloudflare Tunnel..."
    rm -f "$TUNNEL_LOG"

    npx cloudflared tunnel --url "http://localhost:$BACKEND_PORT" \
        >> "$TUNNEL_LOG" 2>&1 &
    TUNNEL_PID=$!
    echo "$TUNNEL_PID" > "$LOG_DIR/tunnel.pid"

    local retries=45
    while [ $retries -gt 0 ]; do
        TUNNEL_URL=$(grep -oP 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)
        if [ -z "$TUNNEL_URL" ]; then
            TUNNEL_URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)
        fi
        if [ -n "$TUNNEL_URL" ]; then
            echo "$TUNNEL_URL" > "$TUNNEL_URL_FILE"
            ok "Cloudflare Tunnel active: $TUNNEL_URL"
            return 0
        fi
        sleep 1
        retries=$((retries - 1))
    done

    warn "Cloudflare Tunnel did not get URL in 45s. Check: $TUNNEL_LOG"
    return 0
}

# ------------------- Cleanup on exit ----------------------
cleanup() {
    echo ""
    warn "Stopping services..."
    [ -f "$LOG_DIR/backend.pid" ] && kill "$(cat "$LOG_DIR/backend.pid")" 2>/dev/null || true
    [ -f "$LOG_DIR/tunnel.pid" ] && kill "$(cat "$LOG_DIR/tunnel.pid")" 2>/dev/null || true
    ok "Services stopped. Logs: $LOG_DIR"
    exit 0
}

trap cleanup SIGINT SIGTERM

# ======================= MAIN =============================
echo ""
echo -e "${GREEN}==============================================${NC}"
echo -e "${GREEN}   Orbit CRM — 1-Click Backend Launcher       ${NC}"
echo -e "${GREEN}==============================================${NC}"
echo ""

setup_venv
start_backend
start_tunnel

echo ""
echo -e "${GREEN}==============================================${NC}"
echo -e "  Backend:   ${CYAN}http://localhost:$BACKEND_PORT${NC}"
echo -e "  API Docs:  ${CYAN}http://localhost:$BACKEND_PORT/docs${NC}"
if [ -f "$TUNNEL_URL_FILE" ]; then
    TUNNEL_URL=$(cat "$TUNNEL_URL_FILE")
    echo -e ""
    echo -e "  ${BOLD}Tunnel URL (set as VITE_API_URL in Vercel):${NC}"
    echo -e "  ${CYAN}${TUNNEL_URL}${NC}"
fi
echo -e ""
echo -e "  Logs:      ${CYAN}$LOG_DIR${NC}"
echo -e "${GREEN}==============================================${NC}"
echo ""
log "Press Ctrl+C to stop"
echo ""

wait
