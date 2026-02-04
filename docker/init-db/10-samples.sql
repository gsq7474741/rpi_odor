-- ============================================================
-- 10-samples.sql - 样本分割与聚合表
-- ============================================================
-- 用于存储实验中的样本及其完整参数，支持跨 run 聚合分析
-- ============================================================

-- ============================================================
-- 1. 创建 samples 表
-- ============================================================
CREATE TABLE IF NOT EXISTS samples (
    id              SERIAL PRIMARY KEY,
    run_id          INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    sample_idx      INTEGER NOT NULL,              -- run 内的样本序号 (0-based)
    
    -- 时间范围
    start_time_ms   BIGINT NOT NULL,               -- 采集开始时间
    end_time_ms     BIGINT,                        -- 采集结束时间 (NULL=进行中)
    
    -- ============================================================
    -- 参数哈希 (用于快速分组和聚合)
    -- ============================================================
    params_hash     TEXT NOT NULL,                 -- 完整参数的 SHA256 短哈希 (16字符)
    
    -- ============================================================
    -- A. 液体参数 (0-8 种液体)
    -- ============================================================
    liquid_ids      TEXT[],                        -- 液体 ID 列表 (可为空=无进样)
    liquid_names    TEXT[],                        -- 液体名称列表 (冗余，便于显示)
    liquid_ratios   DOUBLE PRECISION[],            -- 各液体比例 (和为 1)
    pump_indices    SMALLINT[],                    -- 各液体对应的泵索引
    total_volume_ml DOUBLE PRECISION,              -- 总进样量 (ml)
    flow_rate_ml_s  DOUBLE PRECISION,              -- 进样流速 (ml/s)
    
    -- ============================================================
    -- B. 采集参数
    -- ============================================================
    gas_pump_pwm    SMALLINT NOT NULL DEFAULT 0,   -- 气泵 PWM (0-100%)
    termination_type TEXT,                         -- 终止条件: duration/cycles/stability
    termination_value DOUBLE PRECISION,            -- 终止条件值
    max_duration_s  DOUBLE PRECISION,              -- 最大采集时间
    
    -- ============================================================
    -- C. 加热器配置 (支持每个传感器独立配置)
    -- ============================================================
    -- 结构: [{"sensor_indices": [0,1,2], "profile_name": "constant_320", "temps": [...], "durs": [...]}]
    heater_configs  JSONB,                         -- 加热器配置数组
    
    -- ============================================================
    -- D. 清洗参数
    -- ============================================================
    pre_wash_count  SMALLINT DEFAULT 0,            -- 采集前清洗次数
    pre_wash_volume_ml DOUBLE PRECISION,           -- 每次清洗量 (ml)
    wash_liquid_id  TEXT,                          -- 清洗液 ID
    
    -- ============================================================
    -- E. 阶段信息
    -- ============================================================
    phase_name      TEXT,                          -- 阶段名称 (BASELINE, SAMPLE, etc.)
    
    -- ============================================================
    -- F. 环境参数 (采集结束后计算的平均值)
    -- ============================================================
    avg_temperature_c DOUBLE PRECISION,            -- 平均环境温度
    avg_humidity_pct  DOUBLE PRECISION,            -- 平均相对湿度
    avg_pressure_hpa  DOUBLE PRECISION,            -- 平均气压
    
    -- ============================================================
    -- G. 完整参数 JSON (用于精确比对和调试)
    -- ============================================================
    params_json     JSONB NOT NULL,                -- 完整参数 JSON (包含上述所有字段)
    
    -- 元数据
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE (run_id, sample_idx)
);

-- ============================================================
-- 2. 索引优化
-- ============================================================

-- 按 run 查询
CREATE INDEX IF NOT EXISTS idx_samples_run ON samples(run_id);

-- 按参数哈希聚合 (跨 run 聚合的核心)
CREATE INDEX IF NOT EXISTS idx_samples_hash ON samples(params_hash);

-- 按时间范围查询
CREATE INDEX IF NOT EXISTS idx_samples_time ON samples(start_time_ms, end_time_ms);

-- 按液体类型筛选 (GIN 支持数组包含查询)
CREATE INDEX IF NOT EXISTS idx_samples_liquid ON samples USING GIN(liquid_ids);

-- 按阶段筛选
CREATE INDEX IF NOT EXISTS idx_samples_phase ON samples(phase_name) WHERE phase_name IS NOT NULL;

-- 按气泵 PWM 筛选
CREATE INDEX IF NOT EXISTS idx_samples_pwm ON samples(gas_pump_pwm);

-- 复合索引：常用查询模式 (液体 + SAMPLE 阶段)
CREATE INDEX IF NOT EXISTS idx_samples_liquid_phase ON samples USING GIN(liquid_ids) 
    WHERE phase_name = 'SAMPLE';

-- ============================================================
-- 3. 修改 sensor_readings_v2 表：添加 sample_id 列
-- ============================================================
ALTER TABLE sensor_readings_v2 ADD COLUMN IF NOT EXISTS sample_id INTEGER;

-- 添加索引 (按 sample_id 查询传感器数据)
CREATE INDEX IF NOT EXISTS idx_sr2_sample ON sensor_readings_v2(sample_id, time_ms DESC)
    WHERE sample_id IS NOT NULL;

-- ============================================================
-- 4. 辅助函数：计算环境参数平均值
-- ============================================================
CREATE OR REPLACE FUNCTION get_sample_environment_stats(
    p_start_time_ms BIGINT,
    p_end_time_ms BIGINT
) RETURNS TABLE (
    avg_temp DOUBLE PRECISION,
    avg_humidity DOUBLE PRECISION,
    avg_pressure DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        AVG(temperature)::DOUBLE PRECISION,
        AVG(humidity)::DOUBLE PRECISION,
        AVG(pressure)::DOUBLE PRECISION
    FROM sensor_readings_v2
    WHERE time_ms >= p_start_time_ms 
      AND time_ms <= p_end_time_ms
      AND sensor_idx = 0;  -- 只用第一个传感器的环境数据（所有传感器相同）
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. 辅助视图：样本概览
-- ============================================================
CREATE OR REPLACE VIEW sample_overview AS
SELECT 
    s.id,
    s.run_id,
    r.created_at as run_created_at,
    s.sample_idx,
    s.phase_name,
    s.params_hash,
    -- 液体信息（格式化显示）
    CASE 
        WHEN s.liquid_ids IS NULL OR array_length(s.liquid_ids, 1) IS NULL THEN '(无)'
        ELSE array_to_string(s.liquid_names, ' + ')
    END as liquids_display,
    s.total_volume_ml,
    s.gas_pump_pwm,
    -- 时间信息
    s.start_time_ms,
    s.end_time_ms,
    CASE 
        WHEN s.end_time_ms IS NOT NULL THEN (s.end_time_ms - s.start_time_ms) / 1000.0
        ELSE NULL
    END as duration_s,
    -- 环境参数
    s.avg_temperature_c,
    s.avg_humidity_pct,
    s.created_at
FROM samples s
JOIN runs r ON s.run_id = r.id
ORDER BY s.run_id DESC, s.sample_idx;

-- ============================================================
-- 6. 辅助视图：参数组聚合统计
-- ============================================================
CREATE OR REPLACE VIEW sample_groups AS
SELECT 
    params_hash,
    liquid_ids,
    liquid_names,
    gas_pump_pwm,
    phase_name,
    COUNT(*) as sample_count,
    array_agg(DISTINCT run_id) as run_ids,
    MIN(created_at) as first_created,
    MAX(created_at) as last_created
FROM samples
GROUP BY params_hash, liquid_ids, liquid_names, gas_pump_pwm, phase_name
ORDER BY sample_count DESC;

-- ============================================================
-- 完成
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '10-samples.sql: 样本表和索引创建完成';
END $$;
