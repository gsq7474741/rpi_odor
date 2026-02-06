#!/usr/bin/env python3
"""
分析服务测试数据填充脚本

填充以下表的假数据：
- runs: 实验运行记录
- samples: 样本记录 (含完整参数: 液体、采集、加热器、清洗、环境)
- sensor_readings_v2: 传感器读数 (用于可视化)
- sample_phase_transitions: Phase 转换记录
- sample_ml_labels: ML 标签 (liquid_identity, primary_liquid, mixture_formula 等)
- sample_labels / labeled_ranges: 旧标签系统
- ml_models / training_jobs / training_progress: ML 管线
- quality_results / quality_daily_stats: 质检
- inference_history: 推理历史

用法:
    cd enose-analytics
    uv run python scripts/seed_test_data.py              # 默认清除之前seed的数据后重新填充
    uv run python scripts/seed_test_data.py --no-clean   # 不清除之前的seed数据（追加）

注意:
    - 使用 run_id 范围 90000-99999 标识 seed 产生的数据
    - 清理只删除 seed 产生的数据，不影响真实实验数据
"""

import argparse
import hashlib
import json
import logging
import os
import random
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import psycopg

# 添加 src 到路径
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from dotenv import load_dotenv

# 加载环境变量
load_dotenv(Path(__file__).parent.parent / ".env.local", override=True)
load_dotenv(Path(__file__).parent.parent / ".env", override=False)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


# 数据库连接
def get_db_dsn() -> str:
    host = os.environ.get("DATABASE_HOST", "192.168.1.235")
    port = os.environ.get("DATABASE_PORT", "5432")
    database = os.environ.get("DATABASE_NAME", "enose")
    user = os.environ.get("DATABASE_USER", "enose")
    password = os.environ.get("DATABASE_PASSWORD", "enose_secure_password_change_me")
    return f"postgresql://{user}:{password}@{host}:{port}/{database}"


# ============================================================================
# 样品标签数据 (旧标签系统, 保留兼容)
# ============================================================================
SAMPLE_LABELS = [
    {"name": "苹果汁", "description": "100% 纯苹果汁样品"},
    {"name": "橙汁", "description": "新鲜橙汁样品"},
    {"name": "葡萄汁", "description": "浓缩葡萄汁"},
    {"name": "蒸馏水", "description": "空白对照样品"},
    {"name": "乙醇溶液", "description": "75% 乙醇清洗液"},
    {"name": "红酒", "description": "干红葡萄酒样品"},
    {"name": "白酒", "description": "52度白酒样品"},
    {"name": "咖啡", "description": "现磨咖啡样品"},
]


# ============================================================================
# 传感器数据生成
# ============================================================================
def generate_sensor_reading(
    base_value: float,
    noise_level: float = 0.05,
    drift: float = 0.0
) -> float:
    """生成带噪声的传感器读数"""
    noise = np.random.normal(0, base_value * noise_level)
    return max(100, base_value + noise + drift)


def generate_mox_pattern(label: str, sensor_idx: int) -> float:
    """根据样品标签生成 MOX 传感器基准值 (支持混合液体)"""
    base_patterns = {
        "苹果汁": [50000, 45000, 60000, 55000, 48000, 52000, 58000, 46000],
        "橙汁": [45000, 55000, 50000, 48000, 52000, 47000, 53000, 49000],
        "葡萄汁": [55000, 48000, 52000, 58000, 45000, 50000, 47000, 54000],
        "蒸馏水": [100000, 98000, 102000, 99000, 101000, 97000, 103000, 100000],
        "乙醇溶液": [30000, 28000, 32000, 29000, 31000, 27000, 33000, 30000],
        "红酒": [40000, 42000, 38000, 44000, 36000, 45000, 37000, 41000],
        "白酒": [25000, 27000, 23000, 28000, 22000, 29000, 24000, 26000],
        "咖啡": [35000, 38000, 32000, 40000, 30000, 42000, 33000, 36000],
    }
    pattern = base_patterns.get(label, [50000] * 8)
    return pattern[sensor_idx % len(pattern)]


def generate_mixed_mox_pattern(
    liquids: list[dict], sensor_idx: int
) -> float:
    """混合液体的加权传感器基准值"""
    total = 0.0
    for liq in liquids:
        base = generate_mox_pattern(liq["name"], sensor_idx)
        total += base * liq["ratio"]
    return total


# ============================================================================
# 实验配置模板 (含完整参数)
# ============================================================================
HEATER_PROFILES = [
    {"profile_name": "constant_320", "temps": [320], "durs": [0]},
    {"profile_name": "pulse_250_350", "temps": [250, 350], "durs": [5000, 5000]},
    {"profile_name": "ramp_200_400", "temps": [200, 300, 400], "durs": [3000, 3000, 3000]},
]

EXPERIMENT_CONFIGS = [
    {
        "name": "果汁分类实验",
        "liquids": [
            {"id": "apple_juice", "name": "苹果汁", "pump_index": 0},
            {"id": "orange_juice", "name": "橙汁", "pump_index": 1},
            {"id": "grape_juice", "name": "葡萄汁", "pump_index": 2},
        ],
        "gas_pump_pwm": 50,
        "volume_ml": 5.0,
        "flow_rate_ml_s": 0.5,
        "termination_type": "duration",
        "max_duration_s": 120,
        "heater_profile": HEATER_PROFILES[0],
        "pre_wash_count": 1,
        "allow_mix": True,
    },
    {
        "name": "酒精检测实验",
        "liquids": [
            {"id": "red_wine", "name": "红酒", "pump_index": 0},
            {"id": "white_wine", "name": "白酒", "pump_index": 1},
            {"id": "distilled_water", "name": "蒸馏水", "pump_index": 2},
        ],
        "gas_pump_pwm": 60,
        "volume_ml": 3.0,
        "flow_rate_ml_s": 0.3,
        "termination_type": "duration",
        "max_duration_s": 90,
        "heater_profile": HEATER_PROFILES[1],
        "pre_wash_count": 2,
        "allow_mix": True,
    },
    {
        "name": "咖啡品质实验",
        "liquids": [
            {"id": "coffee", "name": "咖啡", "pump_index": 0},
            {"id": "distilled_water", "name": "蒸馏水", "pump_index": 1},
        ],
        "gas_pump_pwm": 70,
        "volume_ml": 4.0,
        "flow_rate_ml_s": 0.4,
        "termination_type": "cycles",
        "max_duration_s": 150,
        "heater_profile": HEATER_PROFILES[2],
        "pre_wash_count": 0,
        "allow_mix": False,
    },
    {
        "name": "浓度梯度实验",
        "liquids": [
            {"id": "ethanol", "name": "乙醇溶液", "pump_index": 0},
            {"id": "distilled_water", "name": "蒸馏水", "pump_index": 1},
        ],
        "gas_pump_pwm": 55,
        "volume_ml": 5.0,
        "flow_rate_ml_s": 0.5,
        "termination_type": "duration",
        "max_duration_s": 100,
        "heater_profile": HEATER_PROFILES[0],
        "pre_wash_count": 2,
        "allow_mix": True,
    },
]

# 真实的 phase 序列 (匹配 C++ 后端 phase_marker)
PHASE_SEQUENCES = [
    ["PREHEAT", "INJECT", "ACQUIRE", "DRAIN"],
    ["PREHEAT", "INJECT", "ACQUIRE", "PURGE", "RECOVERY"],
    ["BASELINE", "INJECT", "ACQUIRE", "WASH", "DRAIN"],
    ["PREHEAT", "WASH", "INJECT", "ACQUIRE", "PURGE"],
]


def compute_params_hash(params: dict) -> str:
    """计算参数哈希 (16字符)"""
    json_str = json.dumps(params, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(json_str.encode()).hexdigest()[:16]


def pick_sample_liquids(config: dict) -> list[dict]:
    """从实验配置中选择样本液体 (可能单液体或混合)"""
    liquids = config["liquids"]
    if config.get("allow_mix") and len(liquids) >= 2 and random.random() < 0.35:
        # 35% 概率生成混合液体 (2种)
        selected = random.sample(liquids, 2)
        # 生成随机比例 (0.1 步长)
        r = random.choice([0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8])
        return [
            {**selected[0], "ratio": r},
            {**selected[1], "ratio": round(1.0 - r, 2)},
        ]
    else:
        liq = random.choice(liquids)
        return [{**liq, "ratio": 1.0}]


# ============================================================================
# 数据清理
# ============================================================================
def _clear_redis_caches() -> None:
    """清除 Redis 中的帧缓存和可视化缓存"""
    try:
        import redis as redis_lib
        redis_host = os.environ.get("REDIS_HOST", "192.168.1.235")
        redis_port = int(os.environ.get("REDIS_PORT", "6379"))
        redis_db = int(os.environ.get("REDIS_DB", "0"))
        r = redis_lib.Redis(host=redis_host, port=redis_port, db=redis_db)
        
        if not r.ping():
            logger.warning("  Redis 不可达，跳过缓存清除")
            return
        
        # 清除 frames:* (归一化帧缓存)
        frame_count = 0
        for key in r.scan_iter("frames:*"):
            r.delete(key)
            frame_count += 1
        
        # 清除 vis:* (可视化结果缓存)
        vis_count = 0
        for key in r.scan_iter("vis:*"):
            r.delete(key)
            vis_count += 1
        
        logger.info(f"  清除 Redis 缓存: frames={frame_count}, vis={vis_count}")
        r.close()
    except Exception as e:
        logger.warning(f"  Redis 缓存清除失败 (非致命): {e}")


def clean_test_data(conn: psycopg.Connection) -> None:
    """清除测试数据"""
    logger.info("清除测试数据...")
    
    with conn.cursor() as cur:
        # 清除传感器数据 (测试 run_id 范围)
        try:
            cur.execute("""
                DELETE FROM sensor_readings_v2 
                WHERE run_id >= 90000 AND run_id < 100000
            """)
            logger.info(f"  清除 sensor_readings_v2 (测试数据): {cur.rowcount} 行")
        except Exception as e:
            logger.warning(f"  跳过 sensor_readings_v2: {e}")
        
        # 清除 sample_ml_labels (ML 标签, 级联也会处理但显式更清晰)
        try:
            cur.execute("""
                DELETE FROM sample_ml_labels 
                WHERE sample_id IN (SELECT id FROM samples WHERE run_id >= 90000 AND run_id < 100000)
            """)
            logger.info(f"  清除 sample_ml_labels (测试数据): {cur.rowcount} 行")
        except Exception as e:
            logger.warning(f"  跳过 sample_ml_labels: {e}")
        
        # 清除 sample_phase_transitions
        try:
            cur.execute("""
                DELETE FROM sample_phase_transitions 
                WHERE sample_id IN (SELECT id FROM samples WHERE run_id >= 90000 AND run_id < 100000)
            """)
            logger.info(f"  清除 sample_phase_transitions (测试数据): {cur.rowcount} 行")
        except Exception as e:
            logger.warning(f"  跳过 sample_phase_transitions: {e}")
        
        # 清除 samples (会级联删除)
        try:
            cur.execute("""
                DELETE FROM samples 
                WHERE run_id >= 90000 AND run_id < 100000
            """)
            logger.info(f"  清除 samples (测试数据): {cur.rowcount} 行")
        except Exception as e:
            logger.warning(f"  跳过 samples: {e}")
        
        # 清除 runs (测试 run_id 范围)
        try:
            cur.execute("""
                DELETE FROM runs 
                WHERE id >= 90000 AND id < 100000
            """)
            logger.info(f"  清除 runs (测试数据): {cur.rowcount} 行")
        except Exception as e:
            logger.warning(f"  跳过 runs: {e}")
        
        # 清除 ml_datasets (全表, 只有 seed 会写)
        try:
            cur.execute("DELETE FROM ml_datasets")
            logger.info(f"  清除 ml_datasets: {cur.rowcount} 行")
        except Exception as e:
            logger.warning(f"  跳过 ml_datasets: {e}")
        
        # 清除 normalized_frames (测试 sample 的帧缓存)
        try:
            cur.execute("""
                DELETE FROM normalized_frames 
                WHERE sample_id IN (SELECT id FROM samples WHERE run_id >= 90000 AND run_id < 100000)
            """)
            logger.info(f"  清除 normalized_frames (测试数据): {cur.rowcount} 行")
        except Exception as e:
            logger.warning(f"  跳过 normalized_frames: {e}")
        
        # 按依赖顺序删除其他表
        tables = [
            "training_progress",
            "inference_history",
            "quality_daily_stats",
            "quality_results",
            "training_jobs",
            "labeled_ranges",
            "sample_labels",
            "ml_models",
            "visualization_cache",
        ]
        
        for table in tables:
            try:
                cur.execute(f"DELETE FROM {table}")
                logger.info(f"  清除 {table}: {cur.rowcount} 行")
            except Exception as e:
                logger.warning(f"  跳过 {table}: {e}")
    
    conn.commit()
    
    # 清除 Redis 缓存 (frames:* 和 vis:*)
    _clear_redis_caches()
    
    logger.info("测试数据清除完成")


# ============================================================================
# 数据填充
# ============================================================================
def seed_runs_and_samples(
    conn: psycopg.Connection,
    days: int = 7,
    runs_per_day: int = 3,
    samples_per_run: int = 5
) -> tuple[list[int], list[int]]:
    """填充 runs 和 samples 表 (含完整参数)，返回 (run_ids, sample_ids)"""
    logger.info(f"填充 runs 和 samples ({days} 天, 每天 {runs_per_day} 运行, 每运行 {samples_per_run} 样本)...")
    
    now = datetime.now()
    run_id_base = 90000
    run_ids = []
    sample_ids = []
    sensor_data_batch = []
    batch_size = 5000
    
    with conn.cursor() as cur:
        for day_offset in range(days):
            day_start = now - timedelta(days=day_offset + 1)
            
            for run_idx in range(runs_per_day):
                config = random.choice(EXPERIMENT_CONFIGS)
                run_id = run_id_base + day_offset * 100 + run_idx
                run_start = day_start + timedelta(hours=random.randint(8, 18), minutes=random.randint(0, 59))
                
                run_config = {
                    "name": config["name"],
                    "gas_pump_pwm": config["gas_pump_pwm"],
                    "volume_ml": config["volume_ml"],
                    "flow_rate_ml_s": config["flow_rate_ml_s"],
                    "termination_type": config["termination_type"],
                    "heater_profile": config["heater_profile"]["profile_name"],
                }
                
                try:
                    cur.execute(
                        """
                        INSERT INTO runs (id, created_at, completed_at, state, config_json, current_step, total_steps)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING
                        RETURNING id
                        """,
                        (
                            run_id,
                            run_start,
                            run_start + timedelta(minutes=random.randint(30, 120)),
                            random.choice(["completed", "completed", "completed", "error"]),
                            json.dumps(run_config),
                            samples_per_run,
                            samples_per_run,
                        )
                    )
                    row = cur.fetchone()
                    if row:
                        run_ids.append(run_id)
                except Exception as e:
                    logger.warning(f"  跳过 run {run_id}: {e}")
                    continue
                
                sample_start_time = run_start
                for sample_idx in range(samples_per_run):
                    # 选择液体 (可能混合)
                    selected_liquids = pick_sample_liquids(config)
                    
                    liquid_ids = [l["id"] for l in selected_liquids]
                    liquid_names = [l["name"] for l in selected_liquids]
                    liquid_ratios = [l["ratio"] for l in selected_liquids]
                    pump_indices = [l["pump_index"] for l in selected_liquids]
                    
                    termination_value = random.randint(20, 60)
                    heater_profile = config["heater_profile"]
                    heater_configs = [
                        {
                            "sensor_indices": list(range(8)),
                            "profile_name": heater_profile["profile_name"],
                            "temps": heater_profile["temps"],
                            "durs": heater_profile["durs"],
                        }
                    ]
                    
                    # 环境参数 (模拟)
                    avg_temp = round(22 + random.uniform(-3, 5), 1)
                    avg_hum = round(45 + random.uniform(-15, 20), 1)
                    avg_pres = round(1013 + random.uniform(-5, 5), 1)
                    
                    sample_params = {
                        "liquid_ids": liquid_ids,
                        "liquid_ratios": liquid_ratios,
                        "total_volume_ml": config["volume_ml"],
                        "flow_rate_ml_s": config["flow_rate_ml_s"],
                        "gas_pump_pwm": config["gas_pump_pwm"],
                        "termination_type": config["termination_type"],
                        "termination_value": termination_value,
                        "heater_configs": heater_configs,
                        "pre_wash_count": config["pre_wash_count"],
                    }
                    params_hash = compute_params_hash(sample_params)
                    
                    sample_duration_s = termination_value
                    sample_end_time = sample_start_time + timedelta(seconds=sample_duration_s)
                    start_time_ms = int(sample_start_time.timestamp() * 1000)
                    end_time_ms = int(sample_end_time.timestamp() * 1000)
                    
                    try:
                        cur.execute(
                            """
                            INSERT INTO samples (
                                run_id, sample_idx, start_time_ms, end_time_ms, params_hash,
                                liquid_ids, liquid_names, liquid_ratios, pump_indices,
                                total_volume_ml, flow_rate_ml_s, gas_pump_pwm,
                                termination_type, termination_value, max_duration_s,
                                heater_configs, pre_wash_count,
                                phase_name,
                                avg_temperature_c, avg_humidity_pct, avg_pressure_hpa,
                                params_json
                            )
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                            RETURNING id
                            """,
                            (
                                run_id,
                                sample_idx,
                                start_time_ms,
                                end_time_ms,
                                params_hash,
                                liquid_ids,
                                liquid_names,
                                liquid_ratios,
                                pump_indices,
                                config["volume_ml"],
                                config["flow_rate_ml_s"],
                                config["gas_pump_pwm"],
                                config["termination_type"],
                                termination_value,
                                config["max_duration_s"],
                                json.dumps(heater_configs),
                                config["pre_wash_count"],
                                "ACQUIRE",
                                avg_temp,
                                avg_hum,
                                avg_pres,
                                json.dumps(sample_params),
                            )
                        )
                        row = cur.fetchone()
                        if row:
                            sample_id = row[0] if isinstance(row, tuple) else row["id"]
                            sample_ids.append(sample_id)
                            
                            # 生成传感器数据
                            for t_offset in range(0, sample_duration_s * 2, 1):  # 2Hz 采样
                                time_ms = start_time_ms + t_offset * 500
                                for sensor_idx in range(8):
                                    base_value = generate_mixed_mox_pattern(selected_liquids, sensor_idx)
                                    drift = (t_offset / (sample_duration_s * 2)) * base_value * 0.1
                                    value = generate_sensor_reading(base_value, drift=drift)
                                    temperature = avg_temp + random.uniform(-1, 1)
                                    humidity = avg_hum + random.uniform(-5, 5)
                                    
                                    sensor_data_batch.append((
                                        time_ms,
                                        t_offset * 500,
                                        sensor_idx,
                                        sensor_idx,
                                        0,
                                        value,
                                        temperature,
                                        humidity,
                                        (t_offset // 2) % len(heater_profile["temps"]),
                                        run_id,
                                        "ACQUIRE",
                                        sample_id,
                                    ))
                                    
                                    if len(sensor_data_batch) >= batch_size:
                                        cur.executemany(
                                            """
                                            INSERT INTO sensor_readings_v2 
                                            (time_ms, device_tick_ms, sensor_idx, sensor_id, sensor_type, 
                                             value, temperature, humidity, heater_step, run_id, phase_name, sample_id)
                                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                                            ON CONFLICT (time_ms, sensor_idx) DO NOTHING
                                            """,
                                            sensor_data_batch
                                        )
                                        sensor_data_batch = []
                                        conn.commit()
                    except Exception as e:
                        logger.warning(f"  跳过 sample {run_id}/{sample_idx}: {e}")
                    
                    sample_start_time = sample_end_time + timedelta(seconds=random.randint(5, 30))
        
        if sensor_data_batch:
            cur.executemany(
                """
                INSERT INTO sensor_readings_v2 
                (time_ms, device_tick_ms, sensor_idx, sensor_id, sensor_type, 
                 value, temperature, humidity, heater_step, run_id, phase_name, sample_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (time_ms, sensor_idx) DO NOTHING
                """,
                sensor_data_batch
            )
    
    conn.commit()
    logger.info(f"  创建 {len(run_ids)} 个 runs, {len(sample_ids)} 个 samples")
    return run_ids, sample_ids


def seed_sample_phase_transitions(
    conn: psycopg.Connection,
    sample_ids: list[int]
) -> None:
    """为每个 sample 填充 phase transitions 数据 (使用真实 phase 名称)"""
    logger.info(f"填充 sample_phase_transitions ({len(sample_ids)} 个样本)...")
    
    with conn.cursor() as cur:
        for sample_id in sample_ids:
            cur.execute(
                "SELECT start_time_ms, end_time_ms FROM samples WHERE id = %s",
                (sample_id,)
            )
            row = cur.fetchone()
            if not row or row[1] is None:
                continue
            
            start_ms, end_ms = row
            duration_ms = end_ms - start_ms
            
            phases = random.choice(PHASE_SEQUENCES)
            num_phases = len(phases)
            phase_duration = duration_ms // num_phases
            
            for phase_order, phase_name in enumerate(phases):
                phase_start = start_ms + phase_order * phase_duration
                phase_end = start_ms + (phase_order + 1) * phase_duration if phase_order < num_phases - 1 else end_ms
                
                try:
                    cur.execute(
                        """
                        INSERT INTO sample_phase_transitions 
                        (sample_id, phase_name, start_time_ms, end_time_ms, phase_order)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (sample_id, phase_order) DO NOTHING
                        """,
                        (sample_id, phase_name, phase_start, phase_end, phase_order)
                    )
                except Exception as e:
                    logger.warning(f"  跳过 phase transition {sample_id}/{phase_order}: {e}")
    
    conn.commit()
    logger.info(f"  完成 sample_phase_transitions 填充")


def seed_sample_labels(conn: psycopg.Connection) -> dict[str, str]:
    """填充样品标签"""
    logger.info("填充样品标签...")
    label_ids = {}
    
    with conn.cursor() as cur:
        for label in SAMPLE_LABELS:
            # 检查是否已存在
            cur.execute(
                "SELECT id FROM sample_labels WHERE name = %s",
                (label["name"],)
            )
            row = cur.fetchone()
            
            if row:
                # row 可能是 tuple 或 dict
                label_ids[label["name"]] = str(row[0] if isinstance(row, tuple) else row["id"])
                logger.info(f"  已存在: {label['name']}")
            else:
                label_id = str(uuid.uuid4())
                cur.execute(
                    """
                    INSERT INTO sample_labels (id, name, description, sample_count)
                    VALUES (%s, %s, %s, 0)
                    """,
                    (label_id, label["name"], label["description"])
                )
                label_ids[label["name"]] = label_id
                logger.info(f"  创建: {label['name']}")
    
    conn.commit()
    return label_ids


def seed_labeled_ranges(
    conn: psycopg.Connection,
    label_ids: dict[str, str],
    run_ids: list[int],
) -> list[dict]:
    """填充标签范围 (基于已创建的 runs)"""
    logger.info(f"填充标签范围...")
    
    labeled_ranges = []
    label_names = list(label_ids.keys())
    
    with conn.cursor() as cur:
        for run_id in run_ids:
            # 随机选择一个标签
            label_name = random.choice(label_names)
            label_id = label_ids[label_name]
            
            # 获取该 run 的时间范围
            cur.execute(
                "SELECT created_at, completed_at FROM runs WHERE id = %s",
                (run_id,)
            )
            row = cur.fetchone()
            if not row:
                continue
            
            start_time, end_time = row
            if end_time is None:
                end_time = start_time + timedelta(minutes=30)
            
            labeled_ranges.append({
                "label_id": label_id,
                "label_name": label_name,
                "experiment_id": str(run_id),
                "start_time": start_time,
                "end_time": end_time,
                "phase": "SAMPLE"
            })
            
            cur.execute(
                """
                INSERT INTO labeled_ranges 
                (id, label_id, experiment_id, start_time, end_time, phase)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid.uuid4()),
                    label_id,
                    str(run_id),
                    start_time,
                    end_time,
                    "SAMPLE"
                )
            )
    
    conn.commit()
    logger.info(f"  创建 {len(labeled_ranges)} 个标签范围")
    return labeled_ranges


def seed_ml_models(conn: psycopg.Connection, label_ids: dict[str, str]) -> list[str]:
    """填充 ML 模型"""
    logger.info("填充 ML 模型...")
    
    models = [
        {
            "name": "fruit_juice_classifier_v1",
            "description": "果汁分类模型 (苹果汁、橙汁、葡萄汁)",
            "config": {
                "hidden_layers": [64, 32],
                "activation": "relu",
                "dropout": 0.2,
                "epochs": 100,
                "batch_size": 32
            },
            "input_dim": 80,  # 8 sensors * 10 heater steps
            "output_dim": 3,
            "class_names": ["苹果汁", "橙汁", "葡萄汁"],
            "train_accuracy": 0.95,
            "val_accuracy": 0.92,
            "train_loss": 0.15,
            "val_loss": 0.25,
        },
        {
            "name": "alcohol_detector_v1",
            "description": "酒精检测模型 (红酒、白酒、蒸馏水)",
            "config": {
                "hidden_layers": [128, 64, 32],
                "activation": "relu",
                "dropout": 0.3,
                "epochs": 150,
                "batch_size": 16
            },
            "input_dim": 80,
            "output_dim": 3,
            "class_names": ["红酒", "白酒", "蒸馏水"],
            "train_accuracy": 0.98,
            "val_accuracy": 0.96,
            "train_loss": 0.08,
            "val_loss": 0.12,
        },
        {
            "name": "beverage_classifier_v2",
            "description": "饮品综合分类模型",
            "config": {
                "hidden_layers": [256, 128, 64],
                "activation": "relu",
                "dropout": 0.25,
                "epochs": 200,
                "batch_size": 32
            },
            "input_dim": 80,
            "output_dim": 8,
            "class_names": list(label_ids.keys()),
            "train_accuracy": 0.88,
            "val_accuracy": 0.85,
            "train_loss": 0.35,
            "val_loss": 0.45,
        },
    ]
    
    model_ids = []
    
    with conn.cursor() as cur:
        for model in models:
            model_id = str(uuid.uuid4())
            cur.execute(
                """
                INSERT INTO ml_models 
                (id, name, description, config, input_dim, output_dim, class_names,
                 train_accuracy, val_accuracy, train_loss, val_loss,
                 minio_bucket, minio_path, file_size)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (name) DO UPDATE SET
                    description = EXCLUDED.description,
                    config = EXCLUDED.config,
                    train_accuracy = EXCLUDED.train_accuracy,
                    val_accuracy = EXCLUDED.val_accuracy
                RETURNING id
                """,
                (
                    model_id,
                    model["name"],
                    model["description"],
                    json.dumps(model["config"]),
                    model["input_dim"],
                    model["output_dim"],
                    model["class_names"],
                    model["train_accuracy"],
                    model["val_accuracy"],
                    model["train_loss"],
                    model["val_loss"],
                    "models",
                    f"models/{model['name']}.pt",
                    random.randint(100000, 500000)
                )
            )
            row = cur.fetchone()
            model_ids.append(str(row[0] if isinstance(row, tuple) else row["id"]))
            logger.info(f"  创建模型: {model['name']}")
    
    conn.commit()
    return model_ids


def seed_quality_results(conn: psycopg.Connection, days: int = 7) -> None:
    """填充质检结果"""
    logger.info(f"填充质检结果 ({days} 天)...")
    
    alert_types = [
        {"flag": "BASELINE_UNSTABLE", "severity": "warning"},
        {"flag": "SENSOR_DRIFT", "severity": "warning"},
        {"flag": "HIGH_NOISE", "severity": "info"},
        {"flag": "OUT_OF_RANGE", "severity": "critical"},
        {"flag": "HUMIDITY_WARNING", "severity": "warning"},
        {"flag": "TEMPERATURE_WARNING", "severity": "warning"},
    ]
    
    now = datetime.now()
    
    with conn.cursor() as cur:
        for day_offset in range(days):
            # 每天生成 50-200 条质检记录
            records_per_day = random.randint(50, 200)
            day_start = now - timedelta(days=day_offset + 1)
            
            for _ in range(records_per_day):
                ts = day_start + timedelta(seconds=random.randint(0, 86400))
                sensor_seq = random.randint(1, 1000000)
                experiment_id = f"test_exp_{90000 + random.randint(0, 800)}"
                
                # 生成告警 (20% 概率有告警)
                alerts = []
                if random.random() < 0.2:
                    num_alerts = random.randint(1, 3)
                    selected_alerts = random.sample(alert_types, num_alerts)
                    for alert in selected_alerts:
                        alerts.append({
                            "flag": alert["flag"],
                            "severity": alert["severity"],
                            "message": f"传感器 {random.randint(0, 7)} 检测到 {alert['flag']}",
                            "sensor_idx": random.randint(0, 7)
                        })
                
                # 生成指标
                metrics = [
                    {"name": "baseline_cv", "value": random.uniform(0.01, 0.1)},
                    {"name": "noise_std", "value": random.uniform(0.01, 0.15)},
                    {"name": "drift_rate", "value": random.uniform(0, 0.2)},
                ]
                
                cur.execute(
                    """
                    INSERT INTO quality_results 
                    (ts, sensor_seq, experiment_id, alerts, metrics)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (ts, sensor_seq, experiment_id, json.dumps(alerts), json.dumps(metrics))
                )
    
    conn.commit()
    logger.info("质检结果填充完成")


def seed_training_jobs(
    conn: psycopg.Connection, 
    model_ids: list[str],
    label_ids: dict[str, str]
) -> list[str]:
    """填充训练任务"""
    logger.info("填充训练任务...")
    
    job_statuses = ["COMPLETED", "COMPLETED", "COMPLETED", "FAILED", "RUNNING", "PENDING"]
    job_ids = []
    
    with conn.cursor() as cur:
        for i, model_id in enumerate(model_ids):
            for j in range(3):  # 每个模型 3 个历史训练任务
                job_id = str(uuid.uuid4())
                status = random.choice(job_statuses)
                total_epochs = random.randint(50, 200)
                current_epoch = total_epochs if status == "COMPLETED" else random.randint(0, total_epochs)
                
                created_at = datetime.now() - timedelta(days=random.randint(1, 30))
                started_at = created_at + timedelta(minutes=random.randint(1, 10)) if status != "PENDING" else None
                completed_at = started_at + timedelta(hours=random.randint(1, 4)) if status == "COMPLETED" else None
                
                # 选择随机标签子集
                selected_labels = random.sample(list(label_ids.values()), random.randint(2, 5))
                
                cur.execute(
                    """
                    INSERT INTO training_jobs 
                    (id, model_name, model_config, label_ids, status, 
                     current_epoch, total_epochs, train_loss, val_loss,
                     train_accuracy, val_accuracy, created_at, started_at, completed_at,
                     model_id, error_message)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        job_id,
                        f"model_v{i}_{j}",
                        json.dumps({"hidden_layers": [64, 32], "epochs": total_epochs}),
                        selected_labels,
                        status,
                        current_epoch,
                        total_epochs,
                        random.uniform(0.1, 0.5) if status != "PENDING" else None,
                        random.uniform(0.15, 0.6) if status != "PENDING" else None,
                        random.uniform(0.7, 0.98) if status != "PENDING" else None,
                        random.uniform(0.65, 0.95) if status != "PENDING" else None,
                        created_at,
                        started_at,
                        completed_at,
                        model_id if status == "COMPLETED" else None,
                        "训练过程中内存不足" if status == "FAILED" else None
                    )
                )
                job_ids.append(job_id)
                logger.info(f"  创建训练任务: {status}")
    
    conn.commit()
    return job_ids


def seed_training_progress(conn: psycopg.Connection, job_ids: list[str]) -> None:
    """填充训练进度"""
    logger.info("填充训练进度...")
    
    with conn.cursor() as cur:
        for job_id in job_ids[:5]:  # 只为前 5 个任务填充进度
            # 获取任务信息
            cur.execute(
                "SELECT total_epochs, status, started_at FROM training_jobs WHERE id = %s",
                (job_id,)
            )
            row = cur.fetchone()
            if not row or row[1] == "PENDING":
                continue
            
            total_epochs, status, started_at = row
            epochs_to_generate = min(total_epochs, 50)  # 最多生成 50 个 epoch 的进度
            
            for epoch in range(epochs_to_generate):
                ts = started_at + timedelta(minutes=epoch * 2)
                train_loss = 0.8 * (0.9 ** epoch) + random.uniform(0, 0.05)
                val_loss = 0.85 * (0.9 ** epoch) + random.uniform(0, 0.08)
                train_acc = min(0.99, 0.5 + 0.4 * (1 - 0.9 ** epoch) + random.uniform(0, 0.02))
                val_acc = min(0.95, 0.45 + 0.4 * (1 - 0.9 ** epoch) + random.uniform(0, 0.03))
                
                cur.execute(
                    """
                    INSERT INTO training_progress 
                    (job_id, ts, epoch, train_loss, val_loss, train_accuracy, val_accuracy)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (job_id, ts, epoch, train_loss, val_loss, train_acc, val_acc)
                )
    
    conn.commit()
    logger.info("训练进度填充完成")


def seed_inference_history(conn: psycopg.Connection, model_ids: list[str]) -> None:
    """填充推理历史"""
    logger.info("填充推理历史...")
    
    class_labels = ["苹果汁", "橙汁", "葡萄汁", "蒸馏水", "红酒", "白酒", "咖啡"]
    
    with conn.cursor() as cur:
        for model_id in model_ids:
            # 每个模型 20-50 次推理记录
            for _ in range(random.randint(20, 50)):
                ts = datetime.now() - timedelta(hours=random.randint(1, 168))
                sample_count = random.randint(10, 100)
                
                # 生成预测结果
                predictions = []
                confidence_scores = []
                for _ in range(random.randint(1, 5)):
                    label = random.choice(class_labels)
                    confidence = random.uniform(0.6, 0.99)
                    predictions.append({"label": label, "confidence": confidence})
                    confidence_scores.append(confidence)
                
                cur.execute(
                    """
                    INSERT INTO inference_history 
                    (ts, model_id, experiment_id, input_sample_count, 
                     predictions, confidence_scores, inference_time_ms)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        ts,
                        model_id,
                        f"test_exp_{90000 + random.randint(0, 800)}",
                        sample_count,
                        json.dumps(predictions),
                        confidence_scores,
                        random.randint(10, 500)
                    )
                )
    
    conn.commit()
    logger.info("推理历史填充完成")


def seed_quality_daily_stats(conn: psycopg.Connection, days: int = 30) -> None:
    """填充质量每日统计"""
    logger.info(f"填充质量每日统计 ({days} 天)...")
    
    with conn.cursor() as cur:
        for day_offset in range(days):
            date = (datetime.now() - timedelta(days=day_offset)).date()
            
            # 生成 1-3 个实验的统计
            for exp_idx in range(random.randint(1, 3)):
                experiment_id = f"test_exp_{90000 + day_offset * 10 + exp_idx}"
                
                total = random.randint(50, 200)
                critical = random.randint(0, 5)
                warning = random.randint(5, 30)
                info = total - critical - warning
                
                alerts_by_type = {
                    "BASELINE_UNSTABLE": random.randint(0, 10),
                    "SENSOR_DRIFT": random.randint(0, 8),
                    "HIGH_NOISE": random.randint(0, 15),
                    "OUT_OF_RANGE": random.randint(0, 3),
                }
                
                cur.execute(
                    """
                    INSERT INTO quality_daily_stats 
                    (date, experiment_id, total_alerts, critical_alerts, 
                     warning_alerts, info_alerts, alerts_by_type)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (date, experiment_id) DO UPDATE SET
                        total_alerts = EXCLUDED.total_alerts,
                        critical_alerts = EXCLUDED.critical_alerts,
                        warning_alerts = EXCLUDED.warning_alerts,
                        info_alerts = EXCLUDED.info_alerts,
                        alerts_by_type = EXCLUDED.alerts_by_type
                    """,
                    (date, experiment_id, total, critical, warning, info, json.dumps(alerts_by_type))
                )
    
    conn.commit()
    logger.info("质量每日统计填充完成")


# ============================================================================
# ML 标签生成 (新标签系统)
# ============================================================================
def seed_ml_sample_labels(
    conn: psycopg.Connection,
    sample_ids: list[int]
) -> int:
    """为 seed 的 samples 生成 ML 标签 (调用 LabelGenerator)"""
    logger.info(f"生成 ML 标签 ({len(sample_ids)} 个样本)...")
    
    try:
        from ml.label_generator import LabelGenerator
        generator = LabelGenerator()
        
        # 获取 seed samples 所在的 run_ids
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT run_id FROM samples WHERE run_id >= 90000 AND run_id < 100000"
            )
            run_ids = [r[0] for r in cur.fetchall()]
        
        if not run_ids:
            logger.warning("  没有找到 seed runs，跳过 ML 标签生成")
            return 0
        
        results = generator.generate_for_all_configs(run_ids=run_ids)
        total = sum(results.values())
        for config_name, count in results.items():
            if count > 0:
                logger.info(f"  {config_name}: {count} 个标签")
        logger.info(f"  ML 标签生成完成: 共 {total} 个")
        return total
    except Exception as e:
        logger.warning(f"  ML 标签生成失败 (可能 ml_label_configs 表未初始化): {e}")
        logger.info("  尝试直接 SQL 方式生成基础标签...")
        return _seed_ml_labels_sql(conn, sample_ids)


def _seed_ml_labels_sql(
    conn: psycopg.Connection,
    sample_ids: list[int]
) -> int:
    """回退方案：直接用 SQL 为 seed samples 生成 ML 标签"""
    total = 0
    with conn.cursor() as cur:
        # 获取 ml_label_configs
        cur.execute("SELECT id, name, label_type FROM ml_label_configs WHERE is_active = TRUE")
        configs = cur.fetchall()
        if not configs:
            logger.warning("  ml_label_configs 表为空，跳过")
            return 0
        
        config_map = {r[1]: (r[0], r[2]) for r in configs}
        
        for sample_id in sample_ids:
            cur.execute(
                """SELECT liquid_names, liquid_ratios, liquid_ids, total_volume_ml,
                          gas_pump_pwm, params_hash, avg_temperature_c
                   FROM samples WHERE id = %s""",
                (sample_id,)
            )
            row = cur.fetchone()
            if not row:
                continue
            
            liquid_names, liquid_ratios, liquid_ids, total_vol, pwm, params_hash, avg_temp = row
            if not liquid_names:
                continue
            
            labels_to_insert = []
            
            # liquid_identity: 单液体→名称, 混合→按比例降序拼接
            if "liquid_identity" in config_map:
                cfg_id, _ = config_map["liquid_identity"]
                if len(liquid_names) == 1:
                    label_str = liquid_names[0]
                else:
                    paired = sorted(zip(liquid_ratios, liquid_names), reverse=True)
                    label_str = " + ".join(f"{n}({int(r*100)}%)" for r, n in paired)
                labels_to_insert.append((sample_id, cfg_id, label_str, None, None))
            
            # primary_liquid: 占比最大的液体
            if "primary_liquid" in config_map:
                cfg_id, _ = config_map["primary_liquid"]
                max_idx = liquid_ratios.index(max(liquid_ratios))
                labels_to_insert.append((sample_id, cfg_id, liquid_names[max_idx], None, None))
            
            # mixture_formula: ID:ratio 排序拼接
            if "mixture_formula" in config_map and liquid_ids:
                cfg_id, _ = config_map["mixture_formula"]
                paired = sorted(zip(liquid_ids, liquid_ratios))
                formula = "|".join(f"{lid}:{r:.2f}" for lid, r in paired)
                labels_to_insert.append((sample_id, cfg_id, formula, None, None))
            
            # total_volume: 进样量
            if "total_volume" in config_map and total_vol is not None:
                cfg_id, _ = config_map["total_volume"]
                labels_to_insert.append((sample_id, cfg_id, None, float(total_vol), None))
            
            # gas_pump_speed: PWM / 100
            if "gas_pump_speed" in config_map and pwm is not None:
                cfg_id, _ = config_map["gas_pump_speed"]
                labels_to_insert.append((sample_id, cfg_id, None, float(pwm) / 100.0, None))
            
            # params_group: params_hash
            if "params_group" in config_map and params_hash:
                cfg_id, _ = config_map["params_group"]
                labels_to_insert.append((sample_id, cfg_id, params_hash, None, None))
            
            # env_temperature
            if "env_temperature" in config_map and avg_temp is not None:
                cfg_id, _ = config_map["env_temperature"]
                labels_to_insert.append((sample_id, cfg_id, None, float(avg_temp), None))
            
            for sid, cid, lstr, lnum, ljson in labels_to_insert:
                try:
                    cur.execute(
                        """
                        INSERT INTO sample_ml_labels (sample_id, config_id, label_str, label_num, label_json)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (sample_id, config_id) DO UPDATE SET
                            label_str = EXCLUDED.label_str,
                            label_num = EXCLUDED.label_num
                        """,
                        (sid, cid, lstr, lnum, ljson)
                    )
                    total += 1
                except Exception as e:
                    logger.warning(f"  跳过 ML label {sid}/{cid}: {e}")
        
        # 为分类标签分配 label_index
        for config_name, (cfg_id, label_type) in config_map.items():
            if label_type == "classification":
                cur.execute(
                    """
                    WITH ranked AS (
                        SELECT DISTINCT label_str, 
                               ROW_NUMBER() OVER (ORDER BY label_str) - 1 AS idx
                        FROM sample_ml_labels
                        WHERE config_id = %s AND label_str IS NOT NULL
                    )
                    UPDATE sample_ml_labels sml
                    SET label_index = ranked.idx
                    FROM ranked
                    WHERE sml.config_id = %s AND sml.label_str = ranked.label_str
                    """,
                    (cfg_id, cfg_id)
                )
    
    conn.commit()
    logger.info(f"  SQL 方式生成 ML 标签: {total} 个")
    return total


# ============================================================================
# 主函数
# ============================================================================
def main():
    parser = argparse.ArgumentParser(description="分析服务测试数据填充")
    parser.add_argument("--no-clean", action="store_true", help="不清除之前的seed数据（默认会清除）")
    parser.add_argument("--days", type=int, default=7, help="生成多少天的数据 (默认 7)")
    parser.add_argument("--runs-per-day", type=int, default=3, help="每天生成多少运行 (默认 3)")
    parser.add_argument("--samples-per-run", type=int, default=5, help="每运行生成多少样本 (默认 5)")
    args = parser.parse_args()
    
    dsn = get_db_dsn()
    logger.info(f"连接数据库: {dsn.split('@')[1]}")
    
    try:
        with psycopg.connect(dsn) as conn:
            if not args.no_clean:
                clean_test_data(conn)
            
            # 1. runs + samples + sensor_readings_v2
            run_ids, sample_ids = seed_runs_and_samples(
                conn, 
                days=args.days, 
                runs_per_day=args.runs_per_day,
                samples_per_run=args.samples_per_run
            )
            
            # 2. sample_phase_transitions
            seed_sample_phase_transitions(conn, sample_ids)
            
            # 3. ML 标签 (新系统: sample_ml_labels)
            ml_label_count = seed_ml_sample_labels(conn, sample_ids)
            
            # 4. 旧标签系统 (sample_labels + labeled_ranges)
            label_ids = seed_sample_labels(conn)
            seed_labeled_ranges(conn, label_ids, run_ids)
            
            # 5. ML 模型
            model_ids = seed_ml_models(conn, label_ids)
            
            # 6. 质检结果
            seed_quality_results(conn, days=args.days)
            
            # 7. 训练任务
            job_ids = seed_training_jobs(conn, model_ids, label_ids)
            
            # 8. 训练进度
            seed_training_progress(conn, job_ids)
            
            # 9. 推理历史
            seed_inference_history(conn, model_ids)
            
            # 10. 质量每日统计
            seed_quality_daily_stats(conn, days=30)
            
            logger.info("=" * 50)
            logger.info("测试数据填充完成!")
            logger.info(f"  - 运行 (runs): {len(run_ids)}")
            logger.info(f"  - 样本 (samples): {len(sample_ids)}")
            logger.info(f"  - ML 标签: {ml_label_count}")
            logger.info(f"  - 旧标签: {len(label_ids)}")
            logger.info(f"  - ML 模型: {len(model_ids)}")
            logger.info(f"  - 训练任务: {len(job_ids)}")
            logger.info("=" * 50)
            
    except Exception as e:
        logger.error(f"数据库操作失败: {e}")
        raise


if __name__ == "__main__":
    main()
