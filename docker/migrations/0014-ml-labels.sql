-- ============================================================================
-- 0014-ml-labels.sql - ML 标签体系
-- 合并自: 14-ml-labels.sql + 002-update-concentration-config.sql
-- 变更: concentration 策略已直接定义为 classification 类型
-- ============================================================================

-- ============================================================================
-- 标签策略配置表
-- 定义如何从 sample 参数自动生成标签
-- ============================================================================

CREATE TABLE IF NOT EXISTS ml_label_configs (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    label_type  TEXT NOT NULL CHECK (label_type IN ('classification', 'regression', 'contrastive')),
    strategy    TEXT NOT NULL CHECK (strategy IN ('auto_from_params', 'manual', 'derived')),
    config      JSONB NOT NULL DEFAULT '{}',
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 样本 ML 标签表
-- 每个 sample 在每个策略下的具体标签值
-- ============================================================================

CREATE TABLE IF NOT EXISTS sample_ml_labels (
    id              SERIAL PRIMARY KEY,
    sample_id       INTEGER NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
    config_id       INTEGER NOT NULL REFERENCES ml_label_configs(id) ON DELETE CASCADE,

    label_str       TEXT,
    label_num       DOUBLE PRECISION,
    label_json      JSONB,
    label_index     INTEGER,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (sample_id, config_id)
);

CREATE INDEX IF NOT EXISTS idx_sample_ml_labels_sample ON sample_ml_labels (sample_id);
CREATE INDEX IF NOT EXISTS idx_sample_ml_labels_config ON sample_ml_labels (config_id);
CREATE INDEX IF NOT EXISTS idx_sample_ml_labels_str    ON sample_ml_labels (config_id, label_str);
CREATE INDEX IF NOT EXISTS idx_sample_ml_labels_index  ON sample_ml_labels (config_id, label_index);

-- ============================================================================
-- ML 数据集定义表
-- 保存用户构建的训练数据集配置
-- ============================================================================

CREATE TABLE IF NOT EXISTS ml_datasets (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    config_id   INTEGER NOT NULL REFERENCES ml_label_configs(id) ON DELETE CASCADE,
    description TEXT,

    -- 筛选条件
    filter_run_ids      INTEGER[],
    filter_phase_names  TEXT[],
    filter_liquid_ids   TEXT[],
    filter_params_hash  TEXT,

    -- 分割比例
    train_ratio         DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    val_ratio           DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    test_ratio          DOUBLE PRECISION NOT NULL DEFAULT 0.15,

    -- 统计
    total_samples       INTEGER NOT NULL DEFAULT 0,
    label_distribution  JSONB NOT NULL DEFAULT '{}',

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 内置标签策略 (concentration 已为 classification 类型)
-- ============================================================================

INSERT INTO ml_label_configs (name, label_type, strategy, config, description) VALUES
(
    'liquid_identity',
    'classification',
    'auto_from_params',
    '{}',
    '液体身份标签：单液体→液体名，混合→按比例降序拼接名称'
),
(
    'primary_liquid',
    'classification',
    'auto_from_params',
    '{}',
    '主成分液体标签：占比最大的液体名称'
),
(
    'mixture_formula',
    'classification',
    'auto_from_params',
    '{}',
    '精确配方标签：所有液体ID+比例排序后拼接的规范字符串'
),
(
    'concentration',
    'classification',
    'auto_from_params',
    '{}',
    '浓度标签：输出配方中每种液体的浓度，label_json 存储结构化浓度数据'
),
(
    'total_volume',
    'regression',
    'auto_from_params',
    '{}',
    '进样量标签：total_volume_ml 值'
),
(
    'gas_pump_speed',
    'regression',
    'auto_from_params',
    '{}',
    '气泵速度标签：gas_pump_pwm / 100.0'
),
(
    'params_group',
    'contrastive',
    'auto_from_params',
    '{}',
    '参数组标签：params_hash 相同 = 正样本对，用于对比学习'
),
(
    'env_temperature',
    'regression',
    'auto_from_params',
    '{}',
    '环境温度标签：avg_temperature_c，用于环境补偿模型'
)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- 视图：带 ML 标签的样本概览
-- ============================================================================

CREATE OR REPLACE VIEW sample_ml_overview AS
SELECT
    s.id AS sample_id,
    s.run_id,
    s.sample_idx,
    s.params_hash,
    s.liquid_names,
    s.liquid_ratios,
    s.total_volume_ml,
    s.gas_pump_pwm,
    s.phase_name,
    s.avg_temperature_c,
    s.avg_humidity_pct,
    mlc.name AS label_config_name,
    mlc.label_type,
    sml.label_str,
    sml.label_num,
    sml.label_index
FROM samples s
LEFT JOIN sample_ml_labels sml ON s.id = sml.sample_id
LEFT JOIN ml_label_configs mlc ON sml.config_id = mlc.id;

-- ============================================================================
-- 函数：按策略获取训练数据集
-- ============================================================================

CREATE OR REPLACE FUNCTION get_ml_training_data(
    p_config_name TEXT,
    p_run_ids INTEGER[] DEFAULT NULL,
    p_phase_names TEXT[] DEFAULT NULL
)
RETURNS TABLE (
    sample_id INTEGER,
    run_id INTEGER,
    params_hash TEXT,
    label_str TEXT,
    label_num DOUBLE PRECISION,
    label_index INTEGER,
    start_time_ms BIGINT,
    end_time_ms BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.run_id,
        s.params_hash,
        sml.label_str,
        sml.label_num,
        sml.label_index,
        s.start_time_ms,
        s.end_time_ms
    FROM samples s
    JOIN sample_ml_labels sml ON s.id = sml.sample_id
    JOIN ml_label_configs mlc ON sml.config_id = mlc.id
    WHERE mlc.name = p_config_name
      AND mlc.is_active = TRUE
      AND (p_run_ids IS NULL OR s.run_id = ANY(p_run_ids))
      AND (p_phase_names IS NULL OR s.phase_name = ANY(p_phase_names));
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 函数：按策略获取对比学习样本对
-- ============================================================================

CREATE OR REPLACE FUNCTION get_contrastive_pairs(
    p_run_ids INTEGER[] DEFAULT NULL,
    p_phase_names TEXT[] DEFAULT NULL,
    p_max_pairs INTEGER DEFAULT 1000
)
RETURNS TABLE (
    anchor_sample_id INTEGER,
    other_sample_id INTEGER,
    is_positive BOOLEAN,
    anchor_hash TEXT,
    other_hash TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH filtered_samples AS (
        SELECT s.id, s.params_hash
        FROM samples s
        WHERE (p_run_ids IS NULL OR s.run_id = ANY(p_run_ids))
          AND (p_phase_names IS NULL OR s.phase_name = ANY(p_phase_names))
          AND s.end_time_ms IS NOT NULL
    ),
    positive_pairs AS (
        SELECT
            a.id AS a_id,
            b.id AS b_id,
            TRUE AS positive,
            a.params_hash AS a_hash,
            b.params_hash AS b_hash
        FROM filtered_samples a
        JOIN filtered_samples b ON a.params_hash = b.params_hash AND a.id < b.id
        LIMIT p_max_pairs / 2
    ),
    negative_pairs AS (
        SELECT
            a.id AS a_id,
            b.id AS b_id,
            FALSE AS positive,
            a.params_hash AS a_hash,
            b.params_hash AS b_hash
        FROM filtered_samples a
        JOIN filtered_samples b ON a.params_hash != b.params_hash AND a.id < b.id
        LIMIT p_max_pairs / 2
    )
    SELECT * FROM positive_pairs
    UNION ALL
    SELECT * FROM negative_pairs;
END;
$$ LANGUAGE plpgsql;
