#!/usr/bin/env python3
"""
分析服务测试数据填充脚本

填充以下表的假数据：
- runs: 实验运行记录
- samples: 样本记录 (含完整参数)
- sensor_readings_v2: 传感器读数 (用于可视化)
- sample_labels: 样品标签
- labeled_ranges: 标签范围
- ml_models: ML 模型
- quality_results: 质检结果
- training_jobs: 训练任务
- training_progress: 训练进度
- inference_history: 推理历史
- quality_daily_stats: 质量每日统计

用法:
    cd enose-analytics
    uv run python scripts/seed_test_data.py
    uv run python scripts/seed_test_data.py --clean  # 清除测试数据后重新填充
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
# 样品标签数据
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
    """根据样品标签生成 MOX 传感器基准值"""
    # 不同样品有不同的电阻特征
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


# ============================================================================
# 实验配置模板
# ============================================================================
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
    },
    {
        "name": "咖啡品质实验",
        "liquids": [
            {"id": "coffee", "name": "咖啡", "pump_index": 0},
        ],
        "gas_pump_pwm": 70,
        "volume_ml": 4.0,
        "flow_rate_ml_s": 0.4,
    },
]


def compute_params_hash(params: dict) -> str:
    """计算参数哈希 (16字符)"""
    json_str = json.dumps(params, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(json_str.encode()).hexdigest()[:16]


# ============================================================================
# 数据清理
# ============================================================================
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
    """填充 runs 和 samples 表，返回 (run_ids, sample_ids)"""
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
                # 选择一个实验配置
                config = random.choice(EXPERIMENT_CONFIGS)
                run_id = run_id_base + day_offset * 100 + run_idx
                run_start = day_start + timedelta(hours=random.randint(8, 18), minutes=random.randint(0, 59))
                
                # 创建 run 记录
                run_config = {
                    "name": config["name"],
                    "gas_pump_pwm": config["gas_pump_pwm"],
                    "volume_ml": config["volume_ml"],
                    "flow_rate_ml_s": config["flow_rate_ml_s"],
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
                
                # 创建每个样本
                sample_start_time = run_start
                for sample_idx in range(samples_per_run):
                    # 随机选择一种液体
                    liquid = random.choice(config["liquids"])
                    
                    # 构建样本参数
                    sample_params = {
                        "liquid_ids": [liquid["id"]],
                        "liquid_ratios": [1.0],
                        "total_volume_ml": config["volume_ml"],
                        "flow_rate_ml_s": config["flow_rate_ml_s"],
                        "gas_pump_pwm": config["gas_pump_pwm"],
                        "termination_type": "duration",
                        "termination_value": random.randint(20, 60),
                    }
                    params_hash = compute_params_hash(sample_params)
                    
                    sample_duration_s = int(sample_params["termination_value"])
                    sample_end_time = sample_start_time + timedelta(seconds=sample_duration_s)
                    start_time_ms = int(sample_start_time.timestamp() * 1000)
                    end_time_ms = int(sample_end_time.timestamp() * 1000)
                    
                    # 插入 sample 记录
                    try:
                        cur.execute(
                            """
                            INSERT INTO samples (
                                run_id, sample_idx, start_time_ms, end_time_ms, params_hash,
                                liquid_ids, liquid_names, liquid_ratios, pump_indices,
                                total_volume_ml, flow_rate_ml_s, gas_pump_pwm,
                                termination_type, termination_value, phase_name, params_json
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            RETURNING id
                            """,
                            (
                                run_id,
                                sample_idx,
                                start_time_ms,
                                end_time_ms,
                                params_hash,
                                [liquid["id"]],
                                [liquid["name"]],
                                [1.0],
                                [liquid["pump_index"]],
                                config["volume_ml"],
                                config["flow_rate_ml_s"],
                                config["gas_pump_pwm"],
                                "duration",
                                sample_params["termination_value"],
                                "SAMPLE",
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
                                    base_value = generate_mox_pattern(liquid["name"], sensor_idx)
                                    drift = (t_offset / (sample_duration_s * 2)) * base_value * 0.1
                                    value = generate_sensor_reading(base_value, drift=drift)
                                    temperature = 25 + random.uniform(-2, 2)
                                    humidity = 50 + random.uniform(-10, 10)
                                    
                                    sensor_data_batch.append((
                                        time_ms,
                                        t_offset * 500,  # device_tick_ms
                                        sensor_idx,
                                        sensor_idx,  # sensor_id
                                        0,  # sensor_type
                                        value,
                                        temperature,
                                        humidity,
                                        (t_offset // 2) % 10,  # heater_step
                                        run_id,
                                        "SAMPLE",
                                        sample_id,  # sample_id
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
                    
                    # 下一个样本的开始时间
                    sample_start_time = sample_end_time + timedelta(seconds=random.randint(5, 30))
        
        # 插入剩余传感器数据
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
# 主函数
# ============================================================================
def main():
    parser = argparse.ArgumentParser(description="分析服务测试数据填充")
    parser.add_argument("--clean", action="store_true", help="清除测试数据后重新填充")
    parser.add_argument("--days", type=int, default=7, help="生成多少天的数据 (默认 7)")
    parser.add_argument("--runs-per-day", type=int, default=3, help="每天生成多少运行 (默认 3)")
    parser.add_argument("--samples-per-run", type=int, default=5, help="每运行生成多少样本 (默认 5)")
    args = parser.parse_args()
    
    dsn = get_db_dsn()
    logger.info(f"连接数据库: {dsn.split('@')[1]}")
    
    try:
        with psycopg.connect(dsn) as conn:
            if args.clean:
                clean_test_data(conn)
            
            # 1. runs + samples + sensor_readings_v2
            run_ids, sample_ids = seed_runs_and_samples(
                conn, 
                days=args.days, 
                runs_per_day=args.runs_per_day,
                samples_per_run=args.samples_per_run
            )
            
            # 2. 样品标签
            label_ids = seed_sample_labels(conn)
            
            # 3. 标签范围 (基于 runs)
            seed_labeled_ranges(conn, label_ids, run_ids)
            
            # 4. ML 模型
            model_ids = seed_ml_models(conn, label_ids)
            
            # 5. 质检结果
            seed_quality_results(conn, days=args.days)
            
            # 6. 训练任务
            job_ids = seed_training_jobs(conn, model_ids, label_ids)
            
            # 7. 训练进度
            seed_training_progress(conn, job_ids)
            
            # 8. 推理历史
            seed_inference_history(conn, model_ids)
            
            # 9. 质量每日统计
            seed_quality_daily_stats(conn, days=30)
            
            logger.info("=" * 50)
            logger.info("测试数据填充完成!")
            logger.info(f"  - 运行 (runs): {len(run_ids)}")
            logger.info(f"  - 样本 (samples): {len(sample_ids)}")
            logger.info(f"  - 样品标签: {len(label_ids)}")
            logger.info(f"  - ML 模型: {len(model_ids)}")
            logger.info(f"  - 训练任务: {len(job_ids)}")
            logger.info("=" * 50)
            
    except Exception as e:
        logger.error(f"数据库操作失败: {e}")
        raise


if __name__ == "__main__":
    main()
