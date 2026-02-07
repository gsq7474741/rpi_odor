-- ============================================================
-- 0015-data-quality.sql - 数据质量评分
-- 来源: 15-data-quality.sql
-- ============================================================
-- 为 samples 和 runs 表添加质量评分字段
-- ============================================================

-- samples 表扩展：质量评分
ALTER TABLE samples ADD COLUMN IF NOT EXISTS quality_score REAL;           -- 0-100 综合质量评分
ALTER TABLE samples ADD COLUMN IF NOT EXISTS quality_level TEXT;           -- good/warning/poor
ALTER TABLE samples ADD COLUMN IF NOT EXISTS quality_report JSONB;        -- 详细质量报告 JSON

-- runs 表扩展：实验级别质量评分
ALTER TABLE runs ADD COLUMN IF NOT EXISTS quality_score REAL;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS quality_level TEXT;

-- 索引：方便按质量筛选
CREATE INDEX IF NOT EXISTS idx_samples_quality_level ON samples(quality_level) WHERE quality_level IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_runs_quality_level ON runs(quality_level) WHERE quality_level IS NOT NULL;
