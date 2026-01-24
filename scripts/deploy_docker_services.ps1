<#
.SYNOPSIS
    部署 E-Nose Docker 服务到树莓派
.DESCRIPTION
    将 docker-compose 配置同步到树莓派并启动服务 (TimescaleDB + Redis)
.PARAMETER Dev
    启用开发模式 (包含 pgAdmin 和 Redis Commander)
.PARAMETER Down
    停止并移除服务
.PARAMETER Logs
    查看服务日志
.PARAMETER Status
    查看服务状态
.PARAMETER Reset
    重置数据 (删除所有数据卷)
.EXAMPLE
    .\deploy_docker_services.ps1
    .\deploy_docker_services.ps1 -Dev
    .\deploy_docker_services.ps1 -Logs
    .\deploy_docker_services.ps1 -Down
#>

param(
    [switch]$Dev,
    [switch]$Down,
    [switch]$Logs,
    [switch]$Status,
    [switch]$Reset,
    [string]$TargetHost = "rpi5.local",
    [string]$User = "user",
    [string]$SshPassword = "123456"  
)

$ErrorActionPreference = "Stop"

# 路径配置
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$DockerDir = Join-Path $ProjectRoot "docker"
$RemoteDir = "/home/$User/rpi_odor/docker"

Write-Host "=== E-Nose Docker 服务部署 ===" -ForegroundColor Cyan

# 检查 SSH 连接
function Test-SSHConnection {
    Write-Host "[1/5] 检查 SSH 连接..." -ForegroundColor Yellow
    try {
        $result = ssh -o ConnectTimeout=5 -o BatchMode=yes "${User}@${TargetHost}" "echo ok" 2>&1
        if ($result -ne "ok") {
            throw "SSH 连接失败"
        }
        Write-Host "  SSH 连接正常" -ForegroundColor Green
    }
    catch {
        Write-Host "  SSH 连接失败，请检查网络和密钥配置" -ForegroundColor Red
        exit 1
    }
}

# 检查远程 Docker 环境
function Test-DockerEnvironment {
    Write-Host "[2/5] 检查 Docker 环境..." -ForegroundColor Yellow
    $null = ssh "${User}@${TargetHost}" "docker --version && docker compose version" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Docker 未安装，正在安装..." -ForegroundColor Yellow
        ssh "${User}@${TargetHost}" @"
            curl -fsSL https://get.docker.com | sh
            sudo usermod -aG docker $User
            echo '请重新登录以使 docker 组生效'
"@
        Write-Host "  Docker 安装完成，请重新运行此脚本" -ForegroundColor Yellow
        exit 0
    }
    Write-Host "  Docker 环境正常" -ForegroundColor Green
}

# 同步文件
function Sync-DockerFiles {
    Write-Host "[3/5] 同步 Docker 配置文件..." -ForegroundColor Yellow
    
    # 创建远程目录
    ssh "${User}@${TargetHost}" "mkdir -p ${RemoteDir}/init-db"
    
    # 同步文件
    scp -r "${DockerDir}/docker-compose.yml" "${User}@${TargetHost}:${RemoteDir}/"
    scp -r "${DockerDir}/init-db/" "${User}@${TargetHost}:${RemoteDir}/"
    
    # 同步或创建 .env 文件
    $envFile = Join-Path $DockerDir ".env"
    $envExampleFile = Join-Path $DockerDir ".env.example"
    
    if (Test-Path $envFile) {
        scp "${envFile}" "${User}@${TargetHost}:${RemoteDir}/.env"
    }
    elseif (Test-Path $envExampleFile) {
        scp "${envExampleFile}" "${User}@${TargetHost}:${RemoteDir}/.env"
        Write-Host "  注意: 使用了默认配置，建议修改 docker/.env 中的密码" -ForegroundColor Yellow
    }
    
    Write-Host "  文件同步完成" -ForegroundColor Green
}

# 启动服务
function Start-Services {
    Write-Host "[4/5] 启动 Docker 服务..." -ForegroundColor Yellow
    
    $profileArg = ""
    if ($Dev) {
        $profileArg = "--profile dev"
        Write-Host "  开发模式: 包含 pgAdmin 和 Redis Commander" -ForegroundColor Cyan
    }
    
    ssh "${User}@${TargetHost}" "cd ${RemoteDir} && echo ${SshPassword} | sudo -S docker compose ${profileArg} up -d"
    
    Write-Host "  服务启动完成" -ForegroundColor Green
}

# 检查服务状态
function Get-ServiceStatus {
    Write-Host "[5/5] 检查服务状态..." -ForegroundColor Yellow
    ssh "${User}@${TargetHost}" "cd ${RemoteDir} && echo ${SshPassword} | sudo -S docker compose ps"
    
    Write-Host ""
    Write-Host "=== 服务端点 ===" -ForegroundColor Cyan
    Write-Host "  TimescaleDB: postgresql://${TargetHost}:5432/enose"
    Write-Host "  Redis:       redis://${TargetHost}:6379"
    if ($Dev) {
        Write-Host "  pgAdmin:       http://${TargetHost}:8082"
        Write-Host "  RedisInsight:  http://${TargetHost}:5540"
    }
}

# 停止服务
function Stop-Services {
    Write-Host "停止 Docker 服务..." -ForegroundColor Yellow
    ssh "${User}@${TargetHost}" "cd ${RemoteDir} && echo ${SshPassword} | sudo -S docker compose --profile dev down"
    Write-Host "服务已停止" -ForegroundColor Green
}

# 查看日志
function Show-Logs {
    Write-Host "查看服务日志 (Ctrl+C 退出)..." -ForegroundColor Yellow
    ssh "${User}@${TargetHost}" "cd ${RemoteDir} && echo ${SshPassword} | sudo -S docker compose logs -f --tail=100"
}

# 重置数据
function Reset-Data {
    Write-Host "警告: 即将删除所有数据!" -ForegroundColor Red
    $confirm = Read-Host "输入 'yes' 确认"
    if ($confirm -ne "yes") {
        Write-Host "已取消" -ForegroundColor Yellow
        return
    }
    
    Write-Host "停止服务并删除数据..." -ForegroundColor Yellow
    ssh "${User}@${TargetHost}" "cd ${RemoteDir} && echo ${SshPassword} | sudo -S docker compose --profile dev down -v"
    Write-Host "数据已重置" -ForegroundColor Green
}

# 主逻辑
if ($Down) {
    Stop-Services
    exit 0
}

if ($Logs) {
    Show-Logs
    exit 0
}

if ($Status) {
    ssh "${User}@${TargetHost}" "cd ${RemoteDir} && echo ${SshPassword} | sudo -S docker compose ps"
    exit 0
}

if ($Reset) {
    Reset-Data
    exit 0
}

# 正常部署流程
Test-SSHConnection
Test-DockerEnvironment
Sync-DockerFiles
Start-Services
Get-ServiceStatus

Write-Host ""
Write-Host "=== 部署完成! ===" -ForegroundColor Green
Write-Host ""
Write-Host "常用命令:" -ForegroundColor Cyan
Write-Host "  查看日志:   .\deploy_docker_services.ps1 -Logs"
Write-Host "  查看状态:   .\deploy_docker_services.ps1 -Status"
Write-Host "  停止服务:   .\deploy_docker_services.ps1 -Down"
Write-Host "  开发模式:   .\deploy_docker_services.ps1 -Dev"
Write-Host "  重置数据:   .\deploy_docker_services.ps1 -Reset"
Write-Host ""
Write-Host "连接数据库:" -ForegroundColor Cyan
Write-Host "  psql postgresql://enose:enose_secure_password@${TargetHost}:5432/enose"
Write-Host "  redis-cli -h ${TargetHost}"
Write-Host ""
Write-Host "开发模式前端界面:" -ForegroundColor Cyan
Write-Host "  pgAdmin:      http://${TargetHost}:8082 (admin@example.com / admin)"
Write-Host "  RedisInsight: http://${TargetHost}:5540"