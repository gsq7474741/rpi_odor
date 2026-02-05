-- ============================================================
-- 11-experiment-state.sql - 实验执行状态持久化
-- ============================================================
-- 用于支持断点续作和实时进度跟踪
-- ============================================================

-- ============================================================
-- 1. 扩展 runs 表
-- ============================================================
ALTER TABLE runs ADD COLUMN IF NOT EXISTS program_yaml TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS current_step_name TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS elapsed_s DOUBLE PRECISION DEFAULT 0;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS last_checkpoint_at TIMESTAMPTZ;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS can_resume BOOLEAN DEFAULT false;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS program_id TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS program_name TEXT;

-- ============================================================
-- 2. 创建实验执行日志表
-- ============================================================
CREATE TABLE IF NOT EXISTS experiment_logs (
    id SERIAL PRIMARY KEY,
    run_id INTEGER REFERENCES runs(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    level TEXT DEFAULT 'info',  -- info, warn, error
    message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exp_logs_run ON experiment_logs(run_id, timestamp DESC);

-- ============================================================
-- 3. 创建实验步骤执行记录表 (用于断点续作)
-- ============================================================
CREATE TABLE IF NOT EXISTS experiment_step_records (
    id SERIAL PRIMARY KEY,
    run_id INTEGER REFERENCES runs(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    step_name TEXT NOT NULL,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',  -- pending, running, completed, skipped, error
    error_message TEXT,
    duration_s DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_step_records_run ON experiment_step_records(run_id, step_index);

-- ============================================================
-- 4. 辅助函数：获取可恢复的运行
-- ============================================================
CREATE OR REPLACE FUNCTION get_resumable_experiment()
RETURNS TABLE (
    run_id INTEGER,
    program_id TEXT,
    program_name TEXT,
    current_step INTEGER,
    total_steps INTEGER,
    elapsed_s DOUBLE PRECISION,
    last_checkpoint_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id,
        r.program_id,
        r.program_name,
        r.current_step,
        r.total_steps,
        r.elapsed_s,
        r.last_checkpoint_at
    FROM runs r
    WHERE r.can_resume = true
      AND r.state IN ('running', 'paused')
    ORDER BY r.last_checkpoint_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. 辅助函数：更新实验进度
-- ============================================================
CREATE OR REPLACE FUNCTION update_experiment_progress(
    p_run_id INTEGER,
    p_current_step INTEGER,
    p_step_name TEXT,
    p_elapsed_s DOUBLE PRECISION
) RETURNS void AS $$
BEGIN
    UPDATE runs
    SET current_step = p_current_step,
        current_step_name = p_step_name,
        elapsed_s = p_elapsed_s,
        last_checkpoint_at = NOW(),
        can_resume = true
    WHERE id = p_run_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 6. 辅助函数：完成实验
-- ============================================================
CREATE OR REPLACE FUNCTION complete_experiment(p_run_id INTEGER)
RETURNS void AS $$
BEGIN
    UPDATE runs
    SET state = 'completed',
        completed_at = NOW(),
        can_resume = false
    WHERE id = p_run_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 7. 辅助函数：中止实验
-- ============================================================
CREATE OR REPLACE FUNCTION abort_experiment(p_run_id INTEGER, p_error TEXT DEFAULT NULL)
RETURNS void AS $$
BEGIN
    UPDATE runs
    SET state = CASE WHEN p_error IS NOT NULL THEN 'error' ELSE 'aborted' END,
        completed_at = NOW(),
        can_resume = false,
        error_message = p_error
    WHERE id = p_run_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 完成
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '11-experiment-state.sql: 实验状态持久化表创建完成';
END $$;
