-- ============================================================
-- 12-fix-normalized-frames-nullable.sql
-- 修复 normalized_frames 表的 NOT NULL 约束问题
-- 允许 run_id 和 phase_name 为 NULL（使用 sample_id 替代）
-- ============================================================

-- 1. 修改 normalized_frames 表：允许 run_id 和 phase_name 为 NULL
ALTER TABLE normalized_frames ALTER COLUMN run_id DROP NOT NULL;
ALTER TABLE normalized_frames ALTER COLUMN phase_name DROP NOT NULL;

-- 2. 修改 normalized_frames_meta 表：允许 run_id 和 phase_name 为 NULL
ALTER TABLE normalized_frames_meta ALTER COLUMN run_id DROP NOT NULL;
ALTER TABLE normalized_frames_meta ALTER COLUMN phase_name DROP NOT NULL;

-- 3. 确保 sample_id 有 NOT NULL 约束（新的主索引）
-- 注意：不能直接 ALTER，因为可能有旧数据
-- ALTER TABLE normalized_frames ALTER COLUMN sample_id SET NOT NULL;
-- ALTER TABLE normalized_frames_meta ALTER COLUMN sample_id SET NOT NULL;

-- ============================================================
-- 完成
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '12-fix-normalized-frames-nullable.sql: 修复完成';
    RAISE NOTICE '  - normalized_frames.run_id 和 phase_name 允许 NULL';
    RAISE NOTICE '  - normalized_frames_meta.run_id 和 phase_name 允许 NULL';
END $$;
