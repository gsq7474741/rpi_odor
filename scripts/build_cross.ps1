# 本地 Docker 交叉编译脚本 for RPi5
param(
    [switch]$Build,      # 只编译
    [switch]$Deploy,     # 只部署
    [switch]$Proto       # 重新生成 protobuf
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnoseControl = Join-Path $ProjectRoot "enose-control"
$ProtoDir = Join-Path $ProjectRoot "proto"

$DockerImage = "enose-cross-arm64"
$RpiHost = "user@rpi5.local"
$RpiPassword = "123456"
$RemotePath = "/home/user/enose-control"

# 如果没有指定参数，默认执行 Build + Deploy
if (-not $Build -and -not $Deploy) {
    $Build = $true
    $Deploy = $true
}

function Write-Step($msg) {
    Write-Host "`n=== $msg ===" -ForegroundColor Cyan
}

# 检查 Docker 是否运行
function Check-Docker {
    try {
        docker info | Out-Null
        return $true
    } catch {
        Write-Host "ERROR: Docker 未运行，请先启动 Docker Desktop" -ForegroundColor Red
        return $false
    }
}

# 检查并设置 QEMU (用于模拟 arm64)
function Setup-Qemu {
    Write-Step "设置 QEMU 多架构支持"
    docker run --rm --privileged multiarch/qemu-user-static --reset -p yes 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "QEMU 设置失败，尝试继续..." -ForegroundColor Yellow
    }
}

# 构建 Docker 镜像
function Build-DockerImage {
    Write-Step "构建 Docker 交叉编译镜像 (首次需要编译依赖，约30-60分钟)"
    
    $dockerfilePath = Join-Path $EnoseControl "Dockerfile.cross"
    if (-not (Test-Path $dockerfilePath)) {
        Write-Host "ERROR: Dockerfile.cross 不存在" -ForegroundColor Red
        return $false
    }
    
    # 构建 x86 镜像（内含交叉编译工具链）
    Write-Host "docker build --network=host -t $DockerImage -f $dockerfilePath $EnoseControl"
    docker build --network=host -t $DockerImage -f $dockerfilePath $EnoseControl
    return $LASTEXITCODE -eq 0
}

# 检查镜像是否存在
function Check-Image {
    $result = docker images -q $DockerImage 2>$null
    return $result -ne $null -and $result -ne ""
}

# 生成 protobuf
function Generate-Proto {
    Write-Step "生成 Protobuf 代码"
    
    $protoFiles = Get-ChildItem -Path $ProtoDir -Filter "*.proto" -File
    if ($protoFiles.Count -eq 0) {
        Write-Host "没有找到 .proto 文件" -ForegroundColor Yellow
        return
    }
    
    # 使用单行命令避免 CRLF 问题
    $cmd = 'cd /src/proto && mkdir -p /src/enose-control/src/proto && for f in *.proto; do protoc --cpp_out=/src/enose-control/src/proto --grpc_out=/src/enose-control/src/proto --plugin=protoc-gen-grpc=/usr/bin/grpc_cpp_plugin -I. $f; done'
    
    docker run --rm --platform linux/arm64 `
        -v "${ProjectRoot}:/src" `
        $DockerImage `
        bash -c $cmd
}

# 编译项目
function Build-Project {
    Write-Step "编译 enose-control (arm64)"
    
    # 使用工具链文件进行交叉编译
    $cmd = "cd /src/enose-control && rm -rf build && mkdir -p build && cd build && cmake -GNinja -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE=/opt/toolchain-arm64.cmake -DCMAKE_PREFIX_PATH=/opt/cross-pi-arm64/usr .. && ninja -j`$(nproc)"
    
    docker run --rm `
        -v "${ProjectRoot}:/src" `
        $DockerImage `
        bash -c $cmd
    
    return $LASTEXITCODE -eq 0
}

# 部署到 RPi
function Deploy-Binary {
    Write-Step "部署到 RPi5"
    
    $binaryPath = Join-Path $EnoseControl "build\bin\enose-control"
    if (-not (Test-Path $binaryPath)) {
        Write-Host "ERROR: 编译产物不存在: $binaryPath" -ForegroundColor Red
        return $false
    }
    
    # 上传二进制文件
    Write-Host "上传 enose-control..."
    scp $binaryPath "${RpiHost}:${RemotePath}/bin/"
    
    # 重启服务
    Write-Host "重启服务..."
    ssh $RpiHost "echo $RpiPassword | sudo -S systemctl restart enose-control"
    
    # 检查状态
    Start-Sleep -Seconds 2
    ssh $RpiHost "systemctl status enose-control --no-pager -l | head -20"
    
    return $true
}

# 主流程
if (-not (Check-Docker)) {
    exit 1
}

if ($Build) {
    # 检查/构建镜像（真正的交叉编译，不需要 QEMU）
    if (-not (Check-Image)) {
        Write-Host "Docker 镜像不存在，开始构建..."
        if (-not (Build-DockerImage)) {
            Write-Host "ERROR: Docker 镜像构建失败" -ForegroundColor Red
            exit 1
        }
    }
    
    # 生成 protobuf
    if ($Proto) {
        Generate-Proto
    }
    
    # 编译
    if (-not (Build-Project)) {
        Write-Host "ERROR: 编译失败" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "`n编译成功!" -ForegroundColor Green
}

if ($Deploy) {
    if (-not (Deploy-Binary)) {
        Write-Host "ERROR: 部署失败" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "`n部署完成!" -ForegroundColor Green
}

Write-Host "`n=== 完成! ===" -ForegroundColor Green
