"""AnalyticsService gRPC 服务实现"""

from datetime import datetime
from typing import Iterator

import grpc
from google.protobuf import timestamp_pb2

from ..analytics.visualization import VisualizationEngine, VisualizationType
from ..logger import logger
from ..cache.visualization_cache import VisualizationCache
from ..db.frame_normalizer import FrameNormalizer
from ..db.quality_repository import QualityRepository
from ..db.sample_reader import SampleReader
from ..db.sensor_reader import SensorReader
from ..generated import enose_analytics_pb2 as pb
from ..generated import enose_analytics_pb2_grpc as pb_grpc


# 全局可视化缓存实例（懒加载）
_vis_cache: VisualizationCache | None = None


def get_vis_cache() -> VisualizationCache | None:
    """获取或创建可视化缓存实例"""
    global _vis_cache
    if _vis_cache is None:
        try:
            _vis_cache = VisualizationCache()
            if not _vis_cache.health_check():
                logger.warning("VisualizationCache 健康检查失败，禁用缓存")
                _vis_cache = None
        except Exception as e:
            logger.warning(f"VisualizationCache 连接失败，禁用缓存: {e}")
            _vis_cache = None
    return _vis_cache


class AnalyticsServiceImpl(pb_grpc.AnalyticsServiceServicer):
    """AnalyticsService gRPC 实现"""

    def __init__(self):
        self._sensor_reader = SensorReader()
        self._sample_reader = SampleReader()
        self._quality_repo = QualityRepository()
        self._vis_engine = VisualizationEngine()
        self._frame_normalizer = FrameNormalizer()

    def _build_response_from_cache(
        self, cached: dict, vis_type: int
    ) -> pb.VisualizationResponse:
        """从缓存数据构建 gRPC 响应"""
        response = pb.VisualizationResponse(
            type=vis_type,
            total_samples=cached.get("total_samples", 0),
            n_clusters=cached.get("n_clusters", 0),
        )

        ts = timestamp_pb2.Timestamp()
        ts.GetCurrentTime()
        response.ts.CopyFrom(ts)

        for pt_data in cached.get("points", []):
            vis_point = pb.VisPoint(
                id=pt_data.get("id", ""),
                coords=pt_data.get("coords", []),
                cluster=pt_data.get("cluster", -1),
                label=pt_data.get("label", ""),
            )
            response.points.append(vis_point)

        for center_data in cached.get("centers", []):
            response.centers.append(
                pb.VisPoint(
                    id=center_data.get("id", ""),
                    coords=center_data.get("coords", []),
                    cluster=center_data.get("cluster", -1),
                )
            )

        response.explained_variance_ratio.extend(
            cached.get("explained_variance_ratio", [])
        )

        return response

    def GetVisualization(
        self,
        request: pb.VisualizationRequest,
        context: grpc.ServicerContext,
    ) -> pb.VisualizationResponse:
        """获取可视化数据 - 每个 sample 一个点"""
        logger.info(f"GetVisualization: type={request.type}, max_points={request.max_points}")

        try:
            experiment_id = request.experiment_id if request.experiment_id else None
            max_points = request.max_points if request.max_points > 0 else 500
            n_components = request.n_components if request.n_components > 0 else 2
            perplexity = request.perplexity if request.perplexity > 0 else 30
            n_clusters = request.n_clusters if request.n_clusters > 0 else 5
            
            # 解析 sample_ids（逗号分隔）
            sample_ids: list[int] = []
            if request.sample_ids:
                try:
                    sample_ids = [int(sid.strip()) for sid in request.sample_ids.split(",") if sid.strip()]
                except ValueError:
                    pass

            # 映射可视化类型
            vis_type_map = {
                pb.VIS_PCA: "PCA",
                pb.VIS_TSNE: "TSNE",
                pb.VIS_CLUSTERING: "CLUSTERING",
                pb.VIS_PCA_CLUSTERING: "PCA_CLUSTERING",
            }
            vis_type_str = vis_type_map.get(request.type, "PCA")

            # 尝试从缓存获取
            vis_cache = get_vis_cache()
            if vis_cache and sample_ids:
                cached = vis_cache.get(
                    sample_ids=sample_ids,
                    vis_type=vis_type_str,
                    n_components=n_components,
                    n_clusters=n_clusters,
                    perplexity=perplexity,
                )
                if cached:
                    logger.info(f"VisualizationCache HIT: {len(sample_ids)} samples")
                    return self._build_response_from_cache(cached, request.type)

            # 清空可视化引擎
            self._vis_engine.clear()
            
            # 优先使用 sample_ids 进行样本级降维（每个 sample 一个点）
            if sample_ids:
                logger.info(f"Using sample-based visualization with {len(sample_ids)} samples")
                n_samples_per_frame = 100  # 每个样本的帧数
                
                for sid in sample_ids[:max_points]:  # 限制最大样本数
                    frames, _ = self._frame_normalizer.get_normalized_frames_by_sample(
                        sample_id=sid,
                        method="linear",
                        n_samples=n_samples_per_frame,
                        use_cache=True,
                    )
                    
                    if frames is not None and frames.size > 0:
                        # 展平为高维向量: (n_samples, 8) -> (n_samples * 8,)
                        features = frames.flatten().tolist()
                        
                        # 获取样本信息用于标签
                        sample_info = self._sample_reader.get_sample(sid)
                        label = sample_info.get("phaseName", "") if sample_info else ""
                        liquid_names = sample_info.get("liquidNames", []) if sample_info else []
                        if liquid_names:
                            label = f"{label}:{','.join(liquid_names[:2])}"
                        
                        self._vis_engine.add_sample(
                            sample_id=f"sample_{sid}",
                            features=features,
                            label=label,
                            ts=None,
                        )
                
                logger.info(f"Loaded {len(sample_ids)} samples for visualization")
            
            elif experiment_id:
                # 回退：按 run_id 获取所有样本
                try:
                    run_id = int(experiment_id)
                    samples = self._sample_reader.list_samples(run_id=run_id, limit=max_points)
                    logger.info(f"Found {len(samples)} samples for run_id={run_id}")
                    
                    for sample in samples:
                        sid = sample.get("id")
                        if not sid:
                            continue
                        
                        frames, _ = self._frame_normalizer.get_normalized_frames_by_sample(
                            sample_id=sid,
                            method="linear",
                            n_samples=100,
                            use_cache=True,
                        )
                        
                        if frames is not None and frames.size > 0:
                            features = frames.flatten().tolist()
                            label = sample.get("phaseName", "")
                            liquid_names = sample.get("liquidNames", [])
                            if liquid_names:
                                label = f"{label}:{','.join(liquid_names[:2])}"
                            
                            self._vis_engine.add_sample(
                                sample_id=f"sample_{sid}",
                                features=features,
                                label=label,
                                ts=None,
                            )
                except (ValueError, Exception) as e:
                    logger.warning(f"Failed to get samples for run_id: {e}")
            
            if self._vis_engine.sample_count == 0:
                logger.warning("No samples loaded for visualization")
                return pb.VisualizationResponse(
                    type=request.type,
                    total_samples=0,
                )

            # 映射可视化类型到枚举
            vis_type_enum_map = {
                pb.VIS_PCA: VisualizationType.PCA,
                pb.VIS_TSNE: VisualizationType.TSNE,
                pb.VIS_CLUSTERING: VisualizationType.CLUSTERING,
                pb.VIS_PCA_CLUSTERING: VisualizationType.PCA_CLUSTERING,
            }
            vis_type = vis_type_enum_map.get(request.type, VisualizationType.PCA)

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

            # 写入缓存
            if vis_cache and sample_ids:
                cache_data = {
                    "total_samples": result.total_samples,
                    "n_clusters": result.n_clusters,
                    "explained_variance_ratio": result.explained_variance_ratio,
                    "points": [p.to_dict() for p in result.points],
                    "centers": [c.to_dict() for c in result.centers],
                }
                vis_cache.set(
                    sample_ids=sample_ids,
                    vis_type=vis_type_str,
                    n_components=n_components,
                    n_clusters=n_clusters,
                    perplexity=perplexity,
                    result=cache_data,
                )
                logger.debug(f"VisualizationCache SET: {len(sample_ids)} samples")

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

    def GetNormalizedFramesStatus(
        self,
        request: pb.NormalizedFramesStatusRequest,
        context: grpc.ServicerContext,
    ) -> pb.NormalizedFramesStatusResponse:
        """检查归一化帧状态"""
        logger.info(f"GetNormalizedFramesStatus: run_id={request.run_id}")

        try:
            status = self._frame_normalizer.get_normalized_frames_status(
                run_id=request.run_id,
                phase_name=request.phase_name if request.phase_name else None,
            )

            response = pb.NormalizedFramesStatusResponse(
                exists=status["exists"],
                total_frames=status["total_frames"],
            )

            for m in status["meta"]:
                meta = pb.NormalizedFramesMeta(
                    method=m["method"],
                    n_samples=m["n_samples"],
                    original_point_counts=m["original_point_counts"],
                    time_range_ms=m["time_range_ms"],
                    phase_name=m["phase_name"],
                )
                response.meta.append(meta)

            return response

        except Exception as e:
            logger.exception(f"GetNormalizedFramesStatus failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.NormalizedFramesStatusResponse()

    def GenerateNormalizedFrames(
        self,
        request: pb.GenerateNormalizedFramesRequest,
        context: grpc.ServicerContext,
    ) -> pb.GenerateNormalizedFramesResponse:
        """生成归一化帧"""
        logger.info(f"GenerateNormalizedFrames: run_id={request.run_id}")

        try:
            n_samples = request.n_samples if request.n_samples > 0 else 100
            methods = list(request.methods) if request.methods else ["linear", "pchip"]
            phase_names = list(request.phase_names) if request.phase_names else None

            results = self._frame_normalizer.generate_all_phases(
                run_id=request.run_id,
                phase_names=phase_names,
                n_samples=n_samples,
                methods=methods,
            )

            total = sum(results.values())
            return pb.GenerateNormalizedFramesResponse(
                success=True,
                message=f"Generated {total} frames",
                frames_generated=results,
            )

        except Exception as e:
            logger.exception(f"GenerateNormalizedFrames failed: {e}")
            return pb.GenerateNormalizedFramesResponse(
                success=False,
                message=str(e),
            )

    # ============================================================
    # Sample-based Normalized Frames API (新 sample_id 接口)
    # ============================================================

    def GetSampleFramesStatus(
        self,
        request: pb.SampleFramesStatusRequest,
        context: grpc.ServicerContext,
    ) -> pb.SampleFramesStatusResponse:
        """检查指定 sample 的归一化帧状态"""
        logger.info(f"GetSampleFramesStatus: sample_id={request.sample_id}")

        try:
            status = self._frame_normalizer.get_normalized_frames_status_by_sample(
                sample_id=request.sample_id,
            )

            response = pb.SampleFramesStatusResponse(
                exists=status["exists"],
                cached=status.get("cached", False),
            )

            for v in status.get("variants", []):
                meta = pb.SampleFramesMeta(
                    method=v["method"],
                    n_samples=v["n_samples"],
                    original_point_counts=v.get("original_point_counts", []),
                    time_range_ms=v.get("time_range_ms", 0),
                )
                response.variants.append(meta)

            return response

        except Exception as e:
            logger.exception(f"GetSampleFramesStatus failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.SampleFramesStatusResponse()

    def GetBatchSampleFramesStatus(
        self,
        request: pb.BatchSampleFramesStatusRequest,
        context: grpc.ServicerContext,
    ) -> pb.BatchSampleFramesStatusResponse:
        """批量检查样本帧状态（减少网络往返）"""
        sample_ids = list(request.sample_ids)
        logger.info(f"GetBatchSampleFramesStatus: {len(sample_ids)} samples")

        response = pb.BatchSampleFramesStatusResponse()

        for sample_id in sample_ids:
            try:
                status = self._frame_normalizer.get_normalized_frames_status_by_sample(
                    sample_id=sample_id,
                )

                sample_response = pb.SampleFramesStatusResponse(
                    exists=status["exists"],
                    cached=status.get("cached", False),
                )

                for v in status.get("variants", []):
                    meta = pb.SampleFramesMeta(
                        method=v["method"],
                        n_samples=v["n_samples"],
                        original_point_counts=v.get("original_point_counts", []),
                        time_range_ms=v.get("time_range_ms", 0),
                    )
                    sample_response.variants.append(meta)

                response.statuses[sample_id].CopyFrom(sample_response)

            except Exception as e:
                logger.warning(f"GetBatchSampleFramesStatus: sample_id={sample_id} failed: {e}")
                response.statuses[sample_id].CopyFrom(pb.SampleFramesStatusResponse(exists=False, cached=False))

        return response

    def GenerateSampleFrames(
        self,
        request: pb.GenerateSampleFramesRequest,
        context: grpc.ServicerContext,
    ) -> pb.GenerateSampleFramesResponse:
        """生成指定 sample 的归一化帧"""
        logger.info(f"GenerateSampleFrames: sample_id={request.sample_id}")

        try:
            n_samples = request.n_samples if request.n_samples > 0 else 100
            methods = list(request.methods) if request.methods else ["linear", "pchip"]
            use_cache = request.use_cache if request.HasField("use_cache") else True

            frames_generated = {}
            from_cache = False

            for method in methods:
                frames, cached = self._frame_normalizer.get_normalized_frames_by_sample(
                    sample_id=request.sample_id,
                    method=method,
                    n_samples=n_samples,
                    use_cache=use_cache,
                )
                if frames is not None:
                    frames_generated[method] = len(frames)
                    from_cache = from_cache or cached

            total_generated = sum(frames_generated.values())
            return pb.GenerateSampleFramesResponse(
                success=True,
                message=f"Generated {total_generated} frames",
                frames_generated=frames_generated,
                from_cache=from_cache,
            )

        except Exception as e:
            logger.exception(f"GenerateSampleFrames failed: {e}")
            return pb.GenerateSampleFramesResponse(
                success=False,
                message=str(e),
            )

    def GenerateBatchSampleFrames(
        self,
        request: pb.BatchGenerateSampleFramesRequest,
        context: grpc.ServicerContext,
    ) -> pb.BatchGenerateSampleFramesResponse:
        """批量生成样本帧（减少网络往返）"""
        sample_ids = list(request.sample_ids)
        n_samples = request.n_samples if request.n_samples > 0 else 100
        methods = list(request.methods) if request.methods else ["linear", "pchip"]
        use_cache = request.use_cache if request.HasField("use_cache") else True

        logger.info(
            f"GenerateBatchSampleFrames: {len(sample_ids)} samples, "
            f"n_samples={n_samples}, methods={methods}, use_cache={use_cache}"
        )

        success_count = 0
        failed_count = 0
        from_cache_count = 0
        errors: dict[int, str] = {}

        for sample_id in sample_ids:
            try:
                sample_from_cache = False
                sample_success = True

                for method in methods:
                    frames, cached = self._frame_normalizer.get_normalized_frames_by_sample(
                        sample_id=sample_id,
                        method=method,
                        n_samples=n_samples,
                        use_cache=use_cache,
                    )
                    if frames is None:
                        sample_success = False
                        break
                    sample_from_cache = sample_from_cache or cached

                if sample_success:
                    success_count += 1
                    if sample_from_cache:
                        from_cache_count += 1
                else:
                    failed_count += 1
                    errors[sample_id] = "Failed to generate frames"

            except Exception as e:
                failed_count += 1
                errors[sample_id] = str(e)
                logger.warning(f"GenerateBatchSampleFrames: sample_id={sample_id} failed: {e}")

        logger.info(
            f"GenerateBatchSampleFrames completed: "
            f"success={success_count}, failed={failed_count}, from_cache={from_cache_count}"
        )

        return pb.BatchGenerateSampleFramesResponse(
            total_samples=len(sample_ids),
            success_count=success_count,
            failed_count=failed_count,
            from_cache_count=from_cache_count,
            errors=errors,
        )

    def GetSampleFrames(
        self,
        request: pb.GetSampleFramesRequest,
        context: grpc.ServicerContext,
    ) -> pb.GetSampleFramesResponse:
        """获取指定 sample 的归一化帧数据"""
        logger.info(f"GetSampleFrames: sample_id={request.sample_id}, method={request.method}")

        try:
            n_samples = request.n_samples if request.n_samples > 0 else 100
            method = request.method if request.method else "linear"
            use_cache = request.use_cache if request.HasField("use_cache") else True

            frames, from_cache = self._frame_normalizer.get_normalized_frames_by_sample(
                sample_id=request.sample_id,
                method=method,
                n_samples=n_samples,
                use_cache=use_cache,
            )

            if frames is None:
                return pb.GetSampleFramesResponse(
                    success=False,
                    frames=[],
                    n_samples=0,
                    n_sensors=0,
                    from_cache=False,
                )

            # frames 是 numpy array, shape = (n_samples, n_sensors)
            # 展平为一维数组传输
            flat_frames = frames.flatten().tolist()
            n_sensors = frames.shape[1] if len(frames.shape) > 1 else 8

            return pb.GetSampleFramesResponse(
                success=True,
                frames=flat_frames,
                n_samples=n_samples,
                n_sensors=n_sensors,
                from_cache=from_cache,
            )

        except Exception as e:
            logger.exception(f"GetSampleFrames failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.GetSampleFramesResponse(success=False)


def add_to_server(server: grpc.Server) -> None:
    """注册服务到 gRPC server"""
    pb_grpc.add_AnalyticsServiceServicer_to_server(AnalyticsServiceImpl(), server)
    logger.info("AnalyticsService registered")
