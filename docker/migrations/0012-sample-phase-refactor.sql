-- ============================================================
-- 0012-sample-phase-refactor.sql - Sample 跨 Phase 采集重构
-- 来源: 11-sample-phase-refactor.sql
-- ============================================================
-- 重新定义 Sample 的语义（可跨 Phase），添加 Phase 转换时间标记
-- 修改 normalized_frames 以 sample_id 为主键
-- ============================================================

-- ============================================================
-- 1. 创建 sample_phase_transitions 表
-- 记录 Sample 内部的 Phase 转换时间点，供后续算法切割使用
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

COMMENT ON TABLE sample_phase_transitions IS 'Sample 内部的 Phase 转换记录，用于跨 Phase 采集的数据切割';
COMMENT ON COLUMN sample_phase_transitions.phase_order IS '在 sample 内的顺序 (0-based)';
COMMENT ON COLUMN sample_phase_transitions.end_time_ms IS 'NULL 表示进行中或与 sample 结束时间重合';

-- ============================================================
-- 2. 修改 normalized_frames 表：添加 sample_id 列
-- ============================================================
ALTER TABLE normalized_frames ADD COLUMN IF NOT EXISTS sample_id INTEGER REFERENCES samples(id) ON DELETE CASCADE;

-- 为新列创建索引
CREATE INDEX IF NOT EXISTS idx_normalized_frames_sample ON normalized_frames(sample_id);

-- ============================================================
-- 3. 修改 normalized_frames_meta 表：添加 sample_id 列
-- ============================================================
ALTER TABLE normalized_frames_meta ADD COLUMN IF NOT EXISTS sample_id INTEGER REFERENCES samples(id) ON DELETE CASCADE;

-- ============================================================
-- 4. 清空历史数据（新旧结构不兼容，需要重新采集）
-- 注意：这会删除所有归一化帧数据！
-- ============================================================
TRUNCATE TABLE normalized_frames CASCADE;
TRUNCATE TABLE normalized_frames_meta CASCADE;

-- ============================================================
-- 5. 修改约束：从 (run_id, phase_name, method, n_samples, frame_idx) 
--    改为 (sample_id, method, n_samples, frame_idx)
-- ============================================================
-- 删除旧约束
ALTER TABLE normalized_frames DROP CONSTRAINT IF EXISTS normalized_frames_unique;

-- 添加新约束
ALTER TABLE normalized_frames ADD CONSTRAINT normalized_frames_unique 
    UNIQUE (sample_id, method, n_samples, frame_idx);

-- 删除旧元数据约束
ALTER TABLE normalized_frames_meta DROP CONSTRAINT IF EXISTS normalized_frames_meta_unique;

-- 添加新元数据约束
ALTER TABLE normalized_frames_meta ADD CONSTRAINT normalized_frames_meta_unique 
    UNIQUE (sample_id, method, n_samples);

-- ============================================================
-- 6. 删除旧索引，创建新索引
-- ============================================================
DROP INDEX IF EXISTS idx_normalized_frames_run_phase;

-- ============================================================
-- 7. 辅助视图：Sample 的 Phase 转换概览
-- ============================================================
CREATE OR REPLACE VIEW sample_phase_overview AS
SELECT 
    spt.sample_id,
    s.run_id,
    s.sample_idx,
    spt.phase_order,
    spt.phase_name,
    spt.start_time_ms,
    spt.end_time_ms,
    CASE 
        WHEN spt.end_time_ms IS NOT NULL THEN (spt.end_time_ms - spt.start_time_ms) / 1000.0
        ELSE NULL
    END as duration_s,
    spt.created_at
FROM sample_phase_transitions spt
JOIN samples s ON spt.sample_id = s.id
ORDER BY spt.sample_id, spt.phase_order;

-- ============================================================
-- 8. 辅助函数：获取 Sample 的完整时间范围
-- ============================================================
CREATE OR REPLACE FUNCTION get_sample_time_range(p_sample_id INTEGER)
RETURNS TABLE (
    start_time_ms BIGINT,
    end_time_ms BIGINT,
    duration_ms BIGINT,
    phase_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.start_time_ms,
        s.end_time_ms,
        COALESCE(s.end_time_ms - s.start_time_ms, 0)::BIGINT,
        (SELECT COUNT(*)::INTEGER FROM sample_phase_transitions WHERE sample_id = p_sample_id)
    FROM samples s
    WHERE s.id = p_sample_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 完成
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '0012-sample-phase-refactor.sql: Sample Phase 重构完成';
    RAISE NOTICE '  - 创建 sample_phase_transitions 表';
    RAISE NOTICE '  - normalized_frames 改为 sample_id 索引';
    RAISE NOTICE '  - 历史归一化帧数据已清空';
END $$;
