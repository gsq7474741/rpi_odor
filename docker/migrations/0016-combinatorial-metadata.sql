-- ============================================================================
-- 0016-combinatorial-metadata.sql - 组合实验元数据扩展
-- 面向大规模组合实验（茶叶拼配 ~2000 组 / 通用组合嗅觉 ~4000 组）
-- 新增可追溯性元数据：试剂批次、漂移校准、序列上下文、实验设计阶段等
-- ============================================================================

-- ============================================================================
-- A. samples 表扩展
-- ============================================================================

-- 试剂批次追踪
ALTER TABLE samples ADD COLUMN IF NOT EXISTS reagent_batch_id TEXT;            -- 试剂批次号（哪瓶茶/哪瓶化学品）
ALTER TABLE samples ADD COLUMN IF NOT EXISTS reagent_prep_date DATE;           -- 试剂配制/冲泡日期

-- 序列上下文（残留评估）
ALTER TABLE samples ADD COLUMN IF NOT EXISTS prev_sample_id INTEGER REFERENCES samples(id) ON DELETE SET NULL;
ALTER TABLE samples ADD COLUMN IF NOT EXISTS samples_since_wash SMALLINT DEFAULT 0;  -- 距上次深度清洗的样品数

-- 传感器状态
ALTER TABLE samples ADD COLUMN IF NOT EXISTS sensor_hours_at_sample REAL;      -- 采样时传感器累计使用小时

-- 漂移校准与空白标记
ALTER TABLE samples ADD COLUMN IF NOT EXISTS is_anchor BOOLEAN DEFAULT false;  -- 漂移校准锚点样品
ALTER TABLE samples ADD COLUMN IF NOT EXISTS is_blank BOOLEAN DEFAULT false;   -- 空白对照（仅清洗液/空气）

-- 实验设计阶段（区别于采样阶段 phase_name）
ALTER TABLE samples ADD COLUMN IF NOT EXISTS experiment_phase TEXT;            -- 实验设计阶段标识（Phase 1-6 等）

-- 随机化信息
ALTER TABLE samples ADD COLUMN IF NOT EXISTS sequence_block TEXT;              -- 随机化区组标识
ALTER TABLE samples ADD COLUMN IF NOT EXISTS randomization_seed INTEGER;       -- 随机化种子

-- 清洗残余响应
ALTER TABLE samples ADD COLUMN IF NOT EXISTS wash_residual_response REAL[];    -- 清洗后残余传感器响应（8通道）

-- ============================================================================
-- B. runs 表扩展
-- ============================================================================

-- 实验设计描述
ALTER TABLE runs ADD COLUMN IF NOT EXISTS experiment_design JSONB;             -- 目标组合矩阵、Phase 定义、留出物质等
ALTER TABLE runs ADD COLUMN IF NOT EXISTS total_planned_samples INTEGER;       -- 计划总样本数
ALTER TABLE runs ADD COLUMN IF NOT EXISTS anchor_liquid_id TEXT;               -- 锚点校准液体 ID
ALTER TABLE runs ADD COLUMN IF NOT EXISTS design_phase_name TEXT;              -- 当前运行对应的实验设计阶段名

-- ============================================================================
-- C. 索引
-- ============================================================================

-- 锚点/空白快速查询
CREATE INDEX IF NOT EXISTS idx_samples_is_anchor ON samples(is_anchor) WHERE is_anchor = true;
CREATE INDEX IF NOT EXISTS idx_samples_is_blank ON samples(is_blank) WHERE is_blank = true;

-- 实验设计阶段筛选
CREATE INDEX IF NOT EXISTS idx_samples_experiment_phase ON samples(experiment_phase) WHERE experiment_phase IS NOT NULL;

-- 试剂批次筛选
CREATE INDEX IF NOT EXISTS idx_samples_reagent_batch ON samples(reagent_batch_id) WHERE reagent_batch_id IS NOT NULL;

-- 前序样本查询（残留分析链）
CREATE INDEX IF NOT EXISTS idx_samples_prev_sample ON samples(prev_sample_id) WHERE prev_sample_id IS NOT NULL;

-- runs 设计阶段
CREATE INDEX IF NOT EXISTS idx_runs_design_phase ON runs(design_phase_name) WHERE design_phase_name IS NOT NULL;

-- ============================================================================
-- D. 视图：组合覆盖矩阵统计
-- ============================================================================

-- 二元组合覆盖统计视图
CREATE OR REPLACE VIEW v_binary_combination_coverage AS
WITH binary_samples AS (
    SELECT
        s.id,
        s.run_id,
        s.experiment_phase,
        s.liquid_names,
        s.liquid_ratios,
        s.quality_level,
        s.is_anchor,
        s.is_blank,
        array_length(s.liquid_ids, 1) as component_count
    FROM samples s
    WHERE array_length(s.liquid_ids, 1) = 2
      AND s.is_anchor = false
      AND s.is_blank = false
),
pairs AS (
    SELECT
        LEAST(liquid_names[1], liquid_names[2]) AS substance_a,
        GREATEST(liquid_names[1], liquid_names[2]) AS substance_b,
        CASE
            WHEN liquid_names[1] < liquid_names[2] THEN liquid_ratios[1]
            ELSE liquid_ratios[2]
        END AS ratio_a,
        experiment_phase,
        quality_level,
        run_id,
        id AS sample_id
    FROM binary_samples
)
SELECT
    substance_a,
    substance_b,
    ratio_a,
    experiment_phase,
    COUNT(*) AS replicate_count,
    COUNT(*) FILTER (WHERE quality_level = 'good' OR quality_level IS NULL) AS good_count,
    COUNT(*) FILTER (WHERE quality_level = 'warning') AS warning_count,
    COUNT(*) FILTER (WHERE quality_level = 'poor') AS poor_count,
    array_agg(DISTINCT run_id) AS run_ids
FROM pairs
GROUP BY substance_a, substance_b, ratio_a, experiment_phase
ORDER BY substance_a, substance_b, ratio_a;

-- 纯物质样本统计视图
CREATE OR REPLACE VIEW v_pure_substance_coverage AS
SELECT
    liquid_names[1] AS substance,
    experiment_phase,
    COUNT(*) AS replicate_count,
    COUNT(*) FILTER (WHERE quality_level = 'good' OR quality_level IS NULL) AS good_count,
    array_agg(DISTINCT run_id) AS run_ids
FROM samples
WHERE array_length(liquid_ids, 1) = 1
  AND is_anchor = false
  AND is_blank = false
GROUP BY liquid_names[1], experiment_phase
ORDER BY liquid_names[1];

-- 锚点样品漂移追踪视图
CREATE OR REPLACE VIEW v_anchor_drift_tracking AS
SELECT
    s.id AS sample_id,
    s.run_id,
    s.start_time_ms,
    s.liquid_names,
    s.avg_temperature_c,
    s.avg_humidity_pct,
    s.sensor_hours_at_sample,
    s.sequence_block,
    DATE(to_timestamp(s.start_time_ms / 1000.0)) AS sample_date
FROM samples s
WHERE s.is_anchor = true
ORDER BY s.start_time_ms;
