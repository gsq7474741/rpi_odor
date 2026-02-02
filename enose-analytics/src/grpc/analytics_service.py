"""AnalyticsService gRPC 服务实现"""

import logging
from datetime import datetime
from typing import Iterator

import grpc
from google.protobuf import timestamp_pb2

from ..analytics.visualization import VisualizationEngine, VisualizationType
from ..db.quality_repository import QualityRepository
from ..db.sensor_reader import SensorReader
from ..generated import enose_analytics_pb2 as pb
from ..generated import enose_analytics_pb2_grpc as pb_grpc

logger = logging.getLogger(__name__)


class AnalyticsServiceImpl(pb_grpc.AnalyticsServiceServicer):
    """AnalyticsService gRPC 实现"""

    def __init__(self):
        self._sensor_reader = SensorReader()
        self._quality_repo = QualityRepository()
        self._vis_engine = VisualizationEngine()

    def GetVisualization(
        self,
        request: pb.VisualizationRequest,
        context: grpc.ServicerContext,
    ) -> pb.VisualizationResponse:
        """获取可视化数据"""
        logger.info(f"GetVisualization: type={request.type}, max_points={request.max_points}")

        try:
            # 从数据库获取传感器数据
            start_time = None
            end_time = None
            if request.HasField("start_time"):
                start_time = request.start_time.ToDatetime()
            if request.HasField("end_time"):
                end_time = request.end_time.ToDatetime()

            experiment_id = request.experiment_id if request.experiment_id else None
            max_points = request.max_points if request.max_points > 0 else 500

            # 获取传感器帧
            df = self._sensor_reader.get_frames(
                start_time=start_time,
                end_time=end_time,
                experiment_id=experiment_id,
                limit=max_points * 2,  # 获取更多数据用于过滤
            )

            if df.empty:
                logger.warning("No sensor data found")
                return pb.VisualizationResponse(
                    type=request.type,
                    total_samples=0,
                )

            # 清空并重新填充可视化引擎
            self._vis_engine.clear()
            
            for idx, row in df.iterrows():
                mox = row.get("mox_readings", [])
                if isinstance(mox, list) and len(mox) > 0:
                    sample_id = f"{row.get('experiment_id', 'unknown')}_{row.get('seq', idx)}"
                    ts = row.get("ts")
                    if isinstance(ts, str):
                        ts = datetime.fromisoformat(ts)
                    self._vis_engine.add_sample(
                        sample_id=sample_id,
                        features=mox,
                        label=row.get("phase_name"),
                        ts=ts,
                    )

            # 映射可视化类型
            vis_type_map = {
                pb.VIS_PCA: VisualizationType.PCA,
                pb.VIS_TSNE: VisualizationType.TSNE,
                pb.VIS_CLUSTERING: VisualizationType.CLUSTERING,
                pb.VIS_PCA_CLUSTERING: VisualizationType.PCA_CLUSTERING,
            }
            vis_type = vis_type_map.get(request.type, VisualizationType.PCA)

            # 计算可视化
            n_components = request.n_components if request.n_components > 0 else 2
            perplexity = request.perplexity if request.perplexity > 0 else 30
            n_clusters = request.n_clusters if request.n_clusters > 0 else 5

            result = self._vis_engine.compute(
                vis_type=vis_type,
                n_components=n_components,
                perplexity=perplexity,
                n_clusters=n_clusters,
                max_points=max_points,
            )

            # 构建响应
            response = pb.VisualizationResponse(
                type=request.type,
                total_samples=result.total_samples,
                n_clusters=result.n_clusters,
            )

            # 设置时间戳
            ts = timestamp_pb2.Timestamp()
            ts.GetCurrentTime()
            response.ts.CopyFrom(ts)

            # 添加点
            for pt in result.points:
                vis_point = pb.VisPoint(
                    id=pt.id,
                    coords=pt.coords,
                    cluster=pt.cluster,
                    label=pt.label or "",
                )
                if pt.ts:
                    pt_ts = timestamp_pb2.Timestamp()
                    pt_ts.FromDatetime(pt.ts)
                    vis_point.ts.CopyFrom(pt_ts)
                response.points.append(vis_point)

            # 添加聚类中心
            for center in result.centers:
                response.centers.append(
                    pb.VisPoint(
                        id=center.id,
                        coords=center.coords,
                        cluster=center.cluster,
                    )
                )

            # 添加解释方差比
            response.explained_variance_ratio.extend(result.explained_variance_ratio)

            logger.info(f"Visualization computed: {result.total_samples} samples, {len(result.points)} points")
            return response

        except Exception as e:
            logger.exception(f"GetVisualization failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.VisualizationResponse()

    def StreamVisualization(
        self,
        request: pb.VisualizationRequest,
        context: grpc.ServicerContext,
    ) -> Iterator[pb.VisualizationResponse]:
        """流式可视化更新"""
        # TODO: 实现实时流式可视化
        yield self.GetVisualization(request, context)

    def AnalyzeSensorData(
        self,
        request_iterator: Iterator,
        context: grpc.ServicerContext,
    ) -> Iterator[pb.AnalysisResponse]:
        """实时质检分析 (双向流)"""
        # TODO: 实现实时质检
        for _ in request_iterator:
            pass
        return iter([])

    def GetQualityConfig(
        self,
        request,
        context: grpc.ServicerContext,
    ) -> pb.QualityConfig:
        """获取质检配置"""
        config = self._quality_repo.get_config()
        return pb.QualityConfig(
            baseline_cv_threshold=config.get("baseline_cv_threshold", 0.05),
            baseline_slope_threshold=config.get("baseline_slope_threshold", 0.01),
            baseline_window_size=config.get("baseline_window_size", 60),
            min_resistance=config.get("min_resistance", 100),
            max_resistance=config.get("max_resistance", 1000000),
            noise_std_threshold=config.get("noise_std_threshold", 0.1),
            noise_window_size=config.get("noise_window_size", 10),
            min_humidity=config.get("min_humidity", 20),
            max_humidity=config.get("max_humidity", 80),
            min_temperature=config.get("min_temperature", 15),
            max_temperature=config.get("max_temperature", 40),
            drift_threshold=config.get("drift_threshold", 0.1),
            drift_window_size=config.get("drift_window_size", 300),
            enable_notifications=config.get("enable_notifications", False),
        )

    def UpdateQualityConfig(
        self,
        request: pb.QualityConfig,
        context: grpc.ServicerContext,
    ) -> pb.QualityConfig:
        """更新质检配置"""
        config = {
            "baseline_cv_threshold": request.baseline_cv_threshold,
            "baseline_slope_threshold": request.baseline_slope_threshold,
            "baseline_window_size": request.baseline_window_size,
            "min_resistance": request.min_resistance,
            "max_resistance": request.max_resistance,
            "noise_std_threshold": request.noise_std_threshold,
            "noise_window_size": request.noise_window_size,
            "min_humidity": request.min_humidity,
            "max_humidity": request.max_humidity,
            "min_temperature": request.min_temperature,
            "max_temperature": request.max_temperature,
            "drift_threshold": request.drift_threshold,
            "drift_window_size": request.drift_window_size,
            "enable_notifications": request.enable_notifications,
        }
        self._quality_repo.update_config(config)
        return request


def add_to_server(server: grpc.Server) -> None:
    """注册服务到 gRPC server"""
    pb_grpc.add_AnalyticsServiceServicer_to_server(AnalyticsServiceImpl(), server)
    logger.info("AnalyticsService registered")
