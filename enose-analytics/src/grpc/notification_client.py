"""通知客户端 - 用于向 enose-control 推送告警"""

from datetime import datetime
from typing import Any
from uuid import uuid4

import grpc

from ..config import get_settings
from ..logger import logger
from ..analytics.quality_checker import QualityAlert, Severity



class NotificationClient:
    """通知客户端 - 连接到 enose-control 的 NotificationService"""

    def __init__(
        self,
        host: str | None = None,
        port: int | None = None,
    ):
        settings = get_settings()
        self.host = host or settings.control_service.host
        self.port = port or settings.control_service.port
        self._channel: grpc.Channel | None = None
        self._stub: Any = None

    def connect(self) -> None:
        """建立 gRPC 连接"""
        if self._channel is not None:
            return

        address = f"{self.host}:{self.port}"
        self._channel = grpc.insecure_channel(address)

        # TODO: 需要生成 protobuf 代码后才能使用
        # from ..generated import enose_service_pb2_grpc
        # self._stub = enose_service_pb2_grpc.NotificationServiceStub(self._channel)

        logger.info(f"Notification client connected to {address}")

    def disconnect(self) -> None:
        """关闭连接"""
        if self._channel is not None:
            self._channel.close()
            self._channel = None
            self._stub = None
            logger.info("Notification client disconnected")

    def push_alert(
        self,
        alert: QualityAlert,
        source: str = "quality_checker",
    ) -> bool:
        """推送单个告警

        Args:
            alert: 质量告警对象
            source: 告警来源

        Returns:
            是否推送成功
        """
        if self._stub is None:
            logger.warning("Notification client not connected, skipping push")
            return False

        try:
            # TODO: 生成 protobuf 代码后实现
            # from ..generated import enose_service_pb2
            # request = enose_service_pb2.PushAlertRequest(
            #     alert_id=str(uuid4()),
            #     title=f"[{alert.severity.name}] {alert.flag.name}",
            #     message=alert.message,
            #     severity=self._map_severity(alert.severity),
            #     source=source,
            #     quality_flag=alert.flag.name,
            #     channel=alert.channel,
            #     value=alert.value,
            #     threshold=alert.threshold,
            # )
            # response = self._stub.PushAlert(request)
            # return response.success

            logger.debug(f"Would push alert: {alert.flag.name} - {alert.message}")
            return True

        except grpc.RpcError as e:
            logger.error(f"Failed to push alert: {e}")
            return False

    def push_alerts(
        self,
        alerts: list[QualityAlert],
        source: str = "quality_checker",
    ) -> tuple[int, int]:
        """批量推送告警

        Returns:
            (成功数, 失败数)
        """
        if not alerts:
            return (0, 0)

        if self._stub is None:
            logger.warning("Notification client not connected, skipping push")
            return (0, len(alerts))

        succeeded = 0
        failed = 0

        for alert in alerts:
            if self.push_alert(alert, source):
                succeeded += 1
            else:
                failed += 1

        return (succeeded, failed)

    def _map_severity(self, severity: Severity) -> int:
        """映射严重程度到 proto enum"""
        mapping = {
            Severity.UNKNOWN: 0,
            Severity.INFO: 1,
            Severity.WARNING: 2,
            Severity.ERROR: 3,
            Severity.CRITICAL: 4,
        }
        return mapping.get(severity, 0)

    def __enter__(self) -> "NotificationClient":
        self.connect()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.disconnect()
