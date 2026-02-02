-- Analytics Service 扩展数据库架构
-- 用于 enose-analytics Python 服务的内部状态和历史记录

-- ============================================================================
-- 可视化计算缓存表
-- 存储 PCA/t-SNE 等计算结果，避免重复计算
-- ============================================================================

CREATE TABLE IF NOT EXISTS visualization_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 缓存键（参数哈希）
    cache_key TEXT NOT NULL,
    
    -- 可视化类型: PCA, TSNE, CLUSTERING, PCA_CLUSTERING
    vis_type TEXT NOT NULL,
    
    -- 参数
    n_components INT NOT NULL DEFAULT 2,
    perplexity INT,
    n_clusters INT,
    experiment_id TEXT,
    
    -- 数据范围
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    sample_count INT NOT NULL,
    
    -- 计算结果 (JSON)
    result JSONB NOT NULL,
    
    -- 元数据
    compute_time_ms INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour'
);

-- 缓存键唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_vis_cache_key ON visualization_cache (cache_key);

-- 过期索引 (用于清理)
CREATE INDEX IF NOT EXISTS idx_vis_cache_expires ON visualization_cache (expires_at);

-- ============================================================================
-- 模型训练任务表
-- 记录模型训练的历史和状态
-- ============================================================================

CREATE TABLE IF NOT EXISTS training_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 任务配置
    model_name TEXT NOT NULL,
    model_config JSONB NOT NULL,
    label_ids UUID[] NOT NULL,
    
    -- 状态: PENDING, RUNNING, COMPLETED, FAILED, CANCELLED
    status TEXT NOT NULL DEFAULT 'PENDING',
    
    -- 进度信息
    current_epoch INT DEFAULT 0,
    total_epochs INT NOT NULL,
    train_loss DOUBLE PRECISION,
    val_loss DOUBLE PRECISION,
    train_accuracy DOUBLE PRECISION,
    val_accuracy DOUBLE PRECISION,
    
    -- 时间戳
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- 结果
    model_id UUID REFERENCES ml_models(id) ON DELETE SET NULL,
    error_message TEXT
);

-- 状态索引
CREATE INDEX IF NOT EXISTS idx_training_jobs_status ON training_jobs (status);
CREATE INDEX IF NOT EXISTS idx_training_jobs_created ON training_jobs (created_at DESC);

-- ============================================================================
-- 训练进度日志表 (用于前端实时显示)
-- ============================================================================

CREATE TABLE IF NOT EXISTS training_progress (
    id BIGSERIAL,
    job_id UUID NOT NULL REFERENCES training_jobs(id) ON DELETE CASCADE,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- 进度信息
    epoch INT NOT NULL,
    batch INT,
    train_loss DOUBLE PRECISION,
    val_loss DOUBLE PRECISION,
    train_accuracy DOUBLE PRECISION,
    val_accuracy DOUBLE PRECISION,
    
    -- 额外指标
    metrics JSONB,
    
    PRIMARY KEY (id, ts)
);

-- 转换为 TimescaleDB hypertable
SELECT create_hypertable('training_progress', 'ts', if_not_exists => TRUE);

-- 索引
CREATE INDEX IF NOT EXISTS idx_training_progress_job ON training_progress (job_id, ts DESC);

-- ============================================================================
-- 分析服务配置表
-- 存储服务级别的配置
-- ============================================================================

CREATE TABLE IF NOT EXISTS analytics_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 插入默认配置
INSERT INTO analytics_config (key, value, description) VALUES
    ('visualization', '{
        "default_n_components": 2,
        "default_perplexity": 30,
        "default_n_clusters": 5,
        "max_points": 10000,
        "cache_ttl_seconds": 3600
    }', '可视化计算默认参数'),
    ('training', '{
        "default_epochs": 100,
        "default_batch_size": 32,
        "default_learning_rate": 0.001,
        "early_stopping_patience": 10,
        "validation_split": 0.2
    }', '模型训练默认参数'),
    ('minio', '{
        "models_bucket": "models",
        "cache_bucket": "cache"
    }', 'MinIO 存储桶配置')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 推理历史表
-- 记录模型推理请求和结果
-- ============================================================================

CREATE TABLE IF NOT EXISTS inference_history (
    id BIGSERIAL,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- 关联
    model_id UUID REFERENCES ml_models(id) ON DELETE SET NULL,
    experiment_id TEXT,
    
    -- 输入数据摘要
    input_sample_count INT NOT NULL,
    input_time_range TSTZRANGE,
    
    -- 推理结果
    predictions JSONB NOT NULL,
    confidence_scores DOUBLE PRECISION[],
    
    -- 性能
    inference_time_ms INT,
    
    PRIMARY KEY (id, ts)
);

-- 转换为 TimescaleDB hypertable
SELECT create_hypertable('inference_history', 'ts', if_not_exists => TRUE);

-- 索引
CREATE INDEX IF NOT EXISTS idx_inference_history_model ON inference_history (model_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_inference_history_experiment ON inference_history (experiment_id, ts DESC);

-- ============================================================================
-- 数据质量统计表 (每日聚合)
-- ============================================================================

CREATE TABLE IF NOT EXISTS quality_daily_stats (
    date DATE NOT NULL,
    experiment_id TEXT,
    
    -- 统计
    total_alerts INT NOT NULL DEFAULT 0,
    critical_alerts INT NOT NULL DEFAULT 0,
    warning_alerts INT NOT NULL DEFAULT 0,
    info_alerts INT NOT NULL DEFAULT 0,
    
    -- 按类型统计
    alerts_by_type JSONB NOT NULL DEFAULT '{}',
    
    -- 时间戳
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    PRIMARY KEY (date, experiment_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_quality_daily_stats_date ON quality_daily_stats (date DESC);

-- ============================================================================
-- 清理函数: 删除过期的可视化缓存
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_visualization_cache()
RETURNS INT AS $$
DECLARE
    deleted_count INT;
BEGIN
    DELETE FROM visualization_cache WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 视图: 活跃训练任务
-- ============================================================================

CREATE OR REPLACE VIEW active_training_jobs AS
SELECT 
    tj.id,
    tj.model_name,
    tj.status,
    tj.current_epoch,
    tj.total_epochs,
    tj.train_loss,
    tj.val_loss,
    tj.train_accuracy,
    tj.val_accuracy,
    tj.created_at,
    tj.started_at,
    EXTRACT(EPOCH FROM (NOW() - tj.started_at)) AS elapsed_seconds
FROM training_jobs tj
WHERE tj.status IN ('PENDING', 'RUNNING')
ORDER BY tj.created_at DESC;

-- ============================================================================
-- 函数: 获取模型性能摘要
-- ============================================================================

CREATE OR REPLACE FUNCTION get_model_performance_summary(p_model_id UUID)
RETURNS TABLE (
    total_inferences BIGINT,
    avg_inference_time_ms DOUBLE PRECISION,
    last_inference_at TIMESTAMPTZ,
    prediction_distribution JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT,
        AVG(ih.inference_time_ms)::DOUBLE PRECISION,
        MAX(ih.ts),
        jsonb_object_agg(
            pred.key, 
            pred.count
        )
    FROM inference_history ih,
    LATERAL (
        SELECT 
            p.value->>'label' AS key,
            COUNT(*) AS count
        FROM jsonb_array_elements(ih.predictions) p
        GROUP BY p.value->>'label'
    ) pred
    WHERE ih.model_id = p_model_id;
END;
$$ LANGUAGE plpgsql;
