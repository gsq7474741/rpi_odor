-- ============================================================
-- 0005-sensor-v2.sql - 传感器数据 V2 + 加热配置
-- 来源: 06-sensor-v2.sql (已包含 heater_profiles)
-- ============================================================

-- 删除旧表 (如果存在)
DROP MATERIALIZED VIEW IF EXISTS sensor_stats_1m CASCADE;
DROP VIEW IF EXISTS recent_sensor_data CASCADE;
DROP TABLE IF EXISTS sensor_readings CASCADE;

-- ============================================================
-- 核心数据表: sensor_readings_v2
-- 每行一个传感器读数，支持异步到达
-- ============================================================
CREATE TABLE IF NOT EXISTS sensor_readings_v2 (
    -- 时间戳 (毫秒精度)
    time_ms         BIGINT NOT NULL,           -- 主机接收时间 (Unix 毫秒)
    device_tick_ms  BIGINT NOT NULL,           -- 设备原始 tick (毫秒)
    
    -- 传感器标识
    sensor_idx      SMALLINT NOT NULL,         -- 传感器索引 0-7
    sensor_id       INTEGER NOT NULL,          -- 传感器硬件 ID
    sensor_type     SMALLINT NOT NULL,         -- 0=mox_d, 1=mox_a, 2=pid
    
    -- 测量值
    value           DOUBLE PRECISION NOT NULL, -- 主读数 (电阻Ω/电压V/ppb)
    
    -- 环境数据 (可选, NULL 表示不支持)
    temperature     REAL,                      -- °C
    humidity        REAL,                      -- %RH
    pressure        REAL,                      -- hPa
    
    -- 加热器状态 (仅 mox_d 有效)
    heater_step     SMALLINT,                  -- 加热步骤 0-9
    
    -- 运行上下文 (用于关联实验)
    run_id          INTEGER,                   -- 关联实验运行 ID
    phase_name      TEXT,                      -- 阶段标记 (BASELINE, SAMPLE, etc.)
    
    -- 复合主键: 时间 + 传感器索引
    PRIMARY KEY (time_ms, sensor_idx)
);

-- 转为 TimescaleDB 超表
-- 使用毫秒时间戳作为分区键
SELECT create_hypertable('sensor_readings_v2', 'time_ms',
    chunk_time_interval => 3600000,  -- 1小时 = 3600000 毫秒
    if_not_exists => TRUE
);

-- 为整数时间戳 hypertable 设置自定义时间函数 (连续聚合必需)
CREATE OR REPLACE FUNCTION unix_now_ms() RETURNS BIGINT AS $$
    SELECT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
$$ LANGUAGE SQL STABLE;

-- set_integer_now_func 不支持 if_not_exists，使用 DO 块安全调用
DO $$
BEGIN
    PERFORM set_integer_now_func('sensor_readings_v2', 'unix_now_ms');
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'set_integer_now_func skipped: %', SQLERRM;
END $$;

-- ============================================================
-- 索引优化
-- ============================================================

-- 按 run_id 查询 (实验数据导出)
CREATE INDEX IF NOT EXISTS idx_sr2_run_id ON sensor_readings_v2(run_id, time_ms DESC)
    WHERE run_id IS NOT NULL;

-- 按 heater_step 查询 (ML 特征提取)
CREATE INDEX IF NOT EXISTS idx_sr2_heater ON sensor_readings_v2(run_id, sensor_idx, heater_step, time_ms DESC)
    WHERE heater_step IS NOT NULL;

-- 按 phase 查询 (阶段分析)
CREATE INDEX IF NOT EXISTS idx_sr2_phase ON sensor_readings_v2(run_id, phase_name, time_ms DESC)
    WHERE phase_name IS NOT NULL;

-- ============================================================
-- 压缩策略 (7天后压缩, 压缩率约 10:1)
-- ============================================================
ALTER TABLE sensor_readings_v2 SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'run_id, sensor_idx',
    timescaledb.compress_orderby = 'time_ms DESC'
);

SELECT add_compression_policy('sensor_readings_v2', 
    compress_after => BIGINT '604800000',  -- 7天 = 604800000 毫秒
    if_not_exists => TRUE
);

-- ============================================================
-- 保留策略: 禁止删除，永久保留
-- ============================================================
-- 注意: TimescaleDB 压缩是无损的，可以完全恢复原始数据
-- 压缩算法: Delta-of-delta (时间戳), Gorilla (浮点数), Dictionary (字符串)
-- 压缩率: ~90% (每月1.45亿条 -> ~1.5GB)
-- 影响: 压缩块查询需解压（批量查询性能好）；压缩后不可更新

-- ============================================================
-- 传感器元数据表
-- 存储传感器硬件信息
-- ============================================================
CREATE TABLE IF NOT EXISTS sensor_metadata (
    sensor_id       INTEGER PRIMARY KEY,
    sensor_idx      SMALLINT NOT NULL,
    device_id       TEXT NOT NULL DEFAULT 'default',
    sensor_type     SMALLINT NOT NULL,         -- 0=mox_d, 1=mox_a, 2=pid
    
    -- ADC 配置 (仅 mox_a)
    adc_vref        REAL,
    adc_sample_rate SMALLINT,
    adc_gain        SMALLINT,
    
    -- 元数据
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    notes           TEXT
);

-- ============================================================
-- 加热配置表: 存储加热曲线预设
-- ============================================================
CREATE TABLE IF NOT EXISTS heater_profiles (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,      -- 预设名称 (e.g., 'constant_320', 'temp_scan')
    description     TEXT,                      -- 描述
    
    -- 加热曲线 (10步)
    temps           SMALLINT[] NOT NULL,       -- 温度序列 (°C), 长度 1-10
    durs            SMALLINT[] NOT NULL,       -- 持续时间 (×140ms), 长度同 temps
    
    -- 预热配置
    preheat_mode    TEXT NOT NULL DEFAULT 'cycles',  -- 'cycles' 或 'duration'
    preheat_cycles  SMALLINT DEFAULT 3,        -- 预热周期数 (恒温模式)
    preheat_duration_s SMALLINT DEFAULT 60,    -- 预热时间秒 (温度扫描模式)
    
    -- 元数据
    is_builtin      BOOLEAN DEFAULT FALSE,     -- 是否内置预设
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    
    -- 约束: temps 和 durs 长度必须相等
    CONSTRAINT temps_durs_length CHECK (array_length(temps, 1) = array_length(durs, 1)),
    CONSTRAINT temps_length CHECK (array_length(temps, 1) BETWEEN 1 AND 10)
);

-- 插入内置预设
INSERT INTO heater_profiles (name, description, temps, durs, preheat_mode, preheat_cycles, preheat_duration_s, is_builtin) VALUES
    ('constant_320', '恒温 320°C - 稳定检测，需预热', 
     ARRAY[320,320,320,320,320,320,320,320,320,320]::SMALLINT[], 
     ARRAY[5,5,5,5,5,5,5,5,5,5]::SMALLINT[], 
     'cycles', 3, NULL, TRUE),
    ('temp_scan_100_350', '温度扫描 100-350°C - 温度调制，预热影响小', 
     ARRAY[100,150,200,250,300,350,320,280,240,200]::SMALLINT[], 
     ARRAY[3,3,3,3,3,3,3,3,3,3]::SMALLINT[], 
     'duration', NULL, 60, TRUE),
    ('pulse_fast', '脉冲式 - 快速响应', 
     ARRAY[320,100,320,100,320,100,320,100,320,100]::SMALLINT[], 
     ARRAY[2,1,2,1,2,1,2,1,2,1]::SMALLINT[], 
     'cycles', 2, NULL, TRUE),
    ('low_power', '低功耗 200°C - 长期监测', 
     ARRAY[200,200,200,200,200,200,200,200,200,200]::SMALLINT[], 
     ARRAY[10,10,10,10,10,10,10,10,10,10]::SMALLINT[], 
     'cycles', 5, NULL, TRUE)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 传感器加热配置分配记录表
-- 记录某个传感器在某段时间内使用的加热配置
-- ============================================================
CREATE TABLE IF NOT EXISTS sensor_heater_assignments (
    id              SERIAL PRIMARY KEY,
    
    -- 时间范围 (毫秒时间戳)
    start_time_ms   BIGINT NOT NULL,           -- 配置生效开始时间
    end_time_ms     BIGINT,                    -- 配置结束时间 (NULL=当前活跃)
    
    -- 传感器标识
    sensor_idx      SMALLINT NOT NULL,         -- 传感器索引 0-7
    
    -- 加热配置
    heater_profile_id INTEGER REFERENCES heater_profiles(id),
    
    -- 实际使用的配置 (快照，防止 profile 被修改后影响历史记录)
    temps_snapshot  SMALLINT[] NOT NULL,
    durs_snapshot   SMALLINT[] NOT NULL,
    
    -- 关联实验
    run_id          INTEGER,
    phase_name      TEXT,                      -- 阶段: PREHEAT, BASELINE, SAMPLE, etc.
    
    -- 元数据
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    notes           TEXT
);

-- 索引: 按时间范围查询某传感器的配置
CREATE INDEX IF NOT EXISTS idx_sha_sensor_time ON sensor_heater_assignments(sensor_idx, start_time_ms, end_time_ms);
CREATE INDEX IF NOT EXISTS idx_sha_run ON sensor_heater_assignments(run_id) WHERE run_id IS NOT NULL;

-- ============================================================
-- ML 特征提取: 按加热周期聚合视图
-- 用于在线训练和数据质量监控
-- ============================================================
-- 注意: TimescaleDB 连续聚合对整数时间戳有特殊要求
-- 已在上方通过 set_integer_now_func 设置
DO $$
BEGIN
    -- 尝试创建连续聚合，如果失败则跳过
    IF NOT EXISTS (
        SELECT 1 FROM timescaledb_information.continuous_aggregates 
        WHERE view_name = 'sensor_heater_cycles'
    ) THEN
        BEGIN
            EXECUTE '
            CREATE MATERIALIZED VIEW sensor_heater_cycles
            WITH (timescaledb.continuous) AS
            SELECT
                time_bucket(BIGINT ''30000'', time_ms) AS bucket_ms,
                run_id,
                sensor_idx,
                heater_step,
                COUNT(*) AS sample_count,
                AVG(value) AS mean_value,
                STDDEV(value) AS std_value,
                MIN(value) AS min_value,
                MAX(value) AS max_value,
                first(value, time_ms) AS first_value,
                last(value, time_ms) AS last_value,
                AVG(temperature) AS avg_temp,
                AVG(humidity) AS avg_humidity,
                AVG(pressure) AS avg_pressure
            FROM sensor_readings_v2
            WHERE heater_step IS NOT NULL
            GROUP BY bucket_ms, run_id, sensor_idx, heater_step
            WITH NO DATA';
            
            RAISE NOTICE 'Created continuous aggregate sensor_heater_cycles';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not create continuous aggregate: %', SQLERRM;
        END;
    ELSE
        RAISE NOTICE 'Continuous aggregate sensor_heater_cycles already exists';
    END IF;
END $$;

-- 连续聚合刷新策略 (仅当视图存在时执行)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM timescaledb_information.continuous_aggregates 
        WHERE view_name = 'sensor_heater_cycles'
    ) THEN
        PERFORM add_continuous_aggregate_policy('sensor_heater_cycles',
            start_offset => BIGINT '600000',
            end_offset => BIGINT '30000',
            schedule_interval => INTERVAL '30 seconds',
            if_not_exists => TRUE
        );
    END IF;
END $$;

-- ============================================================
-- 辅助函数: 毫秒时间戳转换
-- ============================================================

-- 毫秒 -> TIMESTAMPTZ
CREATE OR REPLACE FUNCTION ms_to_timestamp(ms BIGINT)
RETURNS TIMESTAMPTZ AS $$
    SELECT to_timestamp(ms / 1000.0);
$$ LANGUAGE SQL IMMUTABLE;

-- TIMESTAMPTZ -> 毫秒
CREATE OR REPLACE FUNCTION timestamp_to_ms(ts TIMESTAMPTZ)
RETURNS BIGINT AS $$
    SELECT (EXTRACT(EPOCH FROM ts) * 1000)::BIGINT;
$$ LANGUAGE SQL IMMUTABLE;

-- ============================================================
-- 核心视图: sensor_frames
-- 将8个传感器的单行数据聚合为一行帧数据
-- 用于可视化和 ML 训练
-- ============================================================
CREATE OR REPLACE VIEW sensor_frames AS
SELECT 
    ms_to_timestamp(time_ms) AS ts,
    time_ms AS seq,
    run_id::TEXT AS experiment_id,
    phase_name,
    ARRAY[
        MAX(CASE WHEN sensor_idx = 0 THEN value END),
        MAX(CASE WHEN sensor_idx = 1 THEN value END),
        MAX(CASE WHEN sensor_idx = 2 THEN value END),
        MAX(CASE WHEN sensor_idx = 3 THEN value END),
        MAX(CASE WHEN sensor_idx = 4 THEN value END),
        MAX(CASE WHEN sensor_idx = 5 THEN value END),
        MAX(CASE WHEN sensor_idx = 6 THEN value END),
        MAX(CASE WHEN sensor_idx = 7 THEN value END)
    ]::DOUBLE PRECISION[] AS mox_readings,
    AVG(temperature)::DOUBLE PRECISION AS temp_c,
    AVG(humidity)::DOUBLE PRECISION AS rh,
    AVG(pressure)::DOUBLE PRECISION AS pressure
FROM sensor_readings_v2
GROUP BY time_ms, run_id, phase_name
ORDER BY time_ms DESC;

COMMENT ON VIEW sensor_frames IS '传感器帧数据视图 - 聚合8个传感器读数为一行';

-- ============================================================
-- 便捷视图: 最近数据 (带可读时间)
-- ============================================================
CREATE OR REPLACE VIEW recent_sensor_readings AS
SELECT 
    ms_to_timestamp(time_ms) AS time,
    time_ms,
    device_tick_ms,
    sensor_idx,
    sensor_id,
    CASE sensor_type 
        WHEN 0 THEN 'mox_d'
        WHEN 1 THEN 'mox_a'
        WHEN 2 THEN 'pid'
        ELSE 'unknown'
    END AS sensor_type_name,
    value,
    temperature,
    humidity,
    pressure,
    heater_step,
    run_id,
    phase_name
FROM sensor_readings_v2
WHERE time_ms > (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT - 3600000  -- 最近1小时
ORDER BY time_ms DESC
LIMIT 1000;

-- ============================================================
-- 注释
-- ============================================================
COMMENT ON TABLE sensor_readings_v2 IS '传感器原始时序数据 V2 (8传感器, ~7Hz, 毫秒精度)';
COMMENT ON COLUMN sensor_readings_v2.time_ms IS '主机接收时间 (Unix 毫秒时间戳)';
COMMENT ON COLUMN sensor_readings_v2.device_tick_ms IS '设备固件 tick (毫秒, 相对于设备启动)';
COMMENT ON COLUMN sensor_readings_v2.sensor_type IS '传感器类型: 0=MOX_DIGITAL, 1=MOX_ANALOG, 2=PID';
COMMENT ON COLUMN sensor_readings_v2.heater_step IS '加热器步骤索引 (0-9), 仅 MOX_DIGITAL 有效';
COMMENT ON COLUMN sensor_readings_v2.phase_name IS '实验阶段: PREHEAT, BASELINE, DOSE, EQUILIBRATION, SAMPLE, PURGE, RECOVERY, RINSE';

COMMENT ON TABLE sensor_metadata IS '传感器硬件元数据';
COMMENT ON TABLE heater_profiles IS '加热配置预设表';
COMMENT ON TABLE sensor_heater_assignments IS '传感器加热配置分配记录 - 某传感器某时间段用什么配置';

-- 仅当连续聚合存在时添加注释
-- 注意: TimescaleDB continuous aggregate 使用 COMMENT ON VIEW 而非 MATERIALIZED VIEW
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM timescaledb_information.continuous_aggregates 
        WHERE view_name = 'sensor_heater_cycles'
    ) THEN
        EXECUTE 'COMMENT ON VIEW sensor_heater_cycles IS ''ML 特征提取: 按加热周期聚合统计''';
    END IF;
END $$;
