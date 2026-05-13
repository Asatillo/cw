#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SKIP_TESTS=false
for arg in "$@"; do [[ "$arg" == "--skip-tests" ]] && SKIP_TESTS=true; done

# ── Tests ──────────────────────────────────────────────────────────────────
if $SKIP_TESTS; then
    echo "==> Skipping tests."
else
    echo "==> Running tests..."

    (cd "$ROOT/functions" && npm test) || { echo "Functions tests failed"; exit 1; }
    (cd "$ROOT/config-service" && npm test) || { echo "Config service tests failed"; exit 1; }
    (cd "$ROOT/inference-server" && source venv/bin/activate && pytest tests/ && deactivate) \
        || { echo "Inference server tests failed"; exit 1; }
fi

# ── Start services ─────────────────────────────────────────────────────────
echo "==> Starting services..."

(cd "$ROOT/config-service" && npm start) &
(cd "$ROOT" && npm run emulators:start) &
(cd "$ROOT/inference-server" && source venv/bin/activate && uvicorn main:app --host 127.0.0.1 --port 8000) &

echo ""
echo "Services running (Ctrl+C to stop all):"
echo "  Config Service:    http://127.0.0.1:3000"
echo "  Firebase UI:       http://127.0.0.1:4000"
echo "  Inference Server:  http://127.0.0.1:8000"
echo ""
echo "To publish requests: npm start --prefix publisher"

wait