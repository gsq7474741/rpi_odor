"""Sample Service - 样本分割与聚合查询"""

from typing import Any

import grpc
from google.protobuf import timestamp_pb2

from ..db.sample_reader import SampleReader
from ..logger import logger
from ..generated import enose_analytics_pb2 as pb
from ..generated import enose_analytics_pb2_grpc as pb_grpc



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

            # Batch fetch phase transitions and reading counts
            sample_ids = [s["id"] for s in samples]
            transitions_map = self.reader.get_phase_transitions_batch(sample_ids)
            reading_counts = self.reader.get_reading_counts_batch(sample_ids)

            return pb.ListSamplesResponse(
                samples=[
                    self._to_proto_sample(
                        s,
                        phase_transitions=transitions_map.get(s["id"]),
                        reading_count=reading_counts.get(s["id"], 0),
                    )
                    for s in samples
                ],
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
            transitions = self.reader.get_phase_transitions(request.sample_id)
            reading_count = self.reader.get_reading_count(request.sample_id)
            return self._to_proto_sample(
                sample,
                phase_transitions=transitions,
                reading_count=reading_count,
            )
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

    def GetAvailablePhases(
        self,
        request: pb.GetAvailablePhasesRequest,
        context: grpc.ServicerContext,
    ) -> pb.GetAvailablePhasesResponse:
        """获取可用的 Phase 列表"""
        try:
            run_id = request.run_id if request.HasField("run_id") else None
            phases = self.reader.get_available_phases(run_id=run_id)
            return pb.GetAvailablePhasesResponse(phase_names=phases)
        except Exception as e:
            logger.error(f"GetAvailablePhases error: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.GetAvailablePhasesResponse()

    def GetPhaseTransitions(
        self,
        request: pb.GetPhaseTransitionsRequest,
        context: grpc.ServicerContext,
    ) -> pb.GetPhaseTransitionsResponse:
        """获取样本的 Phase 转换记录"""
        try:
            transitions = self.reader.get_phase_transitions(request.sample_id)
            return pb.GetPhaseTransitionsResponse(
                transitions=[
                    pb.PhaseTransition(
                        id=t["id"],
                        sample_id=t["sample_id"],
                        phase_name=t["phase_name"],
                        start_time_ms=t["start_time_ms"],
                        end_time_ms=t.get("end_time_ms") or 0,
                        phase_order=t["phase_order"],
                    )
                    for t in transitions
                ]
            )
        except Exception as e:
            logger.error(f"GetPhaseTransitions error: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.GetPhaseTransitionsResponse()

    def _to_proto_sample(
        self,
        sample: dict[str, Any],
        phase_transitions: list[dict[str, Any]] | None = None,
        reading_count: int | None = None,
    ) -> pb.Sample:
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
            heater_configs.append(pb.HeaterConfigInfo(
                sensor_indices=hc.get("sensor_indices", []),
                profile_name=hc.get("profile_name", ""),
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
            # 组合实验元数据 (0016)
            reagent_batch_id=sample.get("reagent_batch_id") or "",
            reagent_prep_date=sample.get("reagent_prep_date") or "",
            prev_sample_id=sample.get("prev_sample_id") or 0,
            samples_since_wash=sample.get("samples_since_wash") or 0,
            sensor_hours_at_sample=sample.get("sensor_hours_at_sample") or 0.0,
            is_anchor=sample.get("is_anchor", False),
            is_blank=sample.get("is_blank", False),
            experiment_phase=sample.get("experiment_phase") or "",
            sequence_block=sample.get("sequence_block") or "",
            randomization_seed=sample.get("randomization_seed") or 0,
            wash_residual_response=sample.get("wash_residual_response") or [],
            quality_score=sample.get("quality_score") or 0.0,
            quality_level=sample.get("quality_level") or "",
        )

        if sample.get("end_time_ms"):
            proto_sample.end_time_ms = sample["end_time_ms"]

        if sample.get("termination_type"):
            proto_sample.termination_type = sample["termination_type"]
        if sample.get("termination_value"):
            proto_sample.termination_value = sample["termination_value"]
        if sample.get("max_duration_s"):
            proto_sample.max_duration_s = sample["max_duration_s"]

        # Phase transitions
        if phase_transitions:
            for t in phase_transitions:
                proto_sample.phase_transitions.append(pb.PhaseTransition(
                    id=t["id"],
                    sample_id=t["sample_id"],
                    phase_name=t["phase_name"],
                    start_time_ms=t["start_time_ms"],
                    end_time_ms=t.get("end_time_ms") or 0,
                    phase_order=t["phase_order"],
                ))

        # Reading count
        if reading_count is not None:
            proto_sample.reading_count = reading_count

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
