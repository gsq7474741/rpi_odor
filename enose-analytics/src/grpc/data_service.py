"""DataService gRPC 服务实现"""

from datetime import datetime

import grpc
from google.protobuf.timestamp_pb2 import Timestamp

from ..db.data_repository import DataRepository
from ..logger import logger
from ..generated import enose_analytics_pb2 as pb
from ..generated import enose_analytics_pb2_grpc as pb_grpc



class DataServiceServicer(pb_grpc.DataServiceServicer):
    """DataService gRPC 服务实现"""

    def __init__(self) -> None:
        self.repo = DataRepository()

    def ListExperiments(
        self,
        request: pb.ListExperimentsRequest,
        context: grpc.ServicerContext,
    ) -> pb.ListExperimentsResponse:
        """列出实验"""
        # 轻量模式：仅返回 run ID + sample count（用于筛选下拉框）
        ids_only = request.HasField("label_id") and request.label_id == "__ids_only__"

        if ids_only:
            logger.info("ListExperiments: ids_only mode (light query)")
            runs = self.repo.list_run_ids_light()
            response = pb.ListExperimentsResponse(total=len(runs))
            for run in runs:
                response.experiments.append(
                    pb.ExperimentSummary(
                        experiment_id=run["experiment_id"],
                        sample_count=run["sample_count"],
                        status="completed",
                    )
                )
            return response

        logger.info(f"ListExperiments: limit={request.limit}, offset={request.offset}")

        start_time = None
        end_time = None
        label_id = None

        if request.HasField("start_time"):
            start_time = datetime.fromtimestamp(request.start_time.seconds)
        if request.HasField("end_time"):
            end_time = datetime.fromtimestamp(request.end_time.seconds)
        if request.HasField("label_id"):
            label_id = request.label_id

        experiments, total = self.repo.list_experiments(
            limit=request.limit or 50,
            offset=request.offset or 0,
            start_time=start_time,
            end_time=end_time,
            label_id=label_id,
        )

        response = pb.ListExperimentsResponse(total=total)
        for exp in experiments:
            start_ts = Timestamp()
            start_ts.FromMilliseconds(exp["start_time_ms"])
            end_ts = Timestamp()
            end_ts.FromMilliseconds(exp["end_time_ms"])

            response.experiments.append(
                pb.ExperimentSummary(
                    experiment_id=exp["experiment_id"],
                    start_time=start_ts,
                    end_time=end_ts,
                    frame_count=exp["frame_count"],
                    sample_count=exp["sample_count"],
                    phases=exp["phases"],
                    labels=exp["labels"],
                    status=exp["status"],
                )
            )

        return response

    def QuerySensorData(
        self,
        request: pb.QuerySensorDataRequest,
        context: grpc.ServicerContext,
    ) -> pb.QuerySensorDataResponse:
        """查询传感器数据"""
        logger.info(f"QuerySensorData: limit={request.limit}, offset={request.offset}")

        experiment_id = request.experiment_id if request.HasField("experiment_id") else None
        label_id = request.label_id if request.HasField("label_id") else None
        phase = request.phase if request.HasField("phase") else None
        start_time = None
        end_time = None

        if request.HasField("start_time"):
            start_time = datetime.fromtimestamp(request.start_time.seconds)
        if request.HasField("end_time"):
            end_time = datetime.fromtimestamp(request.end_time.seconds)

        rows, total = self.repo.query_sensor_data(
            experiment_id=experiment_id,
            label_id=label_id,
            phase=phase,
            start_time=start_time,
            end_time=end_time,
            limit=request.limit or 1000,
            offset=request.offset or 0,
            downsample_factor=request.downsample_factor or 1,
        )

        response = pb.QuerySensorDataResponse(
            total=total,
            returned=len(rows),
        )

        # 添加列信息
        columns = [
            pb.ColumnInfo(name="ts", type="timestamp", unit="ms"),
            pb.ColumnInfo(name="experiment_id", type="string", unit=""),
            pb.ColumnInfo(name="phase", type="string", unit=""),
            pb.ColumnInfo(name="temperature", type="number", unit="°C"),
            pb.ColumnInfo(name="humidity", type="number", unit="%"),
            pb.ColumnInfo(name="heater_step", type="number", unit=""),
            pb.ColumnInfo(name="label", type="string", unit=""),
        ]
        for i in range(8):
            columns.append(pb.ColumnInfo(name=f"sensor_{i}", type="number", unit="Ω"))
        response.columns.extend(columns)

        # 添加数据行
        for row in rows:
            ts = Timestamp()
            ts.FromMilliseconds(row["ts_ms"])

            response.rows.append(
                pb.SensorDataRow(
                    ts=ts,
                    seq=row["ts_ms"],
                    experiment_id=row["experiment_id"] or "",
                    phase=row["phase"] or "",
                    mox_readings=row["mox_readings"],
                    temperature=row["temperature"] or 0,
                    humidity=row["humidity"] or 0,
                    heater_step=row["heater_step"] or 0,
                    label=row["label"] or "",
                )
            )

        return response

    def GetAggregatedStats(
        self,
        request: pb.AggregatedStatsRequest,
        context: grpc.ServicerContext,
    ) -> pb.AggregatedStatsResponse:
        """获取聚合统计"""
        dimension_map = {
            pb.AGG_BY_EXPERIMENT: "experiment",
            pb.AGG_BY_LABEL: "label",
            pb.AGG_BY_PHASE: "phase",
            pb.AGG_BY_TIME: "time",
            pb.AGG_BY_HEATER_STEP: "heater_step",
            pb.AGG_BY_SENSOR: "sensor",
        }

        dimension = dimension_map.get(request.dimension, "experiment")
        logger.info(f"GetAggregatedStats: dimension={dimension}")

        experiment_id = request.experiment_id if request.HasField("experiment_id") else None
        label_id = request.label_id if request.HasField("label_id") else None
        start_time = None
        end_time = None

        if request.HasField("start_time"):
            start_time = datetime.fromtimestamp(request.start_time.seconds)
        if request.HasField("end_time"):
            end_time = datetime.fromtimestamp(request.end_time.seconds)

        groups = self.repo.get_aggregated_stats(
            dimension=dimension,
            experiment_id=experiment_id,
            label_id=label_id,
            start_time=start_time,
            end_time=end_time,
            time_bucket=request.time_bucket or "1h",
            sensor_indices=list(request.sensor_indices) if request.sensor_indices else None,
        )

        response = pb.AggregatedStatsResponse(dimension=request.dimension)

        for group in groups:
            start_ts = Timestamp()
            end_ts = Timestamp()
            if group["start_time_ms"]:
                start_ts.FromMilliseconds(group["start_time_ms"])
            if group["end_time_ms"]:
                end_ts.FromMilliseconds(group["end_time_ms"])

            agg_group = pb.AggregatedGroup(
                key=group["key"],
                label=group["label"],
                sample_count=group["sample_count"],
                avg_temperature=group["avg_temperature"],
                avg_humidity=group["avg_humidity"],
                start_time=start_ts,
                end_time=end_ts,
            )

            for stats in group["sensor_stats"]:
                agg_group.sensor_stats.append(
                    pb.SensorStats(
                        sensor_idx=stats["sensor_idx"],
                        min=stats["min"],
                        max=stats["max"],
                        mean=stats["mean"],
                        std=stats["std"],
                        median=stats["median"],
                    )
                )

            response.groups.append(agg_group)

        return response

    def GetExperimentDetail(
        self,
        request: pb.GetExperimentDetailRequest,
        context: grpc.ServicerContext,
    ) -> pb.ExperimentDetail:
        """获取实验详情"""
        logger.info(f"GetExperimentDetail: {request.experiment_id}")

        detail = self.repo.get_experiment_detail(request.experiment_id)

        if not detail:
            context.abort(grpc.StatusCode.NOT_FOUND, "Experiment not found")

        start_ts = Timestamp()
        end_ts = Timestamp()
        start_ts.FromMilliseconds(detail["start_time_ms"])
        end_ts.FromMilliseconds(detail["end_time_ms"])

        response = pb.ExperimentDetail(
            experiment_id=detail["experiment_id"],
            start_time=start_ts,
            end_time=end_ts,
            frame_count=detail["frame_count"],
            status=detail["status"],
            avg_temperature=detail["avg_temperature"],
            avg_humidity=detail["avg_humidity"],
            total_alerts=detail["total_alerts"],
            critical_alerts=detail["critical_alerts"],
            warning_alerts=detail["warning_alerts"],
        )

        # 阶段信息
        for phase in detail["phases"]:
            phase_start = Timestamp()
            phase_end = Timestamp()
            phase_start.FromMilliseconds(phase["start_time_ms"])
            phase_end.FromMilliseconds(phase["end_time_ms"])

            response.phases.append(
                pb.PhaseInfo(
                    name=phase["name"],
                    start_time=phase_start,
                    end_time=phase_end,
                    frame_count=phase["frame_count"],
                )
            )

        # 传感器统计
        for stats in detail["sensor_summary"]:
            response.sensor_summary.append(
                pb.SensorStats(
                    sensor_idx=stats["sensor_idx"],
                    min=stats["min"],
                    max=stats["max"],
                    mean=stats["mean"],
                    std=stats["std"],
                    median=stats["median"],
                )
            )

        return response


def add_to_server(server: grpc.Server) -> None:
    """注册服务到 gRPC 服务器"""
    pb_grpc.add_DataServiceServicer_to_server(DataServiceServicer(), server)
    logger.info("DataService registered")
