#!/usr/bin/env python3
"""
一次性脚本：检查传感器数据采集情况
连接 TimescaleDB 数据库，分析最近的实验数据
"""

import psycopg2
from datetime import datetime, timedelta
import json

# 数据库连接配置
DB_CONFIG = {
    "host": "192.168.1.235",
    "port": 5432,
    "database": "enose",
    "user": "enose",
    "password": "enose_secure_password_change_me",
}


def connect_db():
    """连接数据库"""
    return psycopg2.connect(**DB_CONFIG)


def list_all_tables(conn):
    """列出所有表"""
    print("\n" + "=" * 60)
    print("数据库中的所有表")
    print("=" * 60)
    
    with conn.cursor() as cur:
        cur.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        """)
        tables = cur.fetchall()
        for t in tables:
            print(f"  - {t[0]}")
        return [t[0] for t in tables]


def check_recent_runs(conn, real_only=True):
    """检查最近的实验运行记录
    
    Args:
        real_only: 只显示真实数据 (run_id < 90000)，排除 seed 假数据
    """
    print("\n" + "=" * 60)
    print("最近的实验运行记录 (runs)")
    if real_only:
        print(">>> 只显示真实数据 (run_id < 90000)")
    print("=" * 60)
    
    with conn.cursor() as cur:
        # 先检查表是否存在
        cur.execute("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('runs', 'experiment_runs')
        """)
        tables = [t[0] for t in cur.fetchall()]
        
        if not tables:
            print("没有找到运行记录表")
            return None
            
        table_name = tables[0]
        print(f"使用表: {table_name}")
        
        # 获取表结构
        cur.execute(f"""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = '{table_name}'
        """)
        columns = [c[0] for c in cur.fetchall()]
        print(f"列: {columns}")
        
        # 查询数据 - 过滤假数据
        where_clause = "WHERE id < 90000" if real_only else ""
        cur.execute(f"""
            SELECT * FROM {table_name}
            {where_clause}
            ORDER BY id DESC
            LIMIT 10
        """)
        rows = cur.fetchall()
        
        if not rows:
            print("没有找到真实实验运行记录")
            return None
            
        print(f"\n找到 {len(rows)} 条记录:")
        for row in rows:
            run_id = row[0]
            created_at = row[1]
            state = row[3] if len(row) > 3 else 'N/A'
            program_name = row[15] if len(row) > 15 else 'N/A'
            print(f"\n  Run ID: {run_id}")
            print(f"    创建时间: {created_at}")
            print(f"    状态: {state}")
            print(f"    程序名: {program_name}")
            
        return rows[0][0]  # 返回最新的 run_id


def check_samples(conn, run_id):
    """检查样本记录"""
    print("\n" + "=" * 60)
    print(f"样本记录 (samples) - Run ID: {run_id}")
    print("=" * 60)
    
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, sample_idx, phase_name, liquid_names, liquid_ratios,
                   total_volume_ml, flow_rate_ml_s, gas_pump_pwm,
                   start_time_ms, end_time_ms
            FROM samples
            WHERE run_id = %s
            ORDER BY sample_idx
        """, (run_id,))
        rows = cur.fetchall()
        
        if not rows:
            print("没有找到样本记录")
            return []
            
        sample_ids = []
        for row in rows:
            sample_ids.append(row[0])
            print(f"\nSample ID: {row[0]} (idx: {row[1]})")
            print(f"  阶段: {row[2]}")
            print(f"  液体: {row[3]}, 比例: {row[4]}")
            print(f"  体积: {row[5]} ml, 流速: {row[6]} ml/s")
            print(f"  气泵PWM: {row[7]}%")
            print(f"  时间: {row[8]} ~ {row[9]}")
            
        return sample_ids


def check_sensor_readings(conn, run_id=None, sample_id=None, limit=20, real_only=True):
    """检查传感器读数
    
    Args:
        real_only: 只显示真实数据 (run_id < 90000)
    """
    print("\n" + "=" * 60)
    print(f"传感器读数")
    if real_only:
        print(">>> 只显示真实数据 (run_id < 90000)")
    print("=" * 60)
    
    with conn.cursor() as cur:
        # 检查使用哪个表
        cur.execute("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('sensor_readings', 'sensor_readings_v2')
        """)
        tables = [t[0] for t in cur.fetchall()]
        table_name = "sensor_readings_v2" if "sensor_readings_v2" in tables else "sensor_readings"
        print(f"使用表: {table_name}")
        
        # 获取表结构
        cur.execute(f"""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = '{table_name}'
            ORDER BY ordinal_position
        """)
        columns = [c[0] for c in cur.fetchall()]
        print(f"列: {columns}")
        
        # 构建查询条件
        where_clauses = []
        params = []
        
        # 过滤假数据
        if real_only and 'run_id' in columns:
            where_clauses.append("(run_id IS NULL OR run_id < 90000)")
        
        if run_id and 'run_id' in columns:
            where_clauses.append("run_id = %s")
            params.append(run_id)
        if sample_id and 'sample_id' in columns:
            where_clauses.append("sample_id = %s")
            params.append(sample_id)
            
        where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"
        
        # 确定时间列名
        time_col = 'time' if 'time' in columns else 'timestamp' if 'timestamp' in columns else columns[0]
        
        # 统计总数
        cur.execute(f"""
            SELECT COUNT(*), MIN({time_col}), MAX({time_col})
            FROM {table_name}
            WHERE {where_sql}
        """, params)
        count, min_time, max_time = cur.fetchone()
        
        print(f"\n总记录数: {count}")
        print(f"时间范围: {min_time} ~ {max_time}")
        
        if count == 0:
            return
            
        # 查询最新数据
        cur.execute(f"""
            SELECT * FROM {table_name}
            WHERE {where_sql}
            ORDER BY {time_col} DESC
            LIMIT {limit}
        """, params)
        rows = cur.fetchall()
        
        print(f"\n最新 {len(rows)} 条记录:")
        print("-" * 150)
        # 打印列名
        header = " | ".join([f"{c[:12]:<12}" for c in columns[:10]])
        print(header)
        print("-" * 150)
        
        for row in rows:
            row_str = " | ".join([f"{str(v)[:12]:<12}" for v in row[:10]])
            print(row_str)
        
        # 如果有 sensor_index 列，统计各传感器的数据分布
        if 'sensor_index' in columns:
            resistance_col = 'resistance_ohm' if 'resistance_ohm' in columns else 'resistance' if 'resistance' in columns else None
            if resistance_col:
                cur.execute(f"""
                    SELECT sensor_index, COUNT(*), AVG({resistance_col}), MIN({resistance_col}), MAX({resistance_col})
                    FROM {table_name}
                    WHERE {where_sql}
                    GROUP BY sensor_index
                    ORDER BY sensor_index
                """, params)
                stats = cur.fetchall()
                
                print(f"\n各传感器统计:")
                print("-" * 70)
                print(f"{'传感器':<10} {'记录数':<12} {'平均R(Ω)':<15} {'最小R(Ω)':<15} {'最大R(Ω)':<15}")
                print("-" * 70)
                for stat in stats:
                    print(f"{stat[0]:<10} {stat[1]:<12} {stat[2]:<15.1f} {stat[3]:<15.1f} {stat[4]:<15.1f}")


def check_heater_steps(conn, run_id=None):
    """检查加热器步骤分布"""
    print("\n" + "=" * 60)
    print("加热器步骤分布")
    print("=" * 60)
    
    with conn.cursor() as cur:
        # 检查使用哪个表
        cur.execute("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('sensor_readings', 'sensor_readings_v2')
        """)
        tables = [t[0] for t in cur.fetchall()]
        table_name = "sensor_readings_v2" if "sensor_readings_v2" in tables else "sensor_readings"
        
        # 获取表结构
        cur.execute(f"""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = '{table_name}'
        """)
        columns = [c[0] for c in cur.fetchall()]
        
        if 'heater_step' not in columns:
            print("表中没有 heater_step 列")
            return
            
        where_sql = f"run_id = {run_id}" if run_id and 'run_id' in columns else "1=1"
        
        resistance_col = 'resistance_ohm' if 'resistance_ohm' in columns else 'value' if 'value' in columns else 'resistance'
        temp_col = 'temperature_c' if 'temperature_c' in columns else 'temperature'
        
        cur.execute(f"""
            SELECT heater_step, COUNT(*), 
                   AVG({resistance_col}), AVG({temp_col})
            FROM {table_name}
            WHERE {where_sql}
            GROUP BY heater_step
            ORDER BY heater_step
        """)
        rows = cur.fetchall()
        
        if not rows:
            print("没有数据")
            return
            
        print(f"{'步骤':<8} {'记录数':<12} {'平均R(Ω)':<15} {'平均T(°C)':<12}")
        print("-" * 50)
        for row in rows:
            r_val = row[2] if row[2] else 0
            t_val = row[3] if row[3] else 0
            print(f"{row[0]:<8} {row[1]:<12} {r_val:<15.1f} {t_val:<12.2f}")


def check_table_schema(conn, table_name):
    """检查表结构"""
    print(f"\n表结构: {table_name}")
    print("-" * 40)
    
    with conn.cursor() as cur:
        cur.execute("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = %s
            ORDER BY ordinal_position
        """, (table_name,))
        
        for row in cur.fetchall():
            print(f"  {row[0]:<25} {row[1]:<20} {'NULL' if row[2] == 'YES' else 'NOT NULL'}")


def check_recent_sensor_data_any(conn, limit=50):
    """检查最近的传感器数据（不管 run_id）"""
    print("\n" + "=" * 60)
    print("最近的传感器数据（所有数据，包括未关联 run_id 的）")
    print("=" * 60)
    
    with conn.cursor() as cur:
        # 统计各 run_id 的数据量
        cur.execute("""
            SELECT run_id, COUNT(*), MIN(time_ms), MAX(time_ms)
            FROM sensor_readings_v2
            GROUP BY run_id
            ORDER BY MAX(time_ms) DESC
            LIMIT 20
        """)
        rows = cur.fetchall()
        
        print(f"\n按 run_id 分组统计:")
        print("-" * 80)
        print(f"{'run_id':<12} {'记录数':<12} {'最早时间 (ms)':<20} {'最晚时间 (ms)':<20}")
        print("-" * 80)
        for row in rows:
            run_id = row[0] if row[0] else "NULL"
            is_fake = "(假数据)" if row[0] and row[0] >= 90000 else "(真实)" if row[0] else "(未关联)"
            print(f"{str(run_id):<12} {row[1]:<12} {row[2]:<20} {row[3]:<20} {is_fake}")
        
        # 查询最近的记录（按时间排序）
        cur.execute(f"""
            SELECT time_ms, sensor_idx, value, temperature, humidity, heater_step, run_id, sample_id
            FROM sensor_readings_v2
            ORDER BY time_ms DESC
            LIMIT {limit}
        """)
        rows = cur.fetchall()
        
        if rows:
            print(f"\n最近 {len(rows)} 条记录（按时间）:")
            print("-" * 120)
            print(f"{'time_ms':<18} {'sensor':<8} {'value':<15} {'temp':<10} {'humidity':<10} {'step':<6} {'run_id':<10} {'sample':<10}")
            print("-" * 120)
            for row in rows[:20]:
                run_id = row[6] if row[6] else "NULL"
                sample = row[7] if row[7] else "NULL"
                print(f"{row[0]:<18} {row[1]:<8} {row[2]:<15.1f} {row[3]:<10.2f} {row[4]:<10.2f} {row[5]:<6} {str(run_id):<10} {str(sample):<10}")
        else:
            print("\n没有传感器数据")


def check_run_data_compliance(conn, run_id, verbose=True):
    """检查 run 数据是否符合实验中心和分析服务需求
    
    检查项:
    1. 传感器数据数量和完整性
    2. 样本记录 (samples)
    3. 阶段标记 (phase_name)
    4. 加热配置 (heater_profiles)
    5. 数据时间范围合理性
    """
    if verbose:
        print(f"\n  --- 合规性检查 (run_id={run_id}) ---")
    issues = []
    warnings = []
    
    with conn.cursor() as cur:
        # 1. 检查是否有传感器数据
        cur.execute("SELECT COUNT(*) FROM sensor_readings_v2 WHERE run_id = %s", (run_id,))
        sensor_count = cur.fetchone()[0]
        if sensor_count == 0:
            issues.append("[ERROR] 没有传感器数据关联到此 run")
        else:
            if verbose:
                print(f"  [OK] 传感器数据: {sensor_count} 条")
        
        # 2. 检查传感器数据字段完整性
        if sensor_count > 0:
            cur.execute("""
                SELECT 
                    COUNT(*) FILTER (WHERE temperature IS NOT NULL) as temp_count,
                    COUNT(*) FILTER (WHERE humidity IS NOT NULL) as hum_count,
                    COUNT(*) FILTER (WHERE heater_step IS NOT NULL) as step_count,
                    COUNT(DISTINCT sensor_idx) as sensor_count,
                    MIN(time_ms) as min_time,
                    MAX(time_ms) as max_time,
                    AVG(value) as avg_value
                FROM sensor_readings_v2 WHERE run_id = %s
            """, (run_id,))
            row = cur.fetchone()
            temp_count, hum_count, step_count, num_sensors, min_time, max_time, avg_value = row
            
            if temp_count > 0:
                if verbose:
                    print(f"  [OK] 温度数据: {temp_count} 条")
            else:
                warnings.append("[WARN] 没有温度数据")
            
            if hum_count > 0:
                if verbose:
                    print(f"  [OK] 湿度数据: {hum_count} 条")
            else:
                warnings.append("[WARN] 没有湿度数据")
            
            if step_count > 0:
                if verbose:
                    print(f"  [OK] 加热步骤数据: {step_count} 条")
            else:
                warnings.append("[WARN] 没有加热步骤数据 (heater_step)")
            
            if verbose:
                print(f"  [OK] 传感器数量: {num_sensors} 个")
                duration_s = (max_time - min_time) / 1000 if max_time and min_time else 0
                print(f"  [INFO] 数据时间跨度: {duration_s:.1f} 秒")
                print(f"  [INFO] 平均阻值: {avg_value:.1f} Ω")
            
            # 检查每个传感器的数据分布
            cur.execute("""
                SELECT sensor_idx, COUNT(*), AVG(value), MIN(value), MAX(value)
                FROM sensor_readings_v2 
                WHERE run_id = %s
                GROUP BY sensor_idx
                ORDER BY sensor_idx
            """, (run_id,))
            sensor_stats = cur.fetchall()
            if verbose and sensor_stats:
                print(f"  传感器数据分布:")
                for stat in sensor_stats:
                    print(f"    sensor[{stat[0]}]: {stat[1]} 条, avg={stat[2]:.1f}Ω, range=[{stat[3]:.1f}, {stat[4]:.1f}]")
        
        # 3. 检查是否有 samples（分析服务需要）
        cur.execute("""
            SELECT id, sample_idx, phase_name, start_time_ms, end_time_ms, gas_pump_pwm
            FROM samples WHERE run_id = %s
            ORDER BY sample_idx
        """, (run_id,))
        samples = cur.fetchall()
        sample_count = len(samples)
        if sample_count == 0:
            warnings.append("[WARN] 没有 samples 记录（分析服务需要样本划分）")
        else:
            if verbose:
                print(f"  [OK] 样本数: {sample_count} 条")
                for s in samples:
                    sid, idx, phase, start_ms, end_ms, pwm = s
                    duration = (end_ms - start_ms) / 1000 if end_ms and start_ms else 0
                    print(f"    sample[{idx}]: id={sid}, phase={phase}, duration={duration:.1f}s, pwm={pwm}%")
        
        # 4. 检查 phase_name 是否填充（在 sensor_readings_v2 中）
        if sensor_count > 0:
            cur.execute("""
                SELECT phase_name, COUNT(*) 
                FROM sensor_readings_v2 
                WHERE run_id = %s
                GROUP BY phase_name
                ORDER BY COUNT(*) DESC
            """, (run_id,))
            phases = cur.fetchall()
            has_phase = any(p[0] for p in phases)
            if has_phase:
                if verbose:
                    print(f"  [OK] 阶段分布:")
                    for p in phases:
                        phase_name = p[0] if p[0] else "(未标记)"
                        print(f"    {phase_name}: {p[1]} 条")
            else:
                warnings.append("[WARN] 传感器数据没有阶段标记（phase_name 全为空）")
        
        # 5. 检查 sample_id 关联
        if sensor_count > 0:
            cur.execute("""
                SELECT COUNT(*) FILTER (WHERE sample_id IS NOT NULL),
                       COUNT(DISTINCT sample_id) FILTER (WHERE sample_id IS NOT NULL)
                FROM sensor_readings_v2 WHERE run_id = %s
            """, (run_id,))
            sample_linked = cur.fetchone()
            if sample_linked[0] > 0:
                if verbose:
                    print(f"  [OK] 传感器数据关联样本: {sample_linked[0]} 条, {sample_linked[1]} 个样本")
            else:
                warnings.append("[WARN] 传感器数据未关联到 sample_id（可视化需要）")
        
        # 6. 检查 heater_profiles（实验中心页面可能需要）
        # 注意: heater_profiles 可能没有 run_id 列，先检查表结构
        try:
            cur.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'heater_profiles' AND column_name = 'run_id'
            """)
            has_run_id = cur.fetchone() is not None
            
            if has_run_id:
                cur.execute("""
                    SELECT COUNT(*) FROM heater_profiles WHERE run_id = %s
                """, (run_id,))
                heater_count = cur.fetchone()[0]
                if heater_count > 0:
                    if verbose:
                        print(f"  [OK] 加热配置记录: {heater_count} 条")
                else:
                    if verbose:
                        print(f"  [INFO] 没有 heater_profiles 记录（可选）")
            else:
                if verbose:
                    print(f"  [INFO] heater_profiles 表无 run_id 列（跳过检查）")
        except Exception:
            if verbose:
                print(f"  [INFO] heater_profiles 表检查失败（可选）")
    
    # 输出问题汇总
    if issues:
        print("  ❌ 严重问题:")
        for issue in issues:
            print(f"    {issue}")
    if warnings:
        print("  ⚠️  警告:")
        for w in warnings:
            print(f"    {w}")
    
    if not issues and not warnings:
        print("  ✅ 数据完整，符合实验中心和分析服务需求")
    elif not issues:
        print("  ⚠️  数据基本可用，但有警告项")
    
    return len(issues) == 0


def check_latest_runs_detail(conn, limit=5):
    """检查最新的真实 runs 记录详情（优先显示真实数据）"""
    print("\n" + "=" * 60)
    print(f"最新 {limit} 条真实 runs 记录详情 (run_id < 90000)")
    print("=" * 60)
    
    with conn.cursor() as cur:
        # 优先查询真实数据
        cur.execute(f"""
            SELECT id, created_at, state, program_name, elapsed_s
            FROM runs
            WHERE id < 90000
            ORDER BY id DESC
            LIMIT {limit}
        """)
        rows = cur.fetchall()
        
        if not rows:
            print("\n没有真实的 runs 记录")
            return
        
        for row in rows:
            run_id, created_at, state, program_name, elapsed_s = row
            print(f"\n{'='*60}")
            print(f"Run ID: {run_id}")
            print(f"  创建时间: {created_at}")
            print(f"  状态: {state}")
            print(f"  程序名: {program_name}")
            print(f"  耗时: {elapsed_s}s")
            
            # 详细检查数据完整性和合规性
            check_run_data_compliance(conn, run_id)


def check_async_sensor_pattern(conn, run_id):
    """检查异步传感器数据模式
    
    验证: 同一 time_ms 是否只有部分传感器有数据
    这是导致前端锯齿的根本原因
    """
    print("\n" + "=" * 60)
    print(f"异步传感器数据模式分析 (run_id={run_id})")
    print("=" * 60)
    
    with conn.cursor() as cur:
        # 1. 统计每个 time_ms 有多少个不同的 sensor_idx
        cur.execute("""
            SELECT sensors_per_time, COUNT(*) as time_count
            FROM (
                SELECT time_ms, COUNT(DISTINCT sensor_idx) as sensors_per_time
                FROM sensor_readings_v2
                WHERE run_id = %s
                GROUP BY time_ms
            ) t
            GROUP BY sensors_per_time
            ORDER BY sensors_per_time
        """, (run_id,))
        rows = cur.fetchall()
        
        if not rows:
            print("没有数据")
            return
        
        print("\n每个时间步的传感器数量分布:")
        print("-" * 50)
        print(f"{'传感器数/时间步':<20} {'时间步数量':<15} {'占比'}")
        print("-" * 50)
        total_times = sum(r[1] for r in rows)
        for r in rows:
            pct = r[1] / total_times * 100
            print(f"{r[0]:<20} {r[1]:<15} {pct:.1f}%")
        
        print(f"\n总时间步数: {total_times}")
        
        # 2. 查看前20条原始数据，看看同一时间的传感器分布
        cur.execute("""
            SELECT time_ms, sensor_idx, value
            FROM sensor_readings_v2
            WHERE run_id = %s
            ORDER BY time_ms
            LIMIT 80
        """, (run_id,))
        rows = cur.fetchall()
        
        if rows:
            print("\n前80条原始记录 (time_ms, sensor_idx, value):")
            print("-" * 60)
            current_time = None
            for r in rows:
                if r[0] != current_time:
                    if current_time is not None:
                        print()  # 时间步分隔
                    current_time = r[0]
                    print(f"  time_ms={r[0]}:")
                print(f"    sensor[{r[1]}] = {r[2]:.1f}")
        
        # 3. 模拟 analytics 聚合：统计聚合后有多少零值
        cur.execute("""
            WITH time_sensor AS (
                SELECT time_ms, sensor_idx, value
                FROM sensor_readings_v2
                WHERE run_id = %s
            ),
            all_times AS (
                SELECT DISTINCT time_ms FROM time_sensor
            ),
            all_sensors AS (
                SELECT generate_series(0, 7) as sensor_idx
            ),
            full_grid AS (
                SELECT t.time_ms, s.sensor_idx
                FROM all_times t CROSS JOIN all_sensors s
            )
            SELECT 
                COUNT(*) as total_cells,
                COUNT(ts.value) as filled_cells,
                COUNT(*) - COUNT(ts.value) as missing_cells,
                ROUND(100.0 * (COUNT(*) - COUNT(ts.value)) / COUNT(*), 1) as missing_pct
            FROM full_grid fg
            LEFT JOIN time_sensor ts ON fg.time_ms = ts.time_ms AND fg.sensor_idx = ts.sensor_idx
        """, (run_id,))
        row = cur.fetchone()
        
        if row:
            print(f"\n聚合分析 (模拟 analytics 服务行为):")
            print(f"  总网格单元 (时间步×8传感器): {row[0]}")
            print(f"  有实际数据的单元: {row[1]}")
            print(f"  缺失单元 (会被填为0): {row[2]}")
            print(f"  缺失比例: {row[3]}%")
            
            if row[3] and float(row[3]) > 50:
                print(f"\n  ⚠️  超过 {row[3]}% 的数据点是零值填充！")
                print(f"  这就是锯齿的根本原因: analytics 服务按 time_ms 聚合时,")
                print(f"  同一时间只有1-2个传感器有数据, 其余被填为 0.0")


def main():
    print("=" * 60)
    print("传感器数据检查脚本")
    print(f"数据库: {DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['database']}")
    print("=" * 60)
    
    try:
        conn = connect_db()
        print("[OK] 数据库连接成功")
        
        # 检查最近的真实运行记录
        run_id = check_recent_runs(conn, real_only=True)
        
        if run_id:
            # 检查数据合规性
            check_run_data_compliance(conn, run_id)
            
            # 🔍 重点：检查异步传感器数据模式（锯齿根因分析）
            check_async_sensor_pattern(conn, run_id)
            
        conn.close()
        print("\n[OK] 检查完成")
        
    except Exception as e:
        print(f"\n[ERROR] 错误: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
