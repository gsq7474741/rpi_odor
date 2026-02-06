"""enose-analytics 服务主入口

配置全部来自 config/analytics.yaml 文件。
本地开发时直接修改 YAML 文件中的 IP 地址。
"""

import signal
import sys
from concurrent import futures
from pathlib import Path

import grpc

from .config import get_settings, reload_settings
from .logger import logger, setup_logger


def serve() -> None:
    """启动 gRPC 服务"""
    setup_logger()
    settings = get_settings()

    logger.info("Starting enose-analytics service...")
    logger.info(f"gRPC server: {settings.grpc.host}:{settings.grpc.port}")

    # 运行依赖服务健康检查
    from .health import run_health_checks, print_health_status
    results = run_health_checks(required_only=False)
    all_healthy = print_health_status(results)
    
    if not all_healthy:
        logger.warning("Some required services are unavailable, but continuing startup...")

    # 创建 gRPC 服务器
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=settings.grpc.max_workers),
        options=[
            ("grpc.max_send_message_length", 50 * 1024 * 1024),
            ("grpc.max_receive_message_length", 50 * 1024 * 1024),
        ],
    )

    # 注册 gRPC 服务
    from .grpc import add_analytics_service, add_label_service, add_model_service, add_data_service, add_sample_service, add_ml_label_service, add_export_service
    add_analytics_service(server)
    add_label_service(server)
    add_model_service(server)
    add_data_service(server)
    add_sample_service(server)
    add_ml_label_service(server)
    add_export_service(server)

    # 绑定端口
    address = f"{settings.grpc.host}:{settings.grpc.port}"
    server.add_insecure_port(address)

    # 启动服务器
    server.start()
    logger.info(f"gRPC server started on {address}")

    # 信号处理
    def shutdown(signum: int, frame: object) -> None:
        logger.info("Shutting down...")
        server.stop(grace=5)
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # 等待
    server.wait_for_termination()


def main() -> None:
    """主函数"""
    import argparse

    parser = argparse.ArgumentParser(description="E-nose Analytics Service")
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="Path to config file",
    )
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Enable hot reload (development mode)",
    )
    args = parser.parse_args()

    if args.config:
        reload_settings(Path(args.config))

    if args.dev:
        serve_with_reload()
    else:
        serve()


def main_dev() -> None:
    """开发模式入口 (带热重载)"""
    serve_with_reload()


def serve_with_reload() -> None:
    """带热重载的开发服务器"""
    import subprocess
    import time
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler, FileModifiedEvent

    class ReloadHandler(FileSystemEventHandler):
        def __init__(self) -> None:
            self.process: subprocess.Popen | None = None
            self.last_reload = 0.0

        def start_server(self) -> None:
            if self.process:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()

            logger.info("Starting server...")
            self.process = subprocess.Popen(
                [sys.executable, "-m", "src.main"],
                cwd=Path(__file__).parent.parent,
            )

        def on_modified(self, event: FileModifiedEvent) -> None:  # type: ignore
            if not isinstance(event, FileModifiedEvent):
                return
            if not event.src_path.endswith(".py"):
                return
            # 防抖：500ms 内不重复触发
            now = time.time()
            if now - self.last_reload < 0.5:
                return
            self.last_reload = now
            logger.info(f"File changed: {event.src_path}")
            self.start_server()

        def stop(self) -> None:
            if self.process:
                self.process.terminate()
                self.process.wait()

    setup_logger()
    logger.info("Starting development server with hot reload...")

    src_path = Path(__file__).parent
    handler = ReloadHandler()
    observer = Observer()
    observer.schedule(handler, str(src_path), recursive=True)

    handler.start_server()
    observer.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Stopping development server...")
        observer.stop()
        handler.stop()
    observer.join()


if __name__ == "__main__":
    main()
