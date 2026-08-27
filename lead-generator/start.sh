#!/bin/bash
# Orbit Leads Prospector — Startup Script
# Usage: ./start.sh [dev|prod]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODE="${1:-dev}"

echo "╔══════════════════════════════════════════════════╗"
echo "║     Orbit Leads Prospector — Starting...        ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# 1. Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required. Install: brew install python3"
    exit 1
fi

PYTHON_VERSION=$(python3 --version 2>&1)
echo "✅ Found: $PYTHON_VERSION"

# 2. Check/Install dependencies
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate

echo "📦 Installing dependencies..."
pip install -q -r requirements.txt

# 3. Check .env file
if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found. Copying from .env.example..."
    cp .env.example .env
    echo "📝 Please edit .env with your Supabase and LLM settings"
fi

# 4. Check Ollama
echo ""
echo "🔍 Checking Ollama..."
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "✅ Ollama is running"
    
    # Check if llama3.2 is available
    if curl -s http://localhost:11434/api/tags | grep -q "llama3.2"; then
        echo "✅ Llama 3.2 model found"
    else
        echo "⚠️  Llama 3.2 not found. Pulling..."
        ollama pull llama3.2
    fi
else
    echo "⚠️  Ollama is not running."
    echo "   Start it with: ollama serve"
    echo "   Then pull the model: ollama pull llama3.2"
    echo ""
    echo "   Continuing anyway — the server will report Ollama as offline..."
fi

# 5. Install Playwright browsers (for OpenManus browser tool)
echo ""
echo "🌐 Checking Playwright..."
python3 -c "from playwright.sync_api import sync_playwright" 2>/dev/null || {
    echo "📦 Installing Playwright browsers..."
    playwright install chromium
}

# 6. Create reports directory
mkdir -p reports

# 7. Start the server
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  🚀 Starting Leads Prospector API              ║"
echo "║  📖 Docs: http://localhost:8090/docs            ║"
echo "║  🔗 API:  http://localhost:8090/api/health      ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

LEAD_GEN_PORT="${LEAD_GEN_PORT:-8090}"

if [ "$MODE" = "prod" ]; then
    python3 -m uvicorn main:app --host 0.0.0.0 --port "$LEAD_GEN_PORT" --workers 2
else
    python3 -m uvicorn main:app --host 0.0.0.0 --port "$LEAD_GEN_PORT" --reload
fi
