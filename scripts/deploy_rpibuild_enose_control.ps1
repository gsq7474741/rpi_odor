# RPi 远程编译并部署 enose-control
# 用法: .\scripts\deploy_rpibuild_enose_control.ps1
# 可选参数: -Proto  强制重新生成 protobuf (默认自动检测变更)

param(
    [switch]$Proto
)

$ErrorActionPreference = "Stop"

# 配置
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ProtoDir = Join-Path $ProjectRoot "proto"
$RPI_HOST = "user@192.168.1.235"
$RPI_PASS = "123456"
$REMOTE_DIR = "/home/user/rpi_odor"
$PROJECT_DIR = "$REMOTE_DIR/enose-control"

# Hash 缓存文件
$CacheDir = Join-Path $ProjectRoot ".cache"
$ProtoHashFile = Join-Path $CacheDir "proto_rpi.hash"

Write-Host "=== E-Nose RPi-Build 部署脚本 ===" -ForegroundColor Cyan

# 确保缓存目录存在
if (-not (Test-Path $CacheDir)) {
    New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null
}

# 计算文件 hash
function Get-FileHash256($path) {
    if (Test-Path $path) {
        return (Get-FileHash -Path $path -Algorithm SHA256).Hash
    }
    return ""
}

# 计算目录所有文件的组合 hash
function Get-DirHash($dir, $filter) {
    $files = Get-ChildItem -Path $dir -Filter $filter -File -ErrorAction SilentlyContinue | Sort-Object Name
    if ($files.Count -eq 0) { return "" }
    $combined = ($files | ForEach-Object { Get-FileHash256 $_.FullName }) -join ""
    return (Get-FileHash -InputStream ([System.IO.MemoryStream]::new([System.Text.Encoding]::UTF8.GetBytes($combined))) -Algorithm SHA256).Hash
}

# ============================================
# 步骤 1: 检查/生成 Protobuf (RPi 远程 buf)
# ============================================
$currentProtoHash = Get-DirHash $ProtoDir "*.proto"
$cachedProtoHash = if (Test-Path $ProtoHashFile) { Get-Content $ProtoHashFile } else { "" }

$needGenProto = $Proto -or ($currentProtoHash -ne $cachedProtoHash)

if ($needGenProto) {
    Write-Host "`n[1/5] 同步并生成 Protobuf (RPi buf)..." -ForegroundColor Yellow
    if ($Proto) {
        Write-Host "  (强制生成)" -ForegroundColor DarkGray
    } else {
        Write-Host "  (检测到 proto 文件变更)" -ForegroundColor DarkGray
    }
    
    # 同步 proto 目录
    scp -r "$ProtoDir/*" "${RPI_HOST}:${REMOTE_DIR}/proto/"
    if ($LASTEXITCODE -ne 0) { throw "Proto 文件同步失败" }
    
    # 在 RPi 上用 buf 生成
    ssh $RPI_HOST "cd ${REMOTE_DIR}/proto && buf dep update && buf generate --include-imports"
    if ($LASTEXITCODE -ne 0) { throw "Protobuf 生成失败" }
    
    # 保存 hash
    $currentProtoHash | Out-File -FilePath $ProtoHashFile -NoNewline
    Write-Host "  Protobuf 生成完成" -ForegroundColor Green
} else {
    Write-Host "`n[1/5] Protobuf 已是最新 (跳过生成)" -ForegroundColor DarkGray
}

# ============================================
# 步骤 2: 同步源代码
# ============================================
Write-Host "`n[2/5] 同步源代码..." -ForegroundColor Yellow
scp -r enose-control/src/* "${RPI_HOST}:${PROJECT_DIR}/src/"
if ($LASTEXITCODE -ne 0) { throw "源代码同步失败" }
Write-Host "  同步完成" -ForegroundColor Green

# ============================================
# 步骤 3: 远程编译
# ============================================
Write-Host "`n[3/5] 远程编译 enose-control..." -ForegroundColor Yellow
Write-Host "执行: ssh $RPI_HOST cd ${PROJECT_DIR}/build && cmake -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_COMPILER_LAUNCHER=ccache -DCMAKE_EXE_LINKER_FLAGS=""-fuse-ld=lld"" -DCMAKE_SHARED_LINKER_FLAGS=""-fuse-ld=lld"" -DCMAKE_MODULE_LINKER_FLAGS=""-fuse-ld=lld"" ..  && make -j4" -ForegroundColor Yellow
ssh $RPI_HOST "cd ${PROJECT_DIR}/build && cmake -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_COMPILER_LAUNCHER=ccache -DCMAKE_EXE_LINKER_FLAGS=""-fuse-ld=lld"" -DCMAKE_SHARED_LINKER_FLAGS=""-fuse-ld=lld"" -DCMAKE_MODULE_LINKER_FLAGS=""-fuse-ld=lld"" ..  && make -j4"
if ($LASTEXITCODE -ne 0) { throw "编译失败" }
Write-Host "  编译成功" -ForegroundColor Green

# ============================================
# 步骤 4: 重启服务
# ============================================
Write-Host "`n[4/5] 重启服务..." -ForegroundColor Yellow
ssh $RPI_HOST "echo $RPI_PASS | sudo -S systemctl restart enose-control"
if ($LASTEXITCODE -ne 0) { throw "重启服务失败" }

# ============================================
# 步骤 5: 检查服务状态
# ============================================
Write-Host "`n[5/5] 检查服务状态..." -ForegroundColor Yellow
Start-Sleep -Seconds 2
ssh $RPI_HOST "systemctl status enose-control --no-pager"

Write-Host "`n=== RPi 编译部署完成! ===" -ForegroundColor Green
