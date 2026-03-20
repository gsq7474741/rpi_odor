"""ML 标签自动生成器

从 samples 表的结构化参数自动派生 ML 标签，支持：
- classification: liquid_identity, primary_liquid, mixture_formula
- regression: concentration, total_volume, gas_pump_speed, env_temperature
- contrastive: params_group
"""

from typing import Any

from ..db.ml_label_repository import MLLabelRepository
from ..db.sample_reader import SampleReader
from ..logger import logger


class LabelGenerator:
    """从 sample 参数自动生成 ML 标签"""

    def __init__(self):
        self.label_repo = MLLabelRepository()
        self.sample_reader = SampleReader()

    def generate_for_all_configs(
        self,
        run_ids: list[int] | None = None,
        phase_names: list[str] | None = None,
        sample_ids: list[int] | None = None,
    ) -> dict[str, int]:
        """为所有活跃策略生成标签，返回 {config_name: count}"""
        configs = self.label_repo.list_configs(active_only=True)
        results = {}
        for config in configs:
            count = self.generate_for_config(
                config_name=config["name"],
                run_ids=run_ids,
                phase_names=phase_names,
                sample_ids=sample_ids,
            )
            results[config["name"]] = count
        return results

    def generate_for_config(
        self,
        config_name: str,
        run_ids: list[int] | None = None,
        phase_names: list[str] | None = None,
        sample_ids: list[int] | None = None,
    ) -> int:
        """为指定策略生成标签，返回生成的标签数"""
        config = self.label_repo.get_config_by_name(config_name)
        if not config:
            logger.warning(f"Label config '{config_name}' not found")
            return 0

        # 获取样本
        samples = self._fetch_samples(run_ids=run_ids, phase_names=phase_names, sample_ids=sample_ids)
        if not samples:
            logger.info(f"No samples found for config '{config_name}'")
            return 0

        # 生成标签
        labels = []
        for sample in samples:
            label_values = self._compute_label(sample, config)
            if label_values is not None:
                labels.append({
                    "sample_id": sample["id"],
                    "config_id": config["id"],
                    **label_values,
                })

        if not labels:
            return 0

        # 为分类标签分配 label_index
        if config["label_type"] == "classification":
            self._assign_label_indices(labels)

        # 批量写入
        count = self.label_repo.upsert_labels_batch(labels)
        logger.info(f"Generated {count} labels for config '{config_name}'")
        return count

    def _fetch_samples(
        self,
        run_ids: list[int] | None = None,
        phase_names: list[str] | None = None,
        sample_ids: list[int] | None = None,
    ) -> list[dict[str, Any]]:
        """获取需要标注的样本"""
        all_samples = []
        if sample_ids:
            for sid in sample_ids:
                sample = self.sample_reader.get_sample(sid)
                if sample:
                    all_samples.append(sample)
        elif run_ids:
            for rid in run_ids:
                samples = self.sample_reader.list_samples(
                    run_id=rid, limit=10000
                )
                all_samples.extend(samples)
        else:
            all_samples = self.sample_reader.list_samples(limit=10000)

        # 按 phase 筛选
        if phase_names:
            phase_set = set(phase_names)
            all_samples = [s for s in all_samples if s.get("phase_name") in phase_set]

        return all_samples

    def _compute_label(
        self, sample: dict[str, Any], config: dict[str, Any]
    ) -> dict[str, Any] | None:
        """根据策略计算单个样本的标签值"""
        strategy = config["name"]
        liquids = sample.get("liquids", [])

        if strategy == "liquid_identity":
            return self._label_liquid_identity(liquids)
        elif strategy == "primary_liquid":
            return self._label_primary_liquid(liquids)
        elif strategy == "mixture_formula":
            return self._label_mixture_formula(liquids)
        elif strategy == "concentration":
            return self._label_concentration(liquids)
        elif strategy == "total_volume":
            return {"label_num": sample.get("total_volume_ml", 0)}
        elif strategy == "gas_pump_speed":
            pwm = sample.get("gas_pump_pwm", 0)
            return {"label_num": pwm / 100.0 if pwm else 0.0}
        elif strategy == "params_group":
            return {"label_str": sample.get("params_hash", "")}
        elif strategy == "env_temperature":
            temp = sample.get("avg_temperature_c")
            return {"label_num": temp} if temp is not None else {"label_num": 0.0}
        else:
            logger.warning(f"Unknown strategy: {strategy}")
            return None

    def _label_liquid_identity(self, liquids: list[dict]) -> dict[str, Any]:
        """液体身份：单液体→名称，混合→按比例降序拼接"""
        if not liquids:
            return {"label_str": "unknown"}
        if len(liquids) == 1:
            return {"label_str": liquids[0].get("name", "unknown")}
        parts = sorted(liquids, key=lambda l: (-l.get("ratio", 0), l.get("name", "")))
        label = " + ".join(l.get("name", "?") for l in parts)
        return {"label_str": label}

    def _label_primary_liquid(self, liquids: list[dict]) -> dict[str, Any]:
        """主成分液体：过滤稀释液后，占比最大的液体名称"""
        if not liquids:
            return {"label_str": "unknown"}
        non_solvent = [l for l in liquids if not l.get("is_solvent")]
        candidates = non_solvent if non_solvent else liquids
        primary = max(candidates, key=lambda l: l.get("ratio", 0))
        return {"label_str": primary.get("name", "unknown")}

    def _label_mixture_formula(self, liquids: list[dict]) -> dict[str, Any]:
        """精确配方：按 ID 排序后拼接的规范字符串"""
        if not liquids:
            return {"label_str": "empty"}
        parts = sorted(liquids, key=lambda l: l.get("id", ""))
        formula = "|".join(
            f'{l.get("id", "?")}:{l.get("ratio", 0):.4f}' for l in parts
        )
        return {"label_str": formula}

    def _label_concentration(
        self, liquids: list[dict]
    ) -> dict[str, Any] | None:
        """浓度：输出配方中每种液体的浓度（归一化为百分比）"""
        if not liquids:
            return {"label_str": "none", "label_json": {}}
        raw = {liq.get("name", "?"): float(liq.get("ratio", 0.0)) for liq in liquids}
        # 归一化：如果总和 ≈ 1（小数比例），转为百分比；否则保持原值
        total = sum(raw.values())
        if total > 0 and total <= 1.01:
            conc = {k: v / total * 100 for k, v in raw.items()}
        elif total > 0:
            conc = {k: v / total * 100 for k, v in raw.items()}
        else:
            conc = raw
        label_str = "|".join(
            f"{k}:{v:.1f}" for k, v in sorted(conc.items())
        )
        return {"label_str": label_str, "label_json": conc}

    def _assign_label_indices(self, labels: list[dict[str, Any]]) -> None:
        """为分类标签分配连续的 label_index (0, 1, 2, ...)"""
        unique_strs = sorted(set(
            lbl["label_str"] for lbl in labels if lbl.get("label_str") is not None
        ))
        str_to_idx = {s: i for i, s in enumerate(unique_strs)}
        for lbl in labels:
            if lbl.get("label_str") is not None:
                lbl["label_index"] = str_to_idx[lbl["label_str"]]
