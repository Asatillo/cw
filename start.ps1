Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

# ── Tests ────────────────────────────────────────────────────────────────────
Write-Host "`n==> Running tests..."

Push-Location "$Root\functions"
npm test
if ($LASTEXITCODE -ne 0) { Write-Error "Functions tests failed"; exit 1 }
Pop-Location

Push-Location "$Root\config-service"
npm test
if ($LASTEXITCODE -ne 0) { Write-Error "Config service tests failed"; exit 1 }
Pop-Location

Push-Location "$Root\inference-server"
.\venv\Scripts\Activate.ps1
pytest tests/
if ($LASTEXITCODE -ne 0) { Write-Error "Inference server tests failed"; exit 1 }
deactivate
Pop-Location

# ── Start services ────────────────────────────────────────────────────────────
Write-Host "`n==> All tests passed. Starting services..."

Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "Set-Location '$Root\config-service'; npm start"

Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "Set-Location '$Root'; npm run emulators:start"

Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "Set-Location '$Root\inference-server'; .\venv\Scripts\Activate.ps1; uvicorn main:app --host 127.0.0.1 --port 8000"

Write-Host ""
Write-Host "Services starting in separate windows:"
Write-Host "  Config Service:    http://127.0.0.1:3000"
Write-Host "  Firebase UI:       http://127.0.0.1:4000"
Write-Host "  Inference Server:  http://127.0.0.1:8000"
Write-Host ""
Write-Host "To publish requests, run: npm start --prefix publisher"