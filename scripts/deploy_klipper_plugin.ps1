# Klipper 插件部署脚本
# 用法: .\scripts\deploy_klipper_plugin.ps1
#
# 功能:
# 1. 部署 klipper-plugins/*.py 到 ~/klipper/klippy/extras/
# 2. 重启 Klipper 服务
# 3. 验证插件加载状态

param(
    [string]$TargetHost = "rpi5.local",
    [string]$User = "user",
    [string]$LocalPluginDir = "klipper-plugins",
    [string]$RemotePluginDir = "~/klipper/klippy/extras"
)

# 密码从环境变量读取，或使用默认值
$SshPassword = if ($env:RPI_PASSWORD) { $env:RPI_PASSWORD } else { "123456" }

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Klipper 插件部署脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查本地插件目录
if (-not (Test-Path $LocalPluginDir)) {
    Write-Host "ERROR: 插件目录不存在: $LocalPluginDir" -ForegroundColor Red
    exit 1
}

# 获取所有 .py 文件
$plugins = Get-ChildItem -Path $LocalPluginDir -Filter "*.py"
if ($plugins.Count -eq 0) {
    Write-Host "WARNING: 没有找到插件文件 (*.py)" -ForegroundColor Yellow
    exit 0
}

Write-Host "找到 $($plugins.Count) 个插件:" -ForegroundColor Gray
foreach ($plugin in $plugins) {
    Write-Host "  - $($plugin.Name)" -ForegroundColor Gray
}
Write-Host ""

# 1. 部署插件文件
Write-Host "[1/3] 部署插件文件..." -ForegroundColor Yellow
foreach ($plugin in $plugins) {
    $localPath = $plugin.FullName
    $remotePath = "${RemotePluginDir}/$($plugin.Name)"
    
    Write-Host "      $($plugin.Name) -> $remotePath" -ForegroundColor Gray
    $scpResult = scp $localPath "${User}@${TargetHost}:${remotePath}" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: 部署 $($plugin.Name) 失败" -ForegroundColor Red
        Write-Host $scpResult
        exit 1
    }
}
Write-Host "      完成" -ForegroundColor Green

# 2. 验证文件
Write-Host "[2/3] 验证远程文件..." -ForegroundColor Yellow
foreach ($plugin in $plugins) {
    $remotePath = "${RemotePluginDir}/$($plugin.Name)"
    $verifyResult = ssh "${User}@${TargetHost}" "ls -la $remotePath" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: 验证 $($plugin.Name) 失败" -ForegroundColor Red
        exit 1
    }
    Write-Host "      $verifyResult" -ForegroundColor Gray
}

# 3. 重启 Klipper
Write-Host "[3/3] 重启 Klipper 服务..." -ForegroundColor Yellow
ssh "${User}@${TargetHost}" "echo ${SshPassword} | sudo -S systemctl restart klipper" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: 重启 Klipper 失败" -ForegroundColor Red
    exit 1
}

# 等待服务启动
Start-Sleep -Seconds 3

# 检查状态
$statusResult = ssh "${User}@${TargetHost}" "systemctl is-active klipper" 2>&1
if ($statusResult -eq "active") {
    Write-Host "      Klipper 服务运行中" -ForegroundColor Green
} else {
    Write-Host "WARNING: Klipper 状态异常: $statusResult" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "查看 Klipper 日志:" -ForegroundColor Yellow
    ssh "${User}@${TargetHost}" "tail -20 ~/printer_data/logs/klippy.log" 2>&1
    exit 1
}

# 检查插件是否加载
Write-Host ""
Write-Host "验证插件加载..." -ForegroundColor Yellow
$logCheck = ssh "${User}@${TargetHost}" "grep -i 'enose' ~/printer_data/logs/klippy.log | tail -5" 2>&1
if ($logCheck) {
    Write-Host $logCheck -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " 部署完成!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "测试命令:" -ForegroundColor Yellow
Write-Host "  ENOSE_STATUS      - 查看插件状态" -ForegroundColor Gray
Write-Host "  ENOSE_FAST_STOP   - 急停所有电机" -ForegroundColor Gray
Write-Host "  ENOSE_PUMP_STOP   - 仅停止泵电机" -ForegroundColor Gray
