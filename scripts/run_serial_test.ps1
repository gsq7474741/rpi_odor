# Serial Test GUI Runner
# Launches the PyQt-based BME688 sensor test tool
#
# Usage:
#   .\scripts\run_serial_test.ps1

$ErrorActionPreference = "Stop"

# Configuration
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SerialTestDir = Join-Path $ProjectRoot "enose-sensor-firmware\serial_test"
$VenvDir = Join-Path $SerialTestDir ".venv"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"

Write-Host "=== BME688 Serial Test Tool ===" -ForegroundColor Cyan

# Check/Create virtual environment
if (-not (Test-Path $PythonExe)) {
    Write-Host "`n[Setup] Creating virtual environment..." -ForegroundColor Yellow
    
    try {
        uv --version | Out-Null
    } catch {
        throw "uv not installed. Please install: pip install uv"
    }
    
    Push-Location $SerialTestDir
    try {
        uv venv .venv
        if ($LASTEXITCODE -ne 0) { throw "Failed to create virtual environment" }
        
        uv pip install -e .
        if ($LASTEXITCODE -ne 0) { throw "Failed to install dependencies" }
    } finally {
        Pop-Location
    }
    
    Write-Host "  Environment ready" -ForegroundColor Green
}

# Run the GUI
Write-Host "`n[Run] Starting Serial Test GUI..." -ForegroundColor Yellow
Push-Location $SerialTestDir
try {
    & $PythonExe main.py
} finally {
    Pop-Location
}
