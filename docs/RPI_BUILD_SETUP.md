# 树莓派 5 开发环境搭建指南

本文档描述如何在全新的树莓派 Ubuntu Server 镜像上搭建 `enose-control` C++ 项目的编译环境。

## 前置条件

- 树莓派 5
- Ubuntu Server 24.04 LTS (aarch64)
- 科学网络连接（部分依赖需要从 GitHub 下载）
- 至少 4GB RAM（编译 gRPC 需要较多内存）
- 约 10GB 可用磁盘空间

## 1. 基础依赖安装

```bash
sudo apt update && sudo apt upgrade -y

# 编译工具链和库
sudo apt install -y \
    build-essential \
    cmake \
    git \
    libboost-all-dev \
    nlohmann-json3-dev \
    libspdlog-dev \
    libc-ares-dev \
    libre2-dev \
    zlib1g-dev \
    libssl-dev \
    pkg-config \
    ccache \
    lld
```

## 2. 编译安装 Abseil (C++ 公共库)

系统自带的 Abseil 版本过低，需要从源码编译安装。

```bash
cd /tmp

# 下载 Abseil 20240722.0
curl -L https://github.com/abseil/abseil-cpp/archive/refs/tags/20240722.0.tar.gz -o abseil.tar.gz
tar -xzf abseil.tar.gz
cd abseil-cpp-20240722.0

# 配置
mkdir build && cd build
cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_STANDARD=17 \
    -DABSL_BUILD_TESTING=OFF \
    -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
    -DCMAKE_INSTALL_PREFIX=/usr/local

# 编译并安装 (约 5-10 分钟)
make -j4
sudo make install
sudo ldconfig
```

## 3. 编译安装 Protobuf v29

系统自带的 Protobuf 版本 (3.x) 过低，需要 v29+ 以支持最新特性。

```bash
cd /tmp

# 下载 Protobuf v33.4
curl -L https://github.com/protocolbuffers/protobuf/archive/refs/tags/v33.4.tar.gz -o protobuf.tar.gz
tar -xzf protobuf.tar.gz
cd protobuf-33.4

# 配置
mkdir build && cd build
cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_STANDARD=17 \
    -Dprotobuf_BUILD_TESTS=OFF \
    -Dprotobuf_BUILD_SHARED_LIBS=OFF \
    -Dprotobuf_ABSL_PROVIDER=package \
    -DCMAKE_INSTALL_PREFIX=/usr/local

# 编译并安装 (约 10-15 分钟)
make -j4
sudo make install
sudo ldconfig

# 验证安装
protoc --version
# 应输出: libprotoc 33.4
```

## 4. 编译安装 gRPC v1.76

系统自带的 gRPC 版本与 Protobuf v33 不兼容，需要从源码编译。

```bash
cd /tmp

# 克隆 gRPC 源码 (包含子模块会很大，这里只下载主仓库)
git clone --depth 1 --branch v1.76.0 https://github.com/grpc/grpc.git grpc-1.76.0
cd grpc-1.76.0

# 配置 (使用系统已安装的依赖)
mkdir -p cmake/build && cd cmake/build
cmake ../.. \
    -DCMAKE_BUILD_TYPE=Release \
    -DgRPC_INSTALL=ON \
    -DgRPC_BUILD_TESTS=OFF \
    -DgRPC_ABSL_PROVIDER=package \
    -DgRPC_CARES_PROVIDER=package \
    -DgRPC_PROTOBUF_PROVIDER=package \
    -DgRPC_RE2_PROVIDER=package \
    -DgRPC_SSL_PROVIDER=package \
    -DgRPC_ZLIB_PROVIDER=package \
    -DCMAKE_INSTALL_PREFIX=/usr/local

# 编译 (约 30-60 分钟，取决于 CPU 和内存)
make -j4

# 安装
sudo make install
sudo ldconfig

# 验证安装
which grpc_cpp_plugin
# 应输出: /usr/local/bin/grpc_cpp_plugin
```

## 5. 项目编译

完成上述依赖安装后，可以编译 `enose-control` 项目：

```bash
cd ~/rpi_odor/enose-control

# 清理并创建 build 目录
rm -rf build
mkdir build && cd build

# 配置 (指定 CMAKE_PREFIX_PATH 以找到 /usr/local 下的库)
cmake .. \
    -DCMAKE_BUILD_TYPE=Debug \
    -DCMAKE_PREFIX_PATH=/usr/local

# 编译
make -j4

# 可执行文件位于
ls -la bin/enose-control
```

## 6. Proto 代码生成

如果需要重新生成 Protobuf C++ 代码：

```bash
cd ~/rpi_odor

# 使用本地脚本生成 (会自动移除 buf.validate 注解)
bash scripts/gen_proto_local.sh
```

> **注意**: `buf.validate` 是 Buf 生态特有的验证注解，标准 `protoc` 不支持。
> 脚本会自动剥离这些注解后再生成 C++ 代码。

## 常见问题

### Q: 编译 gRPC 时内存不足

如果树莓派内存不足 4GB，可以：
1. 减少并行编译数：`make -j2` 或 `make -j1`
2. 添加 swap 空间：
   ```bash
   sudo fallocate -l 2G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   ```

### Q: CMake 找不到已安装的库

确保运行了 `sudo ldconfig`，并在 CMake 配置时添加：
```bash
-DCMAKE_PREFIX_PATH=/usr/local
```

### Q: `grpc_server` 命名空间冲突

gRPC 内部有一个 `typedef struct grpc_server grpc_server`，如果你的代码使用了 `namespace grpc_server`，会产生冲突。建议改用其他命名空间如 `enose_grpc`。

## 版本信息

| 组件 | 版本 | 安装方式 |
|------|------|----------|
| Ubuntu | 24.04 LTS | 镜像 |
| GCC | 13.x | apt |
| CMake | 3.28+ | apt |
| Boost | 1.83+ | apt |
| Abseil | 20240722.0 | 源码编译 |
| Protobuf | 29.3 | 源码编译 |
| gRPC | 1.60.0 | 源码编译 |
| spdlog | 1.12+ | apt |
| nlohmann-json | 3.11+ | apt |

## 一键安装脚本 (可选)

将以下内容保存为 `setup_build_env.sh`：

```bash
#!/bin/bash
set -e

echo "=== 安装基础依赖 ==="
sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential cmake git pkg-config \
    libboost-all-dev nlohmann-json3-dev libspdlog-dev \
    libc-ares-dev libre2-dev zlib1g-dev libssl-dev

echo "=== 编译 Abseil ==="
cd /tmp
curl -L https://github.com/abseil/abseil-cpp/archive/refs/tags/20240722.0.tar.gz -o abseil.tar.gz
tar -xzf abseil.tar.gz && cd abseil-cpp-20240722.0
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_STANDARD=17 \
    -DABSL_BUILD_TESTING=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON
make -j4 && sudo make install && sudo ldconfig

echo "=== 编译 Protobuf ==="
cd /tmp
curl -L https://github.com/protocolbuffers/protobuf/archive/refs/tags/v29.3.tar.gz -o protobuf.tar.gz
tar -xzf protobuf.tar.gz && cd protobuf-29.3
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_STANDARD=17 \
    -Dprotobuf_BUILD_TESTS=OFF -Dprotobuf_ABSL_PROVIDER=package
make -j4 && sudo make install && sudo ldconfig

echo "=== 编译 gRPC ==="
cd /tmp
git clone --depth 1 --branch v1.60.0 https://github.com/grpc/grpc.git grpc-1.60.0
cd grpc-1.60.0 && mkdir -p cmake/build && cd cmake/build
cmake ../.. -DCMAKE_BUILD_TYPE=Release -DgRPC_INSTALL=ON -DgRPC_BUILD_TESTS=OFF \
    -DgRPC_ABSL_PROVIDER=package -DgRPC_CARES_PROVIDER=package \
    -DgRPC_PROTOBUF_PROVIDER=package -DgRPC_RE2_PROVIDER=package \
    -DgRPC_SSL_PROVIDER=package -DgRPC_ZLIB_PROVIDER=package
make -j4 && sudo make install && sudo ldconfig

echo "=== 安装完成 ==="
protoc --version
which grpc_cpp_plugin
```

运行：
```bash
chmod +x setup_build_env.sh
./setup_build_env.sh
```

> **预计总编译时间**: 约 1-2 小时 (树莓派 5)
