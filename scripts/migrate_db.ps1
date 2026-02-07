<#
.SYNOPSIS
    数据库迁移脚本 - 在 RPi5 的 TimescaleDB 容器中执行 SQL 迁移

.DESCRIPTION
    同步 SQL 文件到 RPi5 的 docker/migrations 目录，
    然后通过 Docker 挂载的目录执行迁移。
    使用 schema_migrations 表追踪已执行的迁移，-All 会自动跳过已执行的。

.PARAMETER File
    指定要执行的单个 SQL 文件名 (如 0005-sensor-v2.sql)，强制执行（不检查状态）

.PARAMETER All
    执行所有未执行的 SQL 文件（自动跳过 schema_migrations 中已记录的）

.PARAMETER Sync
    仅同步文件，不执行迁移

.PARAMETER Force
    与 -All 配合使用，忽略 schema_migrations 记录，强制重新执行所有文件

.EXAMPLE
    .\scripts\migrate_db.ps1 -File 0005-sensor-v2.sql

.EXAMPLE
    .\scripts\migrate_db.ps1 -All

.EXAMPLE
    .\scripts\migrate_db.ps1 -All -Force
#>

param(
    [string]$File = "",
    [switch]$All = $false,
    [switch]$Sync = $false,
    [switch]$Force = $false
)

$ErrorActionPreference = "Stop"

# 配置
$RpiHost = "user@rpi5.local"
$RpiPassword = "123456"
$DbContainer = "enose-timescaledb"
$DbUser = "enose"
$DbName = "enose"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LocalMigrationDir = Join-Path $ProjectRoot "docker\migrations"
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

# 使用 scp -r 一次性复制整个目录 (避免逐文件 SSH 握手)
$sqlFiles = Get-ChildItem -Path $LocalMigrationDir -Filter "*.sql"
Write-Host "  复制 $($sqlFiles.Count) 个文件..." -ForegroundColor DarkGray
& scp -r -q "${LocalMigrationDir}\*" "${RpiHost}:${RemoteMigrationDir}/"
if ($LASTEXITCODE -ne 0) {
    Write-Host "  首次复制失败，尝试修复权限后重试..." -ForegroundColor Yellow
    ssh $RpiHost "echo $RpiPassword | sudo -S chown -R user:user $RemoteMigrationDir 2>/dev/null && echo $RpiPassword | sudo -S chmod -R 755 $RemoteMigrationDir 2>/dev/null"
    & scp -r -q "${LocalMigrationDir}\*" "${RpiHost}:${RemoteMigrationDir}/"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  重试仍失败，退出" -ForegroundColor Red
        exit 1
    }
}
Write-Host "  同步完成: $($sqlFiles.Count) 个文件" -ForegroundColor Green

# 如果只是同步，到此结束
if ($Sync) {
    Write-Host "`n=== 同步完成 ===" -ForegroundColor Cyan
    exit 0
}

# 检查容器健康状态 (不再需要重启)
Write-Host "`n[3/5] 检查 TimescaleDB 容器状态..." -ForegroundColor Yellow
$healthCheck = ssh $RpiHost "echo $RpiPassword | sudo -S docker exec $DbContainer pg_isready -U $DbUser -d $DbName 2>&1" 2>&1
if ($healthCheck -notmatch "accepting connections") {
    Write-Host "  警告: 容器可能未就绪，尝试启动..." -ForegroundColor Yellow
    $startResult = ssh $RpiHost "cd $RemoteDockerDir && echo $RpiPassword | sudo -S docker compose up -d timescaledb 2>&1" 2>&1
    Write-Host "  $startResult" -ForegroundColor DarkGray
    Start-Sleep -Seconds 5
    $healthCheck = ssh $RpiHost "echo $RpiPassword | sudo -S docker exec $DbContainer pg_isready -U $DbUser -d $DbName 2>&1" 2>&1
    if ($healthCheck -notmatch "accepting connections") {
        Write-Host "  容器仍未就绪，退出" -ForegroundColor Red
        exit 1
    }
}
Write-Host "  容器就绪" -ForegroundColor Green

# 查询已执行的迁移
Write-Host "`n[4/5] 查询已执行的迁移..." -ForegroundColor Yellow
$appliedRaw = ssh $RpiHost "echo $RpiPassword | sudo -S docker exec $DbContainer psql -U $DbUser -d $DbName -t -A -c `"SELECT version FROM schema_migrations ORDER BY version`" 2>&1" 2>&1
$appliedMigrations = @()
if ($appliedRaw -and $appliedRaw -notmatch "ERROR:|does not exist") {
    $appliedMigrations = @($appliedRaw -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d{4}-' })
    Write-Host "  已执行 $($appliedMigrations.Count) 个迁移" -ForegroundColor Green
} else {
    Write-Host "  schema_migrations 表不存在或为空 (首次迁移)" -ForegroundColor Yellow
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
        # 提取版本号 (文件名去掉 .sql)
        $version = $f.BaseName
        if (-not $Force -and $appliedMigrations -contains $version) {
            Write-Host "  跳过 (已执行): $($f.Name)" -ForegroundColor DarkGray
            continue
        }
        $filesToExecute += $f.Name
    }
    if ($filesToExecute.Count -eq 0) {
        Write-Host "`n所有迁移已执行完毕，无需操作" -ForegroundColor Green
        exit 0
    }
    Write-Host "  待执行: $($filesToExecute.Count) 个迁移" -ForegroundColor Cyan
} else {
    Write-Host "`n用法:" -ForegroundColor Yellow
    Write-Host "  .\scripts\migrate_db.ps1 -File <filename.sql>  # 执行单个文件 (强制)"
    Write-Host "  .\scripts\migrate_db.ps1 -All                   # 执行所有未执行的文件"
    Write-Host "  .\scripts\migrate_db.ps1 -All -Force             # 强制重新执行所有文件"
    Write-Host "  .\scripts\migrate_db.ps1 -Sync                  # 仅同步文件"
    Write-Host ""
    Write-Host "可用的迁移文件:" -ForegroundColor Yellow
    $files = Get-ChildItem -Path $LocalMigrationDir -Filter "*.sql" | Sort-Object Name
    foreach ($f in $files) {
        $version = $f.BaseName
        if ($appliedMigrations -contains $version) {
            Write-Host "  [已执行] $($f.Name)" -ForegroundColor DarkGray
        } else {
            Write-Host "  [待执行] $($f.Name)" -ForegroundColor Yellow
        }
    }
    exit 0
}

# 执行迁移
Write-Host "`n[5/5] 执行数据库迁移..." -ForegroundColor Yellow
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
        
        # 记录已执行的迁移到 schema_migrations
        $version = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
        $insertCmd = "echo $RpiPassword | sudo -S docker exec $DbContainer psql -U $DbUser -d $DbName -c `"INSERT INTO schema_migrations (version) VALUES ('$version') ON CONFLICT (version) DO UPDATE SET applied_at = NOW()`" 2>&1"
        $insertResult = ssh $RpiHost $insertCmd 2>&1
        if ($insertResult -match "ERROR:") {
            Write-Host "  警告: 无法记录迁移状态 (schema_migrations 可能不存在)" -ForegroundColor Yellow
        }
    }
}

# 总结
Write-Host "`n=== 迁移完成 ===" -ForegroundColor Cyan
Write-Host "成功: $successCount" -ForegroundColor Green
if ($failCount -gt 0) {
    Write-Host "失败: $failCount" -ForegroundColor Red
    exit 1
}
