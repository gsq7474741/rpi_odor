-- ============================================================
-- 0016-training-platform.sql - 模型训练平台扩展
-- 扩展 ml_models 和 training_jobs 表，新增 training_evaluations 表
-- ============================================================

-- ============================================================================
-- 扩展 ml_models 表
-- ============================================================================

ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS model_type TEXT NOT NULL DEFAULT 'mlp';
ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'classification';
ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS framework TEXT NOT NULL DEFAULT 'pytorch';
ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS training_job_id UUID REFERENCES training_jobs(id);
ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS test_accuracy DOUBLE PRECISION;
ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS test_loss DOUBLE PRECISION;
ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS confusion_matrix JSONB;
ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS extra_metrics JSONB DEFAULT '{}';

-- ============================================================================
-- 扩展 training_jobs 表
-- ============================================================================

ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS model_type TEXT NOT NULL DEFAULT 'mlp';
ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'classification';
ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS dataset_config JSONB NOT NULL DEFAULT '{}';
ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS hyperparams JSONB NOT NULL DEFAULT '{}';
ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS test_accuracy DOUBLE PRECISION;
ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS test_loss DOUBLE PRECISION;
ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS extra_metrics JSONB DEFAULT '{}';

-- ============================================================================
-- 新增 training_evaluations 表
-- ============================================================================

CREATE TABLE IF NOT EXISTS training_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES training_jobs(id) ON DELETE CASCADE,
    model_id UUID REFERENCES ml_models(id) ON DELETE SET NULL,

    -- 评估指标
    split TEXT NOT NULL CHECK (split IN ('train', 'val', 'test')),
    accuracy DOUBLE PRECISION,
    loss DOUBLE PRECISION,
    f1_macro DOUBLE PRECISION,
    f1_weighted DOUBLE PRECISION,
    precision_macro DOUBLE PRECISION,
    recall_macro DOUBLE PRECISION,
    r2_score DOUBLE PRECISION,
    mse DOUBLE PRECISION,
    mae DOUBLE PRECISION,
    silhouette_score DOUBLE PRECISION,

    -- 详细数据
    confusion_matrix JSONB,
    classification_report JSONB,
    predictions JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_evaluations_job ON training_evaluations (job_id);
CREATE INDEX IF NOT EXISTS idx_training_evaluations_model ON training_evaluations (model_id);
