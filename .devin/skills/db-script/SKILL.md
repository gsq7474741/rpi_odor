---
name: db-script
description: 编写一次性 Python 脚本查询或修改远程 PostgreSQL/TimescaleDB 数据库
---

# 数据库脚本技能

用于在 `scripts/` 目录下创建一次性 Python 脚本，与远程 TimescaleDB 数据库交互（查询、诊断、数据修复等）。

## 连接配置

```python
import psycopg2
import psycopg2.extras

DB_CONFIG = {
    "host": "192.168.1.235",
    "port": 5432,
    "database": "enose",
    "user": "enose",
    "password": "enose_secure_password_change_me",
}

conn = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)
```

## 脚本模板

### 只读查询脚本

```python
"""诊断脚本：[描述]"""

import psycopg2
import psycopg2.extras

DB_CONFIG = {
    "host": "192.168.1.235",
    "port": 5432,
    "database": "enose",
    "user": "enose",
    "password": "enose_secure_password_change_me",
}

conn = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)

with conn.cursor() as cur:
    cur.execute("SELECT ... FROM ... WHERE ...")
    rows = cur.fetchall()

for row in rows:
    print(row)

conn.close()
```

### 数据修复脚本（带 dry-run）

修改数据的脚本**必须**支持 `--dry-run` 参数，先预览再执行：

```python
"""修复脚本：[描述]

用法：
  python scripts/fix_xxx.py --dry-run   # 预览
  python scripts/fix_xxx.py             # 执行
"""

import sys
import psycopg2
import psycopg2.extras

DRY_RUN = "--dry-run" in sys.argv

DB_CONFIG = {
    "host": "192.168.1.235",
    "port": 5432,
    "database": "enose",
    "user": "enose",
    "password": "enose_secure_password_change_me",
}

conn = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)

# ... 查询需要修复的数据 ...
# ... 逐条打印修改详情 ...
# ... 执行 UPDATE/DELETE (仅非 dry-run 时) ...

if DRY_RUN:
    conn.rollback()
    print("[DRY RUN] 预览完成，未实际修改")
else:
    conn.commit()
    print("✅ 修改已提交")

conn.close()
```

## 规范

1. **文件位置**：`scripts/` 目录下，命名格式：
   - 查询/诊断：`check_<描述>.py`
   - 数据修复：`fix_<描述>.py`

2. **依赖**：仅使用 `psycopg2`（已全局安装），无需额外依赖

3. **游标类型**：始终使用 `RealDictCursor`，返回 dict 而非 tuple，字段名即 key

4. **数据修复必须**：
   - 支持 `--dry-run`，默认不修改数据
   - 先 dry-run 确认影响范围，再实际执行
   - 打印每条修改的详情（修改前→修改后）
   - 最后打印汇总统计

5. **运行方式**：在项目根目录执行

   ```bash
   python scripts/check_xxx.py
   python scripts/fix_xxx.py --dry-run
   python scripts/fix_xxx.py
   ```

## 主要数据表

| 表 | 说明 | 关键字段 |
|----|------|---------|
| `runs` | 实验运行 | id, status, program_hash, created_at |
| `samples` | 样本记录 | id, run_id, sample_idx, phase_name, liquid_ids, liquid_names, liquid_ratios, liquid_is_solvent, pump_indices, total_volume_ml, params_hash, params_json |
| `sensor_readings_v2` | 传感器读数 | time_ms, sensor_idx, value, temperature, humidity, heater_step, run_id, sample_id |
| `liquids` | 液体定义 | id, name, type, metadata |
| `pump_assignments` | 泵绑定 | pump_index, liquid_id, initial_volume_ml, consumed_volume_ml |
| `consumables` | 耗材 | id, type, name, runtime_hours, max_runtime_hours |
| `sample_ml_labels` | ML标签 | sample_id, config_id, label_str, label_num, label_index |
| `ml_label_configs` | 标签策略 | id, name, label_type, is_active |
| `sample_phase_transitions` | Phase转换 | sample_id, phase_name, start_time_ms, end_time_ms, phase_order |
| `normalized_frames` | 归一化帧 | sample_id, sensor_idx, norm_time, value |

## 常用查询模式

### 按 run 查样本

```python
cur.execute("SELECT * FROM samples WHERE run_id = %s ORDER BY sample_idx", [run_id])
```

### 按样本查传感器数据

```python
cur.execute("""
    SELECT sensor_idx, time_ms, value, heater_step
    FROM sensor_readings_v2
    WHERE sample_id = %s
    ORDER BY time_ms
""", [sample_id])
```

### 液体配方解析

```python
# samples 表中液体字段是 PostgreSQL 数组，psycopg2 自动转为 Python list
s = cur.fetchone()
names = s["liquid_names"]   # ['茶A', '茶B']
ratios = s["liquid_ratios"] # [50.0, 50.0]
```
