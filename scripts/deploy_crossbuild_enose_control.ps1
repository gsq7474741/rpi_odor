# 交叉编译并部署 enose-control 到 RPi5
# 用法: .\scripts\deploy_cross.ps1
# 可选参数: -Proto  强制重新生成 protobuf (默认自动检测变更)
#           -Force  强制重新构建 Docker 镜像

param(
    [switch]$Proto,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# 配置
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnoseControl = Join-Path $ProjectRoot "enose-control"
$ProtoDir = Join-Path $ProjectRoot "proto"
$DockerImage = "enose-cross-arm64"
$RPI_HOST = "user@192.168.1.235"
$RPI_PASS = "123456"
$REMOTE_DIR = "/home/user/rpi_odor/enose-control"

# Hash 缓存文件
$CacheDir = Join-Path $ProjectRoot ".cache"
$DockerHashFile = Join-Path $CacheDir "dockerfile.hash"
$ProtoHashFile = Join-Path $CacheDir "proto.hash"

Write-Host "=== E-Nose Cross-Compile 部署脚本 ===" -ForegroundColor Cyan

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

# 检查 Docker 是否运行
try {
    docker info 2>$null | Out-Null
} catch {
    throw "Docker 未运行，请先启动 Docker Desktop"
}

# ============================================
# 步骤 1: 检查/构建 Docker 镜像
# ============================================
$dockerfilePath = Join-Path $EnoseControl "Dockerfile.cross"
$currentDockerHash = Get-FileHash256 $dockerfilePath
$cachedDockerHash = if (Test-Path $DockerHashFile) { Get-Content $DockerHashFile } else { "" }

$needBuildImage = $Force -or ($currentDockerHash -ne $cachedDockerHash) -or ($null -eq (docker images -q $DockerImage 2>$null))

if ($needBuildImage) {
    Write-Host "`n[1/6] 构建 Docker 交叉编译镜像..." -ForegroundColor Yellow
    if ($Force) {
        Write-Host "  (强制重新构建)" -ForegroundColor DarkGray
    } elseif ($currentDockerHash -ne $cachedDockerHash) {
        Write-Host "  (检测到 Dockerfile 变更)" -ForegroundColor DarkGray
    } else {
        Write-Host "  (镜像不存在)" -ForegroundColor DarkGray
    }
    
    Write-Host "  执行命令: docker build --progress=plain --network=host -t $DockerImage -f $dockerfilePath $EnoseControl" -ForegroundColor Yellow
    & docker build --progress=plain --network=host -t $DockerImage -f $dockerfilePath $EnoseControl 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { throw "Docker 镜像构建失败" }
    
    # 保存 hash
    $currentDockerHash | Out-File -FilePath $DockerHashFile -NoNewline
    Write-Host "  Docker 镜像构建完成" -ForegroundColor Green
} else {
    Write-Host "`n[1/6] Docker 镜像已是最新 (跳过构建)" -ForegroundColor DarkGray
}

# ============================================
# 步骤 2: 检查/生成 Protobuf
# ============================================
$currentProtoHash = Get-DirHash $ProtoDir "*.proto"
$cachedProtoHash = if (Test-Path $ProtoHashFile) { Get-Content $ProtoHashFile } else { "" }

$needGenProto = $Proto -or ($currentProtoHash -ne $cachedProtoHash)

if ($needGenProto) {
    Write-Host "`n[2/6] 生成 Protobuf 代码 (容器内 buf)..." -ForegroundColor Yellow
    if ($Proto) {
        Write-Host "  (强制生成)" -ForegroundColor DarkGray
    } else {
        Write-Host "  (检测到 proto 文件变更)" -ForegroundColor DarkGray
    }
    
    $cmd = 'cd /src/proto && buf dep update && buf generate --include-imports'
    & docker run --rm -v "${ProjectRoot}:/src" $DockerImage bash -c $cmd 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { throw "Protobuf 生成失败" }
    
    # 保存 hash
    $currentProtoHash | Out-File -FilePath $ProtoHashFile -NoNewline
    Write-Host "  Protobuf 生成完成" -ForegroundColor Green
} else {
    Write-Host "`n[2/6] Protobuf 已是最新 (跳过生成)" -ForegroundColor DarkGray
}

# ============================================
# 步骤 3: 交叉编译
# ============================================
Write-Host "`n[3/6] 交叉编译 enose-control (arm64)..." -ForegroundColor Yellow

$cmd = 'cd /src/enose-control && mkdir -p build && cd build && cmake -GNinja -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE=/opt/toolchain-arm64.cmake -DCMAKE_PREFIX_PATH=/opt/cross-pi-arm64/usr .. && ninja -j$(nproc)'
& docker run --rm -v "${ProjectRoot}:/src" $DockerImage bash -c $cmd 2>&1 | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { throw "交叉编译失败" }
Write-Host "  编译成功" -ForegroundColor Green

# ============================================
# 步骤 4: 部署到 RPi5
# ============================================
Write-Host "`n[4/6] 部署到 RPi5..." -ForegroundColor Yellow

$binaryPath = Join-Path $EnoseControl "build\bin\enose-control"
if (-not (Test-Path $binaryPath)) {
    throw "编译产物不存在: $binaryPath"
}

# 确保远程目录存在
ssh $RPI_HOST "mkdir -p ${REMOTE_DIR}/build/bin ${REMOTE_DIR}/config"
if ($LASTEXITCODE -ne 0) { throw "创建远程目录失败" }

# 停止服务
ssh $RPI_HOST "echo $RPI_PASS | sudo -S systemctl stop enose-control"
if ($LASTEXITCODE -ne 0) { throw "停止服务失败" } 
Write-Host "  服务停止成功" -ForegroundColor Green

# 上传二进制文件
Write-Host "  上传二进制文件..." -ForegroundColor Yellow
& scp $binaryPath "${RPI_HOST}:${REMOTE_DIR}/build/bin/"
if ($LASTEXITCODE -ne 0) { throw "上传二进制文件失败" }

# 上传配置文件
$configPath = Join-Path $EnoseControl "config\config.json"
if (Test-Path $configPath) {
    Write-Host "  上传配置文件 config.json..." -ForegroundColor Yellow
    & scp $configPath "${RPI_HOST}:${REMOTE_DIR}/config/"
    if ($LASTEXITCODE -ne 0) { throw "上传配置文件失败" }
} else {
    Write-Host "  警告: 配置文件不存在: $configPath" -ForegroundColor Yellow
}

# # 上传 load_cell 配置文件
# # 目前不上传，因为配置文件在运行时会自动创建并手动校准
# $loadCellConfigPath = Join-Path $EnoseControl "config\load_cell.json"
# if (Test-Path $loadCellConfigPath) {
#     Write-Host "  上传配置文件 load_cell.json..." -ForegroundColor Yellow
#     & scp $loadCellConfigPath "${RPI_HOST}:${REMOTE_DIR}/config/"
#     if ($LASTEXITCODE -ne 0) { throw "上传 load_cell 配置文件失败" }
# } else {
#     Write-Host "  警告: load_cell 配置文件不存在: $loadCellConfigPath" -ForegroundColor Yellow
# }

Write-Host "  上传完成" -ForegroundColor Green

# 重启服务
ssh $RPI_HOST "echo $RPI_PASS | sudo -S systemctl restart enose-control"
if ($LASTEXITCODE -ne 0) { throw "重启服务失败" }

# ============================================
# 步骤 5: 检查服务状态
# ============================================
Write-Host "`n[5/6] 检查服务状态..." -ForegroundColor Yellow
Start-Sleep -Seconds 2
ssh $RPI_HOST "systemctl status enose-control --no-pager"

Write-Host "`n=== 交叉编译部署完成! ===" -ForegroundColor Green

# ============================================
# 步骤 6: 复制生成的 TypeScript 类型到前端
# ============================================
$genTsPath = Join-Path $ProjectRoot "gen\typescript"
$frontendGenPath = Join-Path $ProjectRoot "enose-ui\src\generated"

if (Test-Path $genTsPath) {
    Write-Host "`n[6/6] 复制 TypeScript 类型到前端..." -ForegroundColor Yellow
    Copy-Item -Path "$genTsPath\*" -Destination $frontendGenPath -Recurse -Force
    Write-Host "  复制完成: $frontendGenPath" -ForegroundColor Green
} else {
    Write-Host "`n[6/6] 跳过: 未找到生成的 TypeScript 文件" -ForegroundColor Yellow
}
