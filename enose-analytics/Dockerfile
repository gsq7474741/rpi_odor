# enose-analytics Dockerfile
# Python 质检与分析服务 (使用 uv 管理)

FROM python:3.11-slim

# 设置工作目录
WORKDIR /app

# 安装 uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY pyproject.toml uv.lock* ./

# 安装 Python 依赖
RUN uv sync --frozen --no-dev

# 复制源码
COPY src/ ./src/
COPY config/ ./config/

# 设置环境变量
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# 暴露端口
EXPOSE 50052

# 启动命令
CMD ["uv", "run", "enose-analytics"]
