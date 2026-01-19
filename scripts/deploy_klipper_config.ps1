# Klipper 配置部署脚本
# 用法: .\scripts\deploy_klipper_config.ps1

param(
    [string]$TargetHost = "rpi5.local",
    [string]$User = "user",
    [string]$ConfigPath = "klipper-config/printer.cfg",
    [string]$RemotePath = "~/printer_data/config/printer.cfg"
)

# 密码从环境变量读取，或使用默认值
$SshPassword = if ($env:RPI_PASSWORD) { $env:RPI_PASSWORD } else { "123456" }

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Klipper 配置部署脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 部署配置文件
Write-Host "[1/3] 部署 printer.cfg..." -ForegroundColor Yellow
$scpResult = scp $ConfigPath "${User}@${TargetHost}:${RemotePath}" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: 部署失败" -ForegroundColor Red
    Write-Host $scpResult
    exit 1
}
Write-Host "      完成" -ForegroundColor Green

# 2. 验证文件
Write-Host "[2/3] 验证文件..." -ForegroundColor Yellow
$verifyResult = ssh "${User}@${TargetHost}" "ls -la ${RemotePath}" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: 验证失败" -ForegroundColor Red
    exit 1
}
Write-Host "      $verifyResult" -ForegroundColor Gray

# 3. 重启 Klipper
Write-Host "[3/3] 重启 Klipper 服务..." -ForegroundColor Yellow
ssh "${User}@${TargetHost}" "echo ${SshPassword} | sudo -S systemctl restart klipper" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: 重启失败" -ForegroundColor Red
    exit 1
}

# 等待服务启动
Start-Sleep -Seconds 2

# 检查状态
$statusResult = ssh "${User}@${TargetHost}" "systemctl is-active klipper" 2>&1
if ($statusResult -eq "active") {
    Write-Host "      Klipper 服务运行中" -ForegroundColor Green
} else {
    Write-Host "WARNING: Klipper 状态异常: $statusResult" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " 部署完成!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
