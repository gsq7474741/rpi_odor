# ESP32 Firmware Build and Upload Script
# Uses project-local uv virtual environment with PlatformIO
#
# Usage:
#   .\scripts\build_firmware.ps1           # Build only
#   .\scripts\build_firmware.ps1 -Upload   # Build and upload
#   .\scripts\build_firmware.ps1 -Monitor  # Build, upload, and open serial monitor
#   .\scripts\build_firmware.ps1 -Clean    # Clean build artifacts
#   .\scripts\build_firmware.ps1 -Port COM3 -Upload  # Specify port for upload

param(
    [switch]$Upload,
    [switch]$Monitor,
    [switch]$Clean,
    [string]$Port = "",
    [string]$Env = "featheresp32"
)

$ErrorActionPreference = "Stop"

# Configuration
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$FirmwareDir = Join-Path $ProjectRoot "enose-sensor-firmware"
$VenvDir = Join-Path $FirmwareDir ".venv"
$PioExe = Join-Path $VenvDir "Scripts\pio.exe"

Write-Host "=== E-Nose Sensor Firmware Build Script ===" -ForegroundColor Cyan

# ============================================
# Step 1: Check/Create Virtual Environment
# ============================================
function Ensure-VirtualEnv {
    if (-not (Test-Path $PioExe)) {
        Write-Host "`n[Setup] Creating virtual environment and installing PlatformIO..." -ForegroundColor Yellow
        
        # Check if uv is available
        try {
            uv --version | Out-Null
        } catch {
            throw "uv not installed. Please install: pip install uv"
        }
        
        # Create virtual environment
        Push-Location $FirmwareDir
        try {
            uv venv .venv
            if ($LASTEXITCODE -ne 0) { throw "Failed to create virtual environment" }
            
            uv pip install platformio
            if ($LASTEXITCODE -ne 0) { throw "Failed to install PlatformIO" }
        } finally {
            Pop-Location
        }
        
        Write-Host "  Virtual environment ready" -ForegroundColor Green
    }
}

# ============================================
# Step 2: Execute PlatformIO Commands
# ============================================
function Invoke-Pio {
    param([string[]]$Arguments)
    
    Write-Host "Running: pio $($Arguments -join ' ')" -ForegroundColor DarkGray
    
    Push-Location $FirmwareDir
    try {
        & $PioExe $Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "PlatformIO command failed (exit code: $LASTEXITCODE)"
        }
    } finally {
        Pop-Location
    }
}

# Ensure environment is ready
Ensure-VirtualEnv

# Build arguments
$pioArgs = @()

if ($Clean) {
    Write-Host "`n[Clean] Cleaning build artifacts..." -ForegroundColor Yellow
    Invoke-Pio @("run", "-e", $Env, "--target", "clean")
    Write-Host "  Clean complete" -ForegroundColor Green
    exit 0
}

# Build
Write-Host "`n[Build] Compiling firmware (env: $Env)..." -ForegroundColor Yellow
$buildArgs = @("run", "-e", $Env)
Invoke-Pio $buildArgs
Write-Host "  Build successful" -ForegroundColor Green

# Upload
if ($Upload -or $Monitor) {
    Write-Host "`n[Upload] Uploading firmware to ESP32..." -ForegroundColor Yellow
    
    $uploadArgs = @("run", "-e", $Env, "--target", "upload")
    if ($Port) {
        $uploadArgs += @("--upload-port", $Port)
    }
    
    Invoke-Pio $uploadArgs
    Write-Host "  Upload successful" -ForegroundColor Green
}

# Serial Monitor
if ($Monitor) {
    Write-Host "`n[Monitor] Opening serial monitor..." -ForegroundColor Yellow
    Write-Host "  Press Ctrl+C to exit" -ForegroundColor DarkGray
    
    $monitorArgs = @("device", "monitor")
    if ($Port) {
        $monitorArgs += @("--port", $Port)
    }
    
    Invoke-Pio $monitorArgs
}

Write-Host "`n=== Firmware operation complete! ===" -ForegroundColor Green
