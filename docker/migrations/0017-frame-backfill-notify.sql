-- ============================================================
-- 迁移: 0016-frame-backfill-notify.sql
-- 描述: 样本完成时自动发送 PG NOTIFY，用于触发帧自动生成
-- ============================================================

-- ============================================================
-- 1. 创建通知函数：当 samples.end_time_ms 从 NULL 变为非 NULL 时触发
-- ============================================================
CREATE OR REPLACE FUNCTION notify_sample_completed()
RETURNS TRIGGER AS $$
BEGIN
    -- 只在 end_time_ms 从 NULL 变为非 NULL 时触发（样本采集完成）
    IF OLD.end_time_ms IS NULL AND NEW.end_time_ms IS NOT NULL THEN
        PERFORM pg_notify(
            'sample_completed',
            json_build_object(
                'sample_id', NEW.id,
                'run_id', NEW.run_id,
                'end_time_ms', NEW.end_time_ms
            )::text
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 2. 创建触发器
-- ============================================================
DROP TRIGGER IF EXISTS trg_sample_completed ON samples;

CREATE TRIGGER trg_sample_completed
    AFTER UPDATE OF end_time_ms ON samples
    FOR EACH ROW
    EXECUTE FUNCTION notify_sample_completed();

-- ============================================================
-- 3. 验证
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '0016-frame-backfill-notify.sql: 样本完成通知触发器已创建';
    RAISE NOTICE '  - 函数: notify_sample_completed()';
    RAISE NOTICE '  - 触发器: trg_sample_completed (AFTER UPDATE OF end_time_ms ON samples)';
    RAISE NOTICE '  - 通道: sample_completed';
END $$;
