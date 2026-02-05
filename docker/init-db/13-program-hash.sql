-- ============================================================
-- 13-program-hash.sql - 实验程序 YAML Hash 记录
-- ============================================================
-- 用于追踪实验使用的程序版本，支持可追溯性和快速比对
-- ============================================================

-- ============================================================
-- 1. runs 表添加 program_yaml_hash 列
-- ============================================================
ALTER TABLE runs ADD COLUMN IF NOT EXISTS program_yaml_hash TEXT;

-- 索引：支持按 hash 快速查询相同程序的实验
CREATE INDEX IF NOT EXISTS idx_runs_program_hash ON runs(program_yaml_hash);

-- ============================================================
-- 2. 视图：按程序 hash 统计实验
-- ============================================================
CREATE OR REPLACE VIEW experiment_program_stats AS
SELECT 
    program_yaml_hash,
    program_id,
    program_name,
    COUNT(*) as run_count,
    COUNT(*) FILTER (WHERE state = 'completed') as completed_count,
    COUNT(*) FILTER (WHERE state = 'error') as error_count,
    COUNT(*) FILTER (WHERE state = 'aborted') as aborted_count,
    MIN(created_at) as first_run_at,
    MAX(created_at) as last_run_at
FROM runs
WHERE program_yaml_hash IS NOT NULL
GROUP BY program_yaml_hash, program_id, program_name;

COMMENT ON VIEW experiment_program_stats IS '按程序 hash 统计实验运行情况';

-- ============================================================
-- 3. 辅助函数：获取相同程序的历史运行
-- ============================================================
CREATE OR REPLACE FUNCTION get_runs_by_program_hash(p_hash TEXT)
RETURNS TABLE (
    run_id INTEGER,
    program_id TEXT,
    program_name TEXT,
    state TEXT,
    created_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    total_steps INTEGER,
    error_message TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id,
        r.program_id,
        r.program_name,
        r.state,
        r.created_at,
        r.completed_at,
        r.total_steps,
        r.error_message
    FROM runs r
    WHERE r.program_yaml_hash = p_hash
    ORDER BY r.created_at DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_runs_by_program_hash IS '获取使用相同程序(hash)的所有历史运行';

-- ============================================================
-- 完成
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '13-program-hash.sql: 程序 hash 记录功能创建完成';
END $$;
