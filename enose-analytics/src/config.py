"""配置管理模块

配置全部来自 config/analytics.yaml 文件，不使用环境变量覆盖。
本地开发时直接修改 YAML 文件中的 IP 地址。
"""

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel
from pydantic_settings import BaseSettings


class GrpcConfig(BaseModel):
    """gRPC 服务配置"""

    host: str = "0.0.0.0"
    port: int = 50052
    max_workers: int = 4


class ControlServiceConfig(BaseModel):
    """enose-control 服务配置"""

    host: str = "enose-control"
    port: int = 50051


class DatabaseConfig(BaseModel):
    """数据库配置"""

    host: str = "timescaledb"
    port: int = 5432
    database: str = "enose"
    user: str = "enose"
    password: str = "enose_secure_password_change_me"
    pool_size: int = 5

    @property
    def dsn(self) -> str:
        return f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/{self.database}"


class RedisConfig(BaseModel):
    """Redis 配置"""

    host: str = "redis"
    port: int = 6379
    db: int = 0
    password: str | None = None
    default_ttl: int = 3600 * 24 * 7  # 7 天

    @property
    def url(self) -> str:
        if self.password:
            return f"redis://:{self.password}@{self.host}:{self.port}/{self.db}"
        return f"redis://{self.host}:{self.port}/{self.db}"


class MinioConfig(BaseModel):
    """MinIO 配置"""

    endpoint: str = "minio:9000"
    access_key: str = "minioadmin"
    secret_key: str = "minioadmin123"
    secure: bool = False

    class Buckets(BaseModel):
        models: str = "models"
        datasets: str = "datasets"

    buckets: Buckets = Buckets()


class QualityConfig(BaseModel):
    """质量检测配置 (所有阈值可调)"""

    # 基线稳定性
    baseline_cv_threshold: float = 0.05
    baseline_slope_threshold: float = 0.01
    baseline_window_size: int = 60

    # 传感器范围
    min_resistance: float = 100
    max_resistance: float = 1000000

    # 噪声检测
    noise_std_threshold: float = 0.1
    noise_window_size: int = 10

    # 环境参数
    min_humidity: float = 20
    max_humidity: float = 80
    min_temperature: float = 15
    max_temperature: float = 40

    # 漂移检测
    drift_threshold: float = 0.1
    drift_window_size: int = 300

    # 告警控制
    enable_notifications: bool = True
    disabled_flags: list[str] = []


class SeriesBackfillConfig(BaseModel):
    """对齐序列自动回填配置"""

    enabled: bool = True
    series_len: int = 100
    methods: list[str] = ["pchip"]
    poll_interval_s: int = 300
    batch_size: int = 50


class LabelBackfillConfig(BaseModel):
    """ML 标签自动回填配置

    在样本完成时自动为简单策略生成标签，集成在 SeriesBackfillTask 中。
    contrastive 类型 (params_group) 等复杂策略暂不自动生成。
    """

    enabled: bool = True
    auto_strategies: list[str] = [
        "liquid_identity",
        "primary_liquid",
        "mixture_formula",
        "concentration",
        "total_volume",
        "gas_pump_speed",
        "env_temperature",
    ]


class ModelConfig(BaseModel):
    """MLP 模型默认配置"""

    default_hidden_layers: list[int] = [64, 32]
    default_activation: str = "relu"
    default_dropout: float = 0.2
    default_epochs: int = 100
    default_batch_size: int = 32
    default_learning_rate: float = 0.001
    default_validation_split: float = 0.2


class VisualizationConfig(BaseModel):
    """可视化配置"""

    default_n_components: int = 2
    default_perplexity: int = 30
    default_n_clusters: int = 5
    default_max_points: int = 1000
    update_interval_ms: int = 1000


class LoggingConfig(BaseModel):
    """日志配置"""

    level: str = "INFO"
    format: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"


class Settings(BaseSettings):
    """应用配置"""

    grpc: GrpcConfig = GrpcConfig()
    control_service: ControlServiceConfig = ControlServiceConfig()
    database: DatabaseConfig = DatabaseConfig()
    redis: RedisConfig = RedisConfig()
    minio: MinioConfig = MinioConfig()
    quality: QualityConfig = QualityConfig()
    series_backfill: SeriesBackfillConfig = SeriesBackfillConfig()
    label_backfill: LabelBackfillConfig = LabelBackfillConfig()
    model: ModelConfig = ModelConfig()
    visualization: VisualizationConfig = VisualizationConfig()
    logging: LoggingConfig = LoggingConfig()

    @classmethod
    def from_yaml(cls, path: Path | str) -> "Settings":
        """从 YAML 文件加载配置"""
        path = Path(path)
        if not path.exists():
            return cls()

        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

        return cls(**data)

    def to_dict(self) -> dict[str, Any]:
        """转换为字典"""
        return self.model_dump()


# 全局配置实例
_settings: Settings | None = None


def get_settings() -> Settings:
    """获取配置实例"""
    global _settings
    if _settings is None:
        config_path = Path(__file__).parent.parent / "config" / "analytics.yaml"
        _settings = Settings.from_yaml(config_path)
    return _settings


def reload_settings(path: Path | str | None = None) -> Settings:
    """重新加载配置"""
    global _settings
    if path is None:
        path = Path(__file__).parent.parent / "config" / "analytics.yaml"
    _settings = Settings.from_yaml(path)
    return _settings
