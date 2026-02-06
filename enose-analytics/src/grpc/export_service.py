"""ExportService gRPC 服务实现 - 数据导出"""

import csv
import io
import json
import math
import random
import zipfile
from datetime import datetime, timezone
from typing import Any, Iterator

import grpc
import numpy as np

from ..cache.frame_cache import FrameCache
from ..db.ml_label_repository import MLLabelRepository
from ..db.sample_reader import SampleReader
from ..logger import logger
from ..generated import enose_analytics_pb2 as pb
from ..generated import enose_analytics_pb2_grpc as pb_grpc


# 流式 chunk 大小 (64KB)
CHUNK_SIZE = 64 * 1024


class ExportServiceImpl(pb_grpc.ExportServiceServicer):
    """ExportService gRPC 实现"""

    def __init__(self):
        self._sample_reader = SampleReader()
        self._label_repo = MLLabelRepository()
        try:
            self._frame_cache = FrameCache()
        except Exception as e:
            logger.warning(f"FrameCache 初始化失败(导出帧功能不可用): {e}")
            self._frame_cache = None

    def ExportData(self, request, context):
        """导出数据 - 流式返回 ZIP 文件"""
        logger.info(
            f"ExportData: {len(request.sample_ids)} samples, "
            f"params={request.include_params}, raw={request.include_raw_data}, "
            f"frames={request.include_frames}, labels={request.include_ml_labels}, "
            f"dataset={request.include_dataset}"
        )

        try:
            # 在内存中构建 ZIP
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
                total_steps = sum([
                    1 if request.include_params else 0,
                    len(request.sample_ids) if request.include_raw_data else 0,
                    1 if request.include_frames else 0,
                    1 if request.include_ml_labels else 0,
                    1 if request.include_dataset else 0,
                    1,  # metadata.json
                ])
                current_step = 0

                # A. 样本参数表
                if request.include_params:
                    current_step += 1
                    yield pb.ExportDataChunk(
                        filename="samples_params.csv",
                        progress_percent=_pct(current_step, total_steps),
                    )
                    csv_bytes = self._build_params_csv(request.sample_ids)
                    zf.writestr("samples_params.csv", csv_bytes)

                # B. 原始传感器数据
                if request.include_raw_data:
                    for sid in request.sample_ids:
                        current_step += 1
                        yield pb.ExportDataChunk(
                            filename=f"raw/sample_{sid}.csv",
                            progress_percent=_pct(current_step, total_steps),
                        )
                        raw_csv = self._build_raw_csv(sid)
                        zf.writestr(f"raw/sample_{sid}.csv", raw_csv)

                # C. 归一化数据帧
                if request.include_frames:
                    current_step += 1
                    yield pb.ExportDataChunk(
                        filename="frames",
                        progress_percent=_pct(current_step, total_steps),
                    )
                    self._write_frames(
                        zf, request.sample_ids,
                        request.frame_method or "linear",
                        request.frame_n_samples or 100,
                        request.frame_format or "npz",
                    )

                # D. ML 标签
                if request.include_ml_labels:
                    current_step += 1
                    yield pb.ExportDataChunk(
                        filename="ml_labels.csv",
                        progress_percent=_pct(current_step, total_steps),
                    )
                    labels_csv = self._build_labels_csv(
                        request.sample_ids,
                        list(request.ml_label_configs),
                    )
                    zf.writestr("ml_labels.csv", labels_csv)

                # E. 训练数据集
                if request.include_dataset:
                    current_step += 1
                    yield pb.ExportDataChunk(
                        filename="dataset",
                        progress_percent=_pct(current_step, total_steps),
                    )
                    self._write_dataset(
                        zf, request.sample_ids,
                        request.frame_method or "linear",
                        request.frame_n_samples or 100,
                        request.dataset_label_config or "liquid_identity",
                        request.dataset_split,
                        request.dataset_train_ratio or 0.7,
                        request.dataset_val_ratio or 0.15,
                        request.dataset_format or "npz",
                    )

                # metadata.json
                current_step += 1
                metadata = self._build_metadata(request)
                zf.writestr("metadata.json", json.dumps(metadata, indent=2, ensure_ascii=False))

            # 流式返回 ZIP 数据
            zip_data = zip_buffer.getvalue()
            for i in range(0, len(zip_data), CHUNK_SIZE):
                chunk = zip_data[i:i + CHUNK_SIZE]
                yield pb.ExportDataChunk(
                    data=chunk,
                    progress_percent=100,
                )

            logger.info(f"ExportData 完成: {len(zip_data)} bytes")

        except Exception as e:
            logger.exception(f"ExportData failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))

    # ─── 内部方法 ───────────────────────────────────────────

    def _build_params_csv(self, sample_ids: list[int]) -> bytes:
        """构建样本参数 CSV"""
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "sample_id", "run_id", "sample_idx", "phase_name",
            "liquid_names", "liquid_ratios", "total_volume_ml", "flow_rate_ml_s",
            "gas_pump_pwm", "termination_type", "termination_value", "max_duration_s",
            "pre_wash_count", "avg_temperature_c", "avg_humidity_pct", "avg_pressure_hpa",
            "params_hash", "duration_s",
        ])

        for sid in sample_ids:
            sample = self._sample_reader.get_sample(sid)
            if not sample:
                continue
            liquids = sample.get("liquids", [])
            liquid_names = " + ".join(l.get("name", "") for l in liquids) if liquids else ""
            liquid_ratios = ";".join(f"{l.get('ratio', 0):.4f}" for l in liquids) if liquids else ""
            duration_s = None
            if sample.get("start_time_ms") and sample.get("end_time_ms"):
                duration_s = (sample["end_time_ms"] - sample["start_time_ms"]) / 1000.0

            writer.writerow([
                sample["id"], sample["run_id"], sample["sample_idx"],
                sample.get("phase_name", ""),
                liquid_names, liquid_ratios,
                sample.get("total_volume_ml", ""), sample.get("flow_rate_ml_s", ""),
                sample.get("gas_pump_pwm", 0),
                sample.get("termination_type", ""), sample.get("termination_value", ""),
                sample.get("max_duration_s", ""),
                sample.get("pre_wash_count", 0),
                sample.get("avg_temperature_c", ""), sample.get("avg_humidity_pct", ""),
                sample.get("avg_pressure_hpa", ""),
                sample.get("params_hash", ""),
                f"{duration_s:.1f}" if duration_s is not None else "",
            ])

        return output.getvalue().encode("utf-8-sig")

    def _build_raw_csv(self, sample_id: int) -> bytes:
        """构建单个样本的原始传感器数据 CSV（全量，不降采样）"""
        df = self._sample_reader.get_sample_sensor_data(sample_id)
        if df.empty:
            return b"time_ms,sensor_idx,value,temperature,humidity,pressure,heater_step\n"
        return df.to_csv(index=False).encode("utf-8")

    def _write_frames(
        self,
        zf: zipfile.ZipFile,
        sample_ids: list[int],
        method: str,
        n_samples: int,
        fmt: str,
    ):
        """写入归一化帧到 ZIP"""
        if not self._frame_cache:
            logger.warning("FrameCache 不可用，跳过帧导出")
            return

        if fmt == "npz":
            # 收集所有帧到一个 NPZ
            arrays = {}
            for sid in sample_ids:
                arr = self._frame_cache.get(sid, method, n_samples)
                if arr is not None:
                    arrays[f"sample_{sid}"] = arr

            if arrays:
                npz_buffer = io.BytesIO()
                np.savez_compressed(npz_buffer, **arrays)
                zf.writestr("frames.npz", npz_buffer.getvalue())
        else:
            # CSV: 每样本一个文件
            for sid in sample_ids:
                arr = self._frame_cache.get(sid, method, n_samples)
                if arr is None:
                    continue
                output = io.StringIO()
                writer = csv.writer(output)
                n_ch = arr.shape[1]
                writer.writerow(["point_idx"] + [f"ch{i}" for i in range(n_ch)])
                for idx in range(arr.shape[0]):
                    writer.writerow([idx] + [f"{v:.6f}" for v in arr[idx]])
                zf.writestr(f"frames/sample_{sid}.csv", output.getvalue().encode("utf-8"))

    def _build_labels_csv(
        self,
        sample_ids: list[int],
        config_names: list[str],
    ) -> bytes:
        """构建 ML 标签 CSV"""
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "sample_id", "config_name", "label_type", "label_str", "label_num", "label_index",
        ])

        sample_id_set = set(sample_ids)

        for config_name in config_names:
            labels = self._label_repo.get_labels_by_config(config_name=config_name)
            config = self._label_repo.get_config_by_name(config_name)
            label_type = config.get("label_type", "") if config else ""

            for lbl in labels:
                if lbl["sample_id"] not in sample_id_set:
                    continue
                writer.writerow([
                    lbl["sample_id"],
                    config_name,
                    label_type,
                    lbl.get("label_str", ""),
                    lbl.get("label_num", ""),
                    lbl.get("label_index", ""),
                ])

        return output.getvalue().encode("utf-8-sig")

    def _write_dataset(
        self,
        zf: zipfile.ZipFile,
        sample_ids: list[int],
        method: str,
        n_samples: int,
        label_config: str,
        split: bool,
        train_ratio: float,
        val_ratio: float,
        fmt: str,
    ):
        """写入训练数据集（帧矩阵 + 标签）"""
        if not self._frame_cache:
            logger.warning("FrameCache 不可用，跳过数据集导出")
            return

        # 获取标签
        labels = self._label_repo.get_labels_by_config(config_name=label_config)
        label_map = {lbl["sample_id"]: lbl for lbl in labels}
        config = self._label_repo.get_config_by_name(label_config)
        label_type = config.get("label_type", "classification") if config else "classification"

        # 收集有效样本（同时有帧和标签）
        X_list: list[np.ndarray] = []
        y_list: list[Any] = []
        ids_list: list[int] = []

        for sid in sample_ids:
            if sid not in label_map:
                continue
            arr = self._frame_cache.get(sid, method, n_samples)
            if arr is None:
                continue

            X_list.append(arr)
            ids_list.append(sid)

            lbl = label_map[sid]
            if label_type == "classification":
                y_list.append(lbl.get("label_index", 0))
            else:
                y_list.append(lbl.get("label_num", 0.0))

        if not X_list:
            logger.warning(f"数据集为空: 无有效样本 (帧+标签)")
            return

        X = np.array(X_list)  # (N, n_samples, n_channels)
        y = np.array(y_list)
        sample_ids_arr = np.array(ids_list)

        # 类名（分类时）
        class_names = []
        if label_type == "classification":
            # 从标签中收集
            idx_to_name: dict[int, str] = {}
            for lbl in labels:
                idx = lbl.get("label_index")
                name = lbl.get("label_str", "")
                if idx is not None and name:
                    idx_to_name[idx] = name
            class_names = [idx_to_name.get(i, f"class_{i}") for i in range(max(idx_to_name.keys()) + 1)] if idx_to_name else []

        if split:
            self._write_split_dataset(
                zf, X, y, sample_ids_arr, class_names,
                train_ratio, val_ratio, fmt, label_type,
            )
        else:
            self._write_full_dataset(
                zf, X, y, sample_ids_arr, class_names, fmt, label_type,
            )

    def _write_full_dataset(
        self,
        zf: zipfile.ZipFile,
        X: np.ndarray,
        y: np.ndarray,
        sample_ids: np.ndarray,
        class_names: list[str],
        fmt: str,
        label_type: str,
    ):
        """写入完整（不分割）数据集"""
        if fmt == "npz":
            buf = io.BytesIO()
            save_dict: dict[str, Any] = {
                "X": X, "y": y, "sample_ids": sample_ids,
            }
            if class_names:
                save_dict["class_names"] = np.array(class_names)
            np.savez_compressed(buf, **save_dict)
            zf.writestr("dataset.npz", buf.getvalue())
        else:
            self._write_dataset_csv(zf, "dataset", X, y, sample_ids, label_type)

    def _write_split_dataset(
        self,
        zf: zipfile.ZipFile,
        X: np.ndarray,
        y: np.ndarray,
        sample_ids: np.ndarray,
        class_names: list[str],
        train_ratio: float,
        val_ratio: float,
        fmt: str,
        label_type: str,
    ):
        """写入分割后的数据集"""
        n = len(X)
        indices = list(range(n))
        rng = random.Random(42)
        rng.shuffle(indices)

        train_end = math.floor(n * train_ratio)
        val_end = train_end + math.floor(n * val_ratio)

        train_idx = indices[:train_end]
        val_idx = indices[train_end:val_end]
        test_idx = indices[val_end:]

        if fmt == "npz":
            buf = io.BytesIO()
            save_dict: dict[str, Any] = {
                "X_train": X[train_idx], "y_train": y[train_idx],
                "X_val": X[val_idx], "y_val": y[val_idx],
                "X_test": X[test_idx], "y_test": y[test_idx],
                "sample_ids_train": sample_ids[train_idx],
                "sample_ids_val": sample_ids[val_idx],
                "sample_ids_test": sample_ids[test_idx],
            }
            if class_names:
                save_dict["class_names"] = np.array(class_names)
            np.savez_compressed(buf, **save_dict)
            zf.writestr("dataset.npz", buf.getvalue())
        else:
            self._write_dataset_csv(zf, "dataset/train", X[train_idx], y[train_idx], sample_ids[train_idx], label_type)
            self._write_dataset_csv(zf, "dataset/val", X[val_idx], y[val_idx], sample_ids[val_idx], label_type)
            self._write_dataset_csv(zf, "dataset/test", X[test_idx], y[test_idx], sample_ids[test_idx], label_type)

    def _write_dataset_csv(
        self,
        zf: zipfile.ZipFile,
        prefix: str,
        X: np.ndarray,
        y: np.ndarray,
        sample_ids: np.ndarray,
        label_type: str,
    ):
        """写入数据集 CSV（展平为表格形式）"""
        # X.csv: sample_id, point_idx, ch0, ch1, ..., ch7
        x_output = io.StringIO()
        x_writer = csv.writer(x_output)
        n_ch = X.shape[2] if len(X.shape) == 3 else 8
        x_writer.writerow(["sample_id", "point_idx"] + [f"ch{i}" for i in range(n_ch)])
        for i, sid in enumerate(sample_ids):
            for pt_idx in range(X.shape[1]):
                x_writer.writerow(
                    [int(sid), pt_idx] + [f"{v:.6f}" for v in X[i, pt_idx]]
                )
        zf.writestr(f"{prefix}_X.csv", x_output.getvalue().encode("utf-8"))

        # y.csv: sample_id, label
        y_output = io.StringIO()
        y_writer = csv.writer(y_output)
        y_writer.writerow(["sample_id", "label"])
        for i, sid in enumerate(sample_ids):
            y_writer.writerow([int(sid), y[i]])
        zf.writestr(f"{prefix}_y.csv", y_output.getvalue().encode("utf-8"))

    def _build_metadata(self, request) -> dict:
        """构建导出元信息"""
        return {
            "export_time": datetime.now(timezone.utc).isoformat(),
            "sample_ids": list(request.sample_ids),
            "sample_count": len(request.sample_ids),
            "include": {
                "params": request.include_params,
                "raw_data": request.include_raw_data,
                "frames": request.include_frames,
                "ml_labels": request.include_ml_labels,
                "dataset": request.include_dataset,
            },
            "frame_config": {
                "method": request.frame_method or "linear",
                "n_samples": request.frame_n_samples or 100,
                "format": request.frame_format or "npz",
            },
            "ml_label_configs": list(request.ml_label_configs),
            "dataset_config": {
                "label_config": request.dataset_label_config,
                "split": request.dataset_split,
                "train_ratio": request.dataset_train_ratio,
                "val_ratio": request.dataset_val_ratio,
                "format": request.dataset_format or "npz",
            } if request.include_dataset else None,
        }


def _pct(current: int, total: int) -> int:
    """计算进度百分比"""
    if total <= 0:
        return 0
    return min(99, int(current / total * 100))


def add_to_server(server: grpc.Server) -> None:
    """注册服务到 gRPC server"""
    pb_grpc.add_ExportServiceServicer_to_server(ExportServiceImpl(), server)
    logger.info("ExportService registered")
