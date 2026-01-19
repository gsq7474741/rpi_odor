# 一键部署 enose-control 到 RPi5
# 用法: .\scripts\deploy_enose.ps1
# 可选参数: -Proto  同时更新 protobuf 文件

param(
    [switch]$Proto
)

$ErrorActionPreference = "Stop"
$RPI_HOST = "user@rpi5.local"
$RPI_PASS = "123456"
$PROJECT_DIR = "~/rpi_odor/enose-control"

Write-Host "=== E-Nose Control 部署脚本 ===" -ForegroundColor Cyan

# 1. 同步 proto 文件并重新生成 (可选)
if ($Proto) {
    Write-Host "`n[1/5] 同步 proto 文件并重新生成..." -ForegroundColor Yellow
    scp proto/*.proto "${RPI_HOST}:~/rpi_odor/proto/"
    if ($LASTEXITCODE -ne 0) { throw "Proto 文件同步失败" }
    ssh $RPI_HOST "cd ~/rpi_odor && bash scripts/gen_proto_local.sh"
    if ($LASTEXITCODE -ne 0) { throw "Proto 生成失败" }
    $totalSteps = 5
} else {
    Write-Host "`n(跳过 proto 生成，使用 -Proto 参数启用)" -ForegroundColor DarkGray
    $totalSteps = 4
}

# 2. 同步源代码
$step = if ($Proto) { 2 } else { 1 }
Write-Host "`n[$step/$totalSteps] 同步源代码..." -ForegroundColor Yellow
scp -r enose-control/src/* "${RPI_HOST}:${PROJECT_DIR}/src/"
if ($LASTEXITCODE -ne 0) { throw "源代码同步失败" }

# 3. 远程编译
$step++
Write-Host "`n[$step/$totalSteps] 远程编译..." -ForegroundColor Yellow
ssh $RPI_HOST "cd ${PROJECT_DIR}/build && make -j4"
if ($LASTEXITCODE -ne 0) { throw "编译失败" }

# 4. 重启服务
$step++
Write-Host "`n[$step/$totalSteps] 重启服务..." -ForegroundColor Yellow
ssh $RPI_HOST "echo $RPI_PASS | sudo -S systemctl restart enose-control"
if ($LASTEXITCODE -ne 0) { throw "重启服务失败" }

# 5. 检查状态
$step++
Write-Host "`n[$step/$totalSteps] 检查服务状态..." -ForegroundColor Yellow
Start-Sleep -Seconds 2
ssh $RPI_HOST "systemctl status enose-control --no-pager"

Write-Host "`n=== 部署完成! ===" -ForegroundColor Green
