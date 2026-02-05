-- ============================================================
-- 001-sample-phase-refactor.sql
-- Sample 跨 Phase 采集与 Redis 帧缓存重构
-- ============================================================

-- ============================================================
-- 1. 创建 sample_phase_transitions 表
-- 记录 Sample 内部的 Phase 转换时间点
-- ============================================================
CREATE TABLE IF NOT EXISTS sample_phase_transitions (
    id              SERIAL PRIMARY KEY,
    sample_id       INTEGER NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
    phase_name      TEXT NOT NULL,
    start_time_ms   BIGINT NOT NULL,
    end_time_ms     BIGINT,              -- NULL = 进行中或与 sample 结束重合
    phase_order     SMALLINT NOT NULL,   -- 在 sample 内的顺序 (0-based)
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE (sample_id, phase_order)
);

CREATE INDEX IF NOT EXISTS idx_spt_sample ON sample_phase_transitions(sample_id);
CREATE INDEX IF NOT EXISTS idx_spt_phase ON sample_phase_transitions(phase_name);

COMMENT ON TABLE sample_phase_transitions IS 'Sample 内部的 Phase 转换记录，用于后续算法切割';
COMMENT ON COLUMN sample_phase_transitions.phase_order IS 'Phase 在 Sample 内的顺序 (0-based)';

-- ============================================================
-- 2. 清空历史数据 (用户已确认)
-- ============================================================
TRUNCATE TABLE normalized_frames CASCADE;
TRUNCATE TABLE normalized_frames_meta CASCADE;
TRUNCATE TABLE samples CASCADE;
-- sensor_readings_v2 保留结构，清空数据
TRUNCATE TABLE sensor_readings_v2;

-- ============================================================
-- 3. 修改 normalized_frames 表结构
-- ============================================================

-- 添加 sample_id 列
ALTER TABLE normalized_frames ADD COLUMN IF NOT EXISTS sample_id INTEGER REFERENCES samples(id) ON DELETE CASCADE;

-- 删除旧的唯一约束
ALTER TABLE normalized_frames DROP CONSTRAINT IF EXISTS normalized_frames_unique;

-- 添加新的唯一约束（按 sample_id）
ALTER TABLE normalized_frames ADD CONSTRAINT normalized_frames_unique 
    UNIQUE (sample_id, method, n_samples, frame_idx);

-- 删除旧索引
DROP INDEX IF EXISTS idx_normalized_frames_run_phase;

-- 创建新索引
CREATE INDEX IF NOT EXISTS idx_normalized_frames_sample ON normalized_frames(sample_id);

-- ============================================================
-- 4. 修改 normalized_frames_meta 表结构
-- ============================================================

-- 添加 sample_id 列
ALTER TABLE normalized_frames_meta ADD COLUMN IF NOT EXISTS sample_id INTEGER REFERENCES samples(id) ON DELETE CASCADE;

-- 删除旧的唯一约束
ALTER TABLE normalized_frames_meta DROP CONSTRAINT IF EXISTS normalized_frames_meta_unique;

-- 添加新的唯一约束
ALTER TABLE normalized_frames_meta ADD CONSTRAINT normalized_frames_meta_unique 
    UNIQUE (sample_id, method, n_samples);

-- ============================================================
-- 5. 添加采集 Phase 白名单配置表 (可选)
-- ============================================================
CREATE TABLE IF NOT EXISTS acquisition_phase_patterns (
    id              SERIAL PRIMARY KEY,
    pattern         TEXT NOT NULL UNIQUE,  -- Phase 名称模式 (支持 LIKE)
    description     TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 插入默认白名单
INSERT INTO acquisition_phase_patterns (pattern, description) VALUES
    ('SAMPLE', '样品采集阶段'),
    ('DOSE', '加样阶段'),
    ('ACQUISITION', '数据采集阶段')
ON CONFLICT (pattern) DO NOTHING;

COMMENT ON TABLE acquisition_phase_patterns IS '采集 Phase 白名单，匹配的 Phase 会触发新 Sample';

-- ============================================================
-- 完成
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '001-sample-phase-refactor.sql: 迁移完成';
END $$;
