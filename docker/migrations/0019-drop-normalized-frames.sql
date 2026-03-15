-- ============================================================
-- 0019-drop-normalized-frames.sql - 移除归一化帧表
-- 
-- 原因: 归一化帧现在仅通过 Redis 缓存按需生成 (sample_id 接口)，
--       不再持久化到 PostgreSQL。
-- 影响: 删除 normalized_frames 和 normalized_frames_meta 表
-- 注意: interpolation_method 枚举保留，仍被其他代码引用
-- ============================================================

-- 删除表（CASCADE 会自动删除相关索引和约束）
DROP TABLE IF EXISTS normalized_frames CASCADE;
DROP TABLE IF EXISTS normalized_frames_meta CASCADE;
