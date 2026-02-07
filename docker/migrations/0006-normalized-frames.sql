-- ============================================================
-- 0006-normalized-frames.sql - 归一化帧表
-- 合并自: 07-normalized-frames.sql + 12-fix-normalized-frames-nullable.sql
-- 变更: run_id/phase_name 从一开始就允许 NULL (使用 sample_id 替代)
-- ============================================================

-- 插值方法枚举
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'interpolation_method') THEN
        CREATE TYPE interpolation_method AS ENUM ('linear', 'pchip');
    END IF;
END $$;

-- 归一化帧表
CREATE TABLE IF NOT EXISTS normalized_frames (
    id              BIGSERIAL PRIMARY KEY,
    run_id          INTEGER,                          -- 允许 NULL (使用 sample_id 替代)
    phase_name      TEXT,                             -- 允许 NULL (使用 sample_id 替代)
    method          interpolation_method NOT NULL,
    n_samples       INTEGER NOT NULL,           -- 采样点数
    frame_idx       INTEGER NOT NULL,           -- 帧索引 0 ~ n_samples-1
    normalized_t    DOUBLE PRECISION NOT NULL,  -- 归一化时间 [0, 1]
    mox_readings    DOUBLE PRECISION[8],        -- 8个传感器的插值值
    temp_c          DOUBLE PRECISION,           -- 插值后的温度
    rh              DOUBLE PRECISION,           -- 插值后的湿度
    pressure        DOUBLE PRECISION,           -- 插值后的气压
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT normalized_frames_unique 
        UNIQUE (run_id, phase_name, method, n_samples, frame_idx)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_normalized_frames_run_phase 
    ON normalized_frames(run_id, phase_name);
CREATE INDEX IF NOT EXISTS idx_normalized_frames_method 
    ON normalized_frames(method);

-- 元数据表：记录每次归一化的参数和统计信息
CREATE TABLE IF NOT EXISTS normalized_frames_meta (
    id              BIGSERIAL PRIMARY KEY,
    run_id          INTEGER,                          -- 允许 NULL (使用 sample_id 替代)
    phase_name      TEXT,                             -- 允许 NULL (使用 sample_id 替代)
    method          interpolation_method NOT NULL,
    n_samples       INTEGER NOT NULL,
    
    -- 原始数据统计
    original_point_counts   INTEGER[8],         -- 每个传感器的原始点数
    time_range_ms          BIGINT,              -- 原始时间跨度 (ms)
    
    -- 质量指标
    interpolation_quality   DOUBLE PRECISION,   -- 插值质量评分 (可选)
    
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT normalized_frames_meta_unique 
        UNIQUE (run_id, phase_name, method, n_samples)
);

COMMENT ON TABLE normalized_frames IS '归一化帧数据 - 插值后的固定长度序列，用于 ML 训练';
COMMENT ON TABLE normalized_frames_meta IS '归一化帧元数据 - 记录插值参数和原始数据统计';
COMMENT ON COLUMN normalized_frames.normalized_t IS '归一化时间，0.0 = phase 开始，1.0 = phase 结束';
COMMENT ON COLUMN normalized_frames.method IS '插值方法：linear (线性) 或 pchip (保形分段三次)';
