#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Installing functions deps"
npm install --prefix "$ROOT/functions"

echo "==> Installing config-service deps"
npm install --prefix "$ROOT/config-service"

echo "==> Installing publisher deps"
npm install --prefix "$ROOT/publisher"

echo "==> Setting up Python venv for inference-server"
cd "$ROOT/inference-server"
[ -d venv ] || python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate
cd "$ROOT"

echo "Setup complete."