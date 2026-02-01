<#
.SYNOPSIS
    数据库迁移脚本 - 在 RPi5 的 TimescaleDB 容器中执行 SQL 迁移

.DESCRIPTION
    同步 SQL 文件到 RPi5 的 docker/migrations 目录，
    然后通过 Docker 挂载的目录执行迁移（避免 sudo 管道问题）

.PARAMETER File
    指定要执行的单个 SQL 文件名 (如 06-sensor-v2.sql)

.PARAMETER All
    执行所有 SQL 文件

.PARAMETER Sync
    仅同步文件，不执行迁移

.EXAMPLE
    .\scripts\migrate_db.ps1 -File 07-heater-profiles.sql

.EXAMPLE
    .\scripts\migrate_db.ps1 -All
#>

param(
    [string]$File = "",
    [switch]$All = $false,
    [switch]$Sync = $false
)

$ErrorActionPreference = "Stop"

# 配置
$RpiHost = "user@rpi5.local"
$RpiPassword = "123456"
$DbContainer = "enose-timescaledb"
$DbUser = "enose"
$DbName = "enose"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LocalMigrationDir = Join-Path $ProjectRoot "docker\init-db"
$RemoteDockerDir = "/home/user/rpi_odor/docker"
$RemoteMigrationDir = "$RemoteDockerDir/migrations"
$ContainerMigrationPath = "/migrations"  # Docker 内挂载路径

Write-Host "`n=== 数据库迁移脚本 ===" -ForegroundColor Cyan

# 检查本地目录存在
if (-not (Test-Path $LocalMigrationDir)) {
    Write-Host "迁移目录不存在: $LocalMigrationDir" -ForegroundColor Red
    exit 1
}

# 检查 SSH 连接
Write-Host "[1/4] 检查 SSH 连接..." -ForegroundColor Yellow
$sshTest = ssh -o ConnectTimeout=5 -o BatchMode=yes $RpiHost "echo ok" 2>&1
if ($sshTest -ne "ok") {
    Write-Host "  无法连接到 $RpiHost" -ForegroundColor Red
    exit 1
}
Write-Host "  SSH 连接正常" -ForegroundColor Green

# 同步迁移文件到远程
Write-Host "`n[2/4] 同步迁移文件到 RPi5..." -ForegroundColor Yellow

# 确保远程目录存在并修正权限 (echo password | sudo -S 处理非交互式 SSH)
Write-Host "  创建远程目录..." -ForegroundColor DarkGray
$mkdirResult = ssh $RpiHost "echo $RpiPassword | sudo -S mkdir -p $RemoteMigrationDir 2>/dev/null && echo $RpiPassword | sudo -S chown user:user $RemoteMigrationDir 2>/dev/null && echo $RpiPassword | sudo -S chmod 755 $RemoteMigrationDir 2>/dev/null && echo OK" 2>&1
if ($mkdirResult -match "OK") {
    Write-Host "  目录创建成功" -ForegroundColor Green
} else {
    Write-Host "  警告: 创建目录可能失败，继续尝试..." -ForegroundColor Yellow
    Write-Host "  $mkdirResult" -ForegroundColor DarkGray
}

# 使用 scp 批量复制
$sqlFiles = Get-ChildItem -Path $LocalMigrationDir -Filter "*.sql" | Sort-Object Name
$copyFailCount = 0
foreach ($f in $sqlFiles) {
    Write-Host "  复制: $($f.Name)" -ForegroundColor DarkGray
    & scp -q $f.FullName "${RpiHost}:${RemoteMigrationDir}/"
    if ($LASTEXITCODE -ne 0) { 
        Write-Host "    复制失败" -ForegroundColor Red
        $copyFailCount++
    }
}
if ($copyFailCount -gt 0) {
    Write-Host "  警告: $copyFailCount 个文件复制失败，尝试修复权限后重试..." -ForegroundColor Yellow
    ssh $RpiHost "echo $RpiPassword | sudo -S chown -R user:user $RemoteMigrationDir 2>/dev/null && echo $RpiPassword | sudo -S chmod -R 755 $RemoteMigrationDir 2>/dev/null"
    # 重试复制
    foreach ($f in $sqlFiles) {
        Write-Host "  重试: $($f.Name)" -ForegroundColor DarkGray
        & scp -q $f.FullName "${RpiHost}:${RemoteMigrationDir}/"
        if ($LASTEXITCODE -ne 0) { 
            Write-Host "    重试失败" -ForegroundColor Red
        }
    }
}
Write-Host "  同步完成: $($sqlFiles.Count) 个文件" -ForegroundColor Green

# 如果只是同步，到此结束
if ($Sync) {
    Write-Host "`n=== 同步完成 ===" -ForegroundColor Cyan
    exit 0
}

# 重启 TimescaleDB 容器以加载挂载目录 (使用 sudo docker)
Write-Host "`n[3/4] 重启 TimescaleDB 容器 (加载挂载目录)..." -ForegroundColor Yellow
$restartResult = ssh $RpiHost "cd $RemoteDockerDir && echo $RpiPassword | sudo -S docker compose restart timescaledb 2>&1" 2>&1
Write-Host "  $restartResult" -ForegroundColor DarkGray
Write-Host "  等待容器就绪..." -ForegroundColor DarkGray
Start-Sleep -Seconds 5

# 检查容器健康状态 (使用 sudo docker)
$healthCheck = ssh $RpiHost "echo $RpiPassword | sudo -S docker exec $DbContainer pg_isready -U $DbUser -d $DbName 2>&1" 2>&1
if ($healthCheck -notmatch "accepting connections") {
    Write-Host "  警告: 容器可能未就绪，继续尝试..." -ForegroundColor Yellow
    Write-Host "  $healthCheck" -ForegroundColor DarkGray
    Start-Sleep -Seconds 3
} else {
    Write-Host "  容器就绪" -ForegroundColor Green
}

# 获取要执行的文件
$filesToExecute = @()

if ($File) {
    $localPath = Join-Path $LocalMigrationDir $File
    if (-not (Test-Path $localPath)) {
        Write-Host "文件不存在: $localPath" -ForegroundColor Red
        exit 1
    }
    $filesToExecute += $File
} elseif ($All) {
    $files = Get-ChildItem -Path $LocalMigrationDir -Filter "*.sql" | Sort-Object Name
    foreach ($f in $files) {
        $filesToExecute += $f.Name
    }
} else {
    Write-Host "`n用法:" -ForegroundColor Yellow
    Write-Host "  .\scripts\migrate_db.ps1 -File <filename.sql>  # 执行单个文件"
    Write-Host "  .\scripts\migrate_db.ps1 -All                   # 执行所有文件"
    Write-Host "  .\scripts\migrate_db.ps1 -Sync                  # 仅同步文件"
    Write-Host ""
    Write-Host "可用的迁移文件:" -ForegroundColor Yellow
    $files = Get-ChildItem -Path $LocalMigrationDir -Filter "*.sql" | Sort-Object Name
    foreach ($f in $files) {
        Write-Host "  - $($f.Name)" -ForegroundColor DarkGray
    }
    exit 0
}

# 执行迁移
Write-Host "`n[4/4] 执行数据库迁移..." -ForegroundColor Yellow
$successCount = 0
$failCount = 0

foreach ($fileName in $filesToExecute) {
    Write-Host "`n  执行: $fileName" -ForegroundColor Cyan
    
    # 在容器内直接执行挂载目录中的 SQL 文件 (使用 sudo docker)
    $containerSqlPath = "$ContainerMigrationPath/$fileName"
    $cmd = "echo $RpiPassword | sudo -S docker exec $DbContainer psql -U $DbUser -d $DbName -f $containerSqlPath 2>&1"
    
    $result = ssh $RpiHost $cmd 2>&1
    $resultStr = $result -join "`n"
    
    # 显示原始输出
    Write-Host "--- psql 输出 ---" -ForegroundColor DarkGray
    foreach ($line in $result) {
        if ($line -match "ERROR:") {
            Write-Host "    $line" -ForegroundColor Red
        } elseif ($line -match "NOTICE:|WARNING:") {
            Write-Host "    $line" -ForegroundColor Yellow
        } elseif ($line -match "CREATE|INSERT|ALTER|DROP|SELECT") {
            Write-Host "    $line" -ForegroundColor Green
        } elseif ($line.Trim()) {
            Write-Host "    $line" -ForegroundColor DarkGray
        }
    }
    Write-Host "--- 输出结束 ---" -ForegroundColor DarkGray
    
    # 检查结果 - 忽略 "already exists" 类型的错误 (幂等性)
    $fatalErrors = $resultStr -split "`n" | Where-Object { 
        $_ -match "ERROR:" -and 
        $_ -notmatch "already exists" -and
        $_ -notmatch "does not exist, skipping"
    }
    
    if ($fatalErrors.Count -gt 0) {
        Write-Host "  结果: 失败 (有 $($fatalErrors.Count) 个致命错误)" -ForegroundColor Red
        $failCount++
    } else {
        $skippedErrors = ($resultStr -split "`n" | Where-Object { $_ -match "already exists" }).Count
        if ($skippedErrors -gt 0) {
            Write-Host "  结果: 成功 (跳过 $skippedErrors 个已存在对象)" -ForegroundColor Green
        } else {
            Write-Host "  结果: 成功" -ForegroundColor Green
        }
        $successCount++
    }
}

# 总结
Write-Host "`n=== 迁移完成 ===" -ForegroundColor Cyan
Write-Host "成功: $successCount" -ForegroundColor Green
if ($failCount -gt 0) {
    Write-Host "失败: $failCount" -ForegroundColor Red
    exit 1
}
