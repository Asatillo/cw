Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

Write-Host "`n==> Installing functions deps"
Push-Location "$Root\functions"
npm install
Pop-Location

Write-Host "`n==> Installing config-service deps"
Push-Location "$Root\config-service"
npm install
Pop-Location

Write-Host "`n==> Installing publisher deps"
Push-Location "$Root\publisher"
npm install
Pop-Location

Write-Host "`n==> Setting up Python venv for inference-server"
Push-Location "$Root\inference-server"
if (-not (Test-Path "venv")) {
    python -m venv venv
}
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
deactivate
Pop-Location

Write-Host "`nSetup complete."