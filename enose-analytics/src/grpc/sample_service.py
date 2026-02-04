"""Sample Service - 样本分割与聚合查询"""

import logging
from typing import Any

import grpc
from google.protobuf import timestamp_pb2

from ..db.sample_reader import SampleReader
from ..generated import enose_analytics_pb2 as pb
from ..generated import enose_analytics_pb2_grpc as pb_grpc

logger = logging.getLogger(__name__)


class SampleServiceImpl(pb_grpc.SampleServiceServicer):
    """样本服务实现"""

    def __init__(self):
        self.reader = SampleReader()

    def ListSamples(
        self,
        request: pb.ListSamplesRequest,
        context: grpc.ServicerContext,
    ) -> pb.ListSamplesResponse:
        """列出样本"""
        try:
            samples = self.reader.list_samples(
                run_id=request.run_id if request.HasField("run_id") else None,
                phase_name=request.phase_name if request.HasField("phase_name") else None,
                params_hash=request.params_hash if request.HasField("params_hash") else None,
                liquid_ids=list(request.liquid_ids) if request.liquid_ids else None,
                limit=request.limit or 100,
                offset=request.offset or 0,
            )
            
            total = self.reader.count_samples(
                run_id=request.run_id if request.HasField("run_id") else None,
                phase_name=request.phase_name if request.HasField("phase_name") else None,
                params_hash=request.params_hash if request.HasField("params_hash") else None,
            )

            return pb.ListSamplesResponse(
                samples=[self._to_proto_sample(s) for s in samples],
                total=total,
            )
        except Exception as e:
            logger.error(f"ListSamples error: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.ListSamplesResponse()

    def GetSample(
        self,
        request: pb.GetSampleRequest,
        context: grpc.ServicerContext,
    ) -> pb.Sample:
        """获取单个样本详情"""
        try:
            sample = self.reader.get_sample(request.sample_id)
            if not sample:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                context.set_details(f"Sample {request.sample_id} not found")
                return pb.Sample()
            return self._to_proto_sample(sample)
        except Exception as e:
            logger.error(f"GetSample error: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.Sample()

    def GetSampleGroups(
        self,
        request: pb.GetSampleGroupsRequest,
        context: grpc.ServicerContext,
    ) -> pb.GetSampleGroupsResponse:
        """获取样本分组（跨 run 聚合）"""
        try:
            groups = self.reader.get_sample_groups(
                phase_name=request.phase_name if request.HasField("phase_name") else None,
                liquid_ids=list(request.liquid_ids) if request.liquid_ids else None,
                limit=request.limit or 100,
                offset=request.offset or 0,
            )

            return pb.GetSampleGroupsResponse(
                groups=[self._to_proto_sample_group(g) for g in groups],
                total=len(groups),
            )
        except Exception as e:
            logger.error(f"GetSampleGroups error: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.GetSampleGroupsResponse()

    def GetSampleSensorData(
        self,
        request: pb.GetSampleSensorDataRequest,
        context: grpc.ServicerContext,
    ) -> pb.GetSampleSensorDataResponse:
        """获取样本的传感器数据"""
        try:
            df = self.reader.get_sample_sensor_data(
                sample_id=request.sample_id,
                sensor_indices=list(request.sensor_indices) if request.sensor_indices else None,
                downsample_factor=request.downsample_factor or 1,
            )

            rows = []
            for _, row in df.iterrows():
                rows.append(pb.SensorDataRow(
                    time_ms=int(row.get("time_ms", 0)),
                    sensor_idx=int(row.get("sensor_idx", 0)),
                    value=float(row.get("value", 0)),
                    temperature=float(row.get("temperature", 0)),
                    humidity=float(row.get("humidity", 0)),
                    pressure=float(row.get("pressure", 0)),
                    heater_step=int(row.get("heater_step", 0)),
                ))

            return pb.GetSampleSensorDataResponse(
                sample_id=request.sample_id,
                rows=rows,
                total_points=len(df),
            )
        except Exception as e:
            logger.error(f"GetSampleSensorData error: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.GetSampleSensorDataResponse()

    def _to_proto_sample(self, sample: dict[str, Any]) -> pb.Sample:
        """将样本字典转换为 proto 消息"""
        liquids = []
        for liq in sample.get("liquids", []):
            liquids.append(pb.LiquidComponent(
                id=liq.get("id", ""),
                name=liq.get("name", ""),
                ratio=liq.get("ratio", 0),
                pump_index=liq.get("pump_index", -1),
            ))

        heater_configs = []
        for hc in sample.get("heater_configs", []):
            heater_configs.append(pb.HeaterConfig(
                sensor_idx=hc.get("sensor_idx", 0),
                temps=hc.get("temps", []),
                durs=hc.get("durs", []),
            ))

        proto_sample = pb.Sample(
            id=sample.get("id", 0),
            run_id=sample.get("run_id", 0),
            sample_idx=sample.get("sample_idx", 0),
            start_time_ms=sample.get("start_time_ms", 0),
            params_hash=sample.get("params_hash", ""),
            liquids=liquids,
            total_volume_ml=sample.get("total_volume_ml", 0),
            flow_rate_ml_s=sample.get("flow_rate_ml_s", 0),
            gas_pump_pwm=sample.get("gas_pump_pwm", 0),
            heater_configs=heater_configs,
            phase_name=sample.get("phase_name", ""),
            avg_temperature_c=sample.get("avg_temperature_c", 0),
            avg_humidity_pct=sample.get("avg_humidity_pct", 0),
            avg_pressure_hpa=sample.get("avg_pressure_hpa", 0),
        )

        if sample.get("end_time_ms"):
            proto_sample.end_time_ms = sample["end_time_ms"]

        if sample.get("termination_type"):
            proto_sample.termination_type = sample["termination_type"]
        if sample.get("termination_value"):
            proto_sample.termination_value = sample["termination_value"]
        if sample.get("max_duration_s"):
            proto_sample.max_duration_s = sample["max_duration_s"]

        return proto_sample

    def _to_proto_sample_group(self, group: dict[str, Any]) -> pb.SampleGroup:
        """将样本组字典转换为 proto 消息"""
        liquids = []
        liquid_ids = group.get("liquid_ids", [])
        liquid_names = group.get("liquid_names", [])
        for i, lid in enumerate(liquid_ids):
            liquids.append(pb.LiquidComponent(
                id=lid,
                name=liquid_names[i] if i < len(liquid_names) else "",
            ))

        proto_group = pb.SampleGroup(
            params_hash=group.get("params_hash", ""),
            liquids=liquids,
            gas_pump_pwm=group.get("gas_pump_pwm", 0),
            phase_name=group.get("phase_name", ""),
            sample_count=group.get("sample_count", 0),
            run_ids=group.get("run_ids", []),
        )

        if group.get("first_created"):
            ts = timestamp_pb2.Timestamp()
            ts.FromDatetime(group["first_created"])
            proto_group.first_created.CopyFrom(ts)

        if group.get("last_created"):
            ts = timestamp_pb2.Timestamp()
            ts.FromDatetime(group["last_created"])
            proto_group.last_created.CopyFrom(ts)

        return proto_group


def add_to_server(server: grpc.Server) -> None:
    """将服务注册到 gRPC 服务器"""
    pb_grpc.add_SampleServiceServicer_to_server(SampleServiceImpl(), server)
