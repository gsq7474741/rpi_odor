-- ============================================================
-- 0007-analytics.sql - Analytics Service 数据库架构
-- 来源: 07-analytics.sql
-- ============================================================

-- ============================================================================
-- 质检结果表
-- ============================================================================

CREATE TABLE IF NOT EXISTS quality_results (
    id BIGSERIAL,
    ts TIMESTAMPTZ NOT NULL,
    sensor_seq BIGINT NOT NULL,
    experiment_id TEXT,
    
    -- 质量标志 (JSON 数组)
    alerts JSONB NOT NULL DEFAULT '[]',
    
    -- 统计指标 (JSON 数组)
    metrics JSONB NOT NULL DEFAULT '[]',
    
    -- 模型预测结果
    prediction JSONB,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    PRIMARY KEY (id, ts)
);

-- 转换为 TimescaleDB hypertable
SELECT create_hypertable('quality_results', 'ts', if_not_exists => TRUE);

-- 索引
CREATE INDEX IF NOT EXISTS idx_quality_results_experiment 
    ON quality_results (experiment_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_quality_results_alerts 
    ON quality_results USING GIN (alerts);

-- ============================================================================
-- ML 模型表
-- ============================================================================

CREATE TABLE IF NOT EXISTS ml_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    
    -- 模型配置
    config JSONB NOT NULL,
    input_dim INT NOT NULL,
    output_dim INT NOT NULL,
    class_names TEXT[] NOT NULL,
    
    -- 训练指标
    train_accuracy DOUBLE PRECISION,
    val_accuracy DOUBLE PRECISION,
    train_loss DOUBLE PRECISION,
    val_loss DOUBLE PRECISION,
    
    -- 存储位置
    minio_bucket TEXT NOT NULL DEFAULT 'models',
    minio_path TEXT NOT NULL,
    file_size BIGINT,
    
    -- 元数据
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 名称唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_ml_models_name ON ml_models (name);

-- ============================================================================
-- 样品标签表
-- ============================================================================

CREATE TABLE IF NOT EXISTS sample_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    
    -- 统计
    sample_count INT NOT NULL DEFAULT 0,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 名称唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_sample_labels_name ON sample_labels (name);

-- ============================================================================
-- 标签范围表 (多对多关系)
-- ============================================================================

CREATE TABLE IF NOT EXISTS labeled_ranges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label_id UUID NOT NULL REFERENCES sample_labels(id) ON DELETE CASCADE,
    
    experiment_id TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    phase TEXT,  -- 可选: 只标注特定阶段
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT labeled_ranges_time_check CHECK (end_time > start_time)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_labeled_ranges_label ON labeled_ranges (label_id);
CREATE INDEX IF NOT EXISTS idx_labeled_ranges_experiment ON labeled_ranges (experiment_id);
CREATE INDEX IF NOT EXISTS idx_labeled_ranges_time ON labeled_ranges (start_time, end_time);

-- ============================================================================
-- 质检配置表
-- ============================================================================

CREATE TABLE IF NOT EXISTS quality_config (
    id INT PRIMARY KEY DEFAULT 1,  -- 单例配置
    config JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT quality_config_singleton CHECK (id = 1)
);

-- 插入默认配置
INSERT INTO quality_config (id, config) VALUES (1, '{
    "baseline_cv_threshold": 0.05,
    "baseline_slope_threshold": 0.01,
    "baseline_window_size": 60,
    "min_resistance": 100,
    "max_resistance": 1000000,
    "noise_std_threshold": 0.1,
    "noise_window_size": 10,
    "min_humidity": 20,
    "max_humidity": 80,
    "min_temperature": 15,
    "max_temperature": 40,
    "drift_threshold": 0.1,
    "drift_window_size": 300,
    "enable_notifications": true,
    "disabled_flags": []
}') ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 触发器: 更新 sample_count
-- ============================================================================

CREATE OR REPLACE FUNCTION update_sample_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE sample_labels 
        SET sample_count = sample_count + 1,
            updated_at = NOW()
        WHERE id = NEW.label_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE sample_labels 
        SET sample_count = sample_count - 1,
            updated_at = NOW()
        WHERE id = OLD.label_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_sample_count
AFTER INSERT OR DELETE ON labeled_ranges
FOR EACH ROW EXECUTE FUNCTION update_sample_count();

-- ============================================================================
-- 视图: 带标签的传感器数据
-- ============================================================================

CREATE OR REPLACE VIEW labeled_sensor_data AS
SELECT 
    sf.ts,
    sf.seq,
    sf.experiment_id,
    sf.phase_name,
    sf.mox_readings,
    sf.temp_c,
    sf.rh,
    sl.id AS label_id,
    sl.name AS label_name
FROM sensor_frames sf
JOIN labeled_ranges lr ON 
    sf.ts BETWEEN lr.start_time AND lr.end_time
    AND (lr.experiment_id IS NULL OR sf.experiment_id = lr.experiment_id)
    AND (lr.phase IS NULL OR sf.phase_name = lr.phase)
JOIN sample_labels sl ON lr.label_id = sl.id;

-- ============================================================================
-- 函数: 获取训练数据集
-- ============================================================================

CREATE OR REPLACE FUNCTION get_training_dataset(label_ids UUID[])
RETURNS TABLE (
    ts TIMESTAMPTZ,
    mox_readings DOUBLE PRECISION[],
    temp_c DOUBLE PRECISION,
    rh DOUBLE PRECISION,
    label_name TEXT,
    label_index INT
) AS $$
BEGIN
    RETURN QUERY
    WITH labels_with_index AS (
        SELECT 
            sl.id,
            sl.name,
            ROW_NUMBER() OVER (ORDER BY sl.name) - 1 AS idx
        FROM sample_labels sl
        WHERE sl.id = ANY(label_ids)
    )
    SELECT 
        sf.ts,
        sf.mox_readings,
        sf.temp_c,
        sf.rh,
        lwi.name,
        lwi.idx::INT
    FROM sensor_frames sf
    JOIN labeled_ranges lr ON 
        sf.ts BETWEEN lr.start_time AND lr.end_time
        AND (lr.experiment_id IS NULL OR sf.experiment_id = lr.experiment_id)
        AND (lr.phase IS NULL OR sf.phase_name = lr.phase)
    JOIN labels_with_index lwi ON lr.label_id = lwi.id
    ORDER BY sf.ts;
END;
$$ LANGUAGE plpgsql;
