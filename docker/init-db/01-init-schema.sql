-- E-Nose 数据库初始化脚本
-- 启用 TimescaleDB 扩展
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ============================================================
-- 实验运行记录表
-- ============================================================
CREATE TABLE IF NOT EXISTS runs (
    id              SERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    state           TEXT NOT NULL DEFAULT 'running',  -- running, completed, error, aborted
    config_json     JSONB NOT NULL,                   -- 测试配置
    current_step    INTEGER DEFAULT 0,
    total_steps     INTEGER DEFAULT 0,
    error_message   TEXT,
    metadata        JSONB                             -- 其他元数据
);

CREATE INDEX idx_runs_state ON runs(state);
CREATE INDEX idx_runs_created_at ON runs(created_at DESC);

-- ============================================================
-- 进样测试结果表
-- ============================================================
CREATE TABLE IF NOT EXISTS test_results (
    id                      SERIAL PRIMARY KEY,
    run_id                  INTEGER REFERENCES runs(id) ON DELETE CASCADE,
    time                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    param_set_id            INTEGER NOT NULL,
    param_set_name          TEXT NOT NULL,
    cycle                   INTEGER NOT NULL,
    total_volume            REAL NOT NULL,      -- mm
    pump2_volume            REAL NOT NULL,
    pump3_volume            REAL NOT NULL,
    pump4_volume            REAL NOT NULL,
    pump5_volume            REAL NOT NULL,
    speed                   REAL NOT NULL,      -- mm/s
    empty_weight            REAL NOT NULL,      -- g
    full_weight             REAL NOT NULL,      -- g
    injected_weight         REAL NOT NULL,      -- g
    drain_duration_ms       BIGINT,
    wait_empty_duration_ms  BIGINT,
    inject_duration_ms      BIGINT,
    wait_stable_duration_ms BIGINT,
    total_duration_ms       BIGINT
);

CREATE INDEX idx_test_results_run_id ON test_results(run_id);
CREATE INDEX idx_test_results_time ON test_results(time DESC);

-- ============================================================
-- 传感器原始数据表 (时序超表)
-- ============================================================
CREATE TABLE IF NOT EXISTS sensor_readings (
    time        TIMESTAMPTZ NOT NULL,
    run_id      INTEGER,
    device_id   TEXT DEFAULT 'default',
    channels    BYTEA NOT NULL,                 -- 16 x float32 = 64 bytes
    metadata    JSONB
);

-- 转换为 TimescaleDB 超表
SELECT create_hypertable('sensor_readings', 'time', 
    chunk_time_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- 索引
CREATE INDEX idx_sensor_readings_run_id ON sensor_readings(run_id, time DESC);

-- 压缩策略 (7天后压缩)
ALTER TABLE sensor_readings SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'run_id,device_id',
    timescaledb.compress_orderby = 'time DESC'
);
SELECT add_compression_policy('sensor_readings', INTERVAL '7 days', if_not_exists => TRUE);

-- 保留策略 (可选: 90天后删除原始数据)
-- SELECT add_retention_policy('sensor_readings', INTERVAL '90 days', if_not_exists => TRUE);

-- ============================================================
-- 传感器数据连续聚合视图 (每分钟统计)
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS sensor_stats_1m
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('1 minute', time) AS bucket,
    run_id,
    device_id,
    COUNT(*) AS sample_count,
    -- 使用函数解析 channels 字节数据的统计
    -- 注意: 实际使用时需要用自定义函数或在应用层处理
    AVG(1) AS placeholder_avg
FROM sensor_readings
GROUP BY bucket, run_id, device_id
WITH NO DATA;

-- 连续聚合刷新策略
SELECT add_continuous_aggregate_policy('sensor_stats_1m',
    start_offset => INTERVAL '1 hour',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute',
    if_not_exists => TRUE
);

-- ============================================================
-- 系统日志表
-- ============================================================
CREATE TABLE IF NOT EXISTS system_logs (
    time        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    level       TEXT NOT NULL,          -- debug, info, warning, error
    source      TEXT NOT NULL,          -- 模块名
    message     TEXT NOT NULL,
    context     JSONB
);

SELECT create_hypertable('system_logs', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- 自动清理30天前的日志
SELECT add_retention_policy('system_logs', INTERVAL '30 days', if_not_exists => TRUE);

-- ============================================================
-- 辅助函数: 解析 channels 字节数组
-- ============================================================
CREATE OR REPLACE FUNCTION parse_channels(data BYTEA)
RETURNS REAL[] AS $$
DECLARE
    result REAL[];
    i INTEGER;
BEGIN
    result := ARRAY[]::REAL[];
    FOR i IN 0..15 LOOP
        result := array_append(result, 
            ('x' || encode(substring(data from (i*4+1) for 4), 'hex'))::bit(32)::int::real
        );
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- 视图: 最近传感器数据 (带解析的通道值)
-- ============================================================
CREATE OR REPLACE VIEW recent_sensor_data AS
SELECT 
    time,
    run_id,
    device_id,
    parse_channels(channels) AS channels_array
FROM sensor_readings
WHERE time > NOW() - INTERVAL '1 hour'
ORDER BY time DESC;

-- ============================================================
-- 称重过程数据表 (时序超表)
-- 用于绘制测试过程中的称重曲线
-- ============================================================
CREATE TABLE IF NOT EXISTS weight_samples (
    time        TIMESTAMPTZ NOT NULL,
    run_id      INTEGER REFERENCES runs(id) ON DELETE CASCADE,
    cycle       INTEGER,                    -- 当前循环号
    phase       TEXT,                       -- 阶段: drain, wait_empty, inject, wait_stable
    weight      REAL NOT NULL,              -- 重量 (g)
    is_stable   BOOLEAN DEFAULT FALSE,      -- 是否稳定
    trend       TEXT                        -- 趋势: stable, increasing, decreasing
);

SELECT create_hypertable('weight_samples', 'time',
    chunk_time_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

CREATE INDEX idx_weight_samples_run_id ON weight_samples(run_id, time DESC);
CREATE INDEX idx_weight_samples_cycle ON weight_samples(run_id, cycle);

-- 压缩策略 (3天后压缩)
ALTER TABLE weight_samples SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'run_id,cycle',
    timescaledb.compress_orderby = 'time DESC'
);
SELECT add_compression_policy('weight_samples', INTERVAL '3 days', if_not_exists => TRUE);

-- 保留策略 (30天后删除)
SELECT add_retention_policy('weight_samples', INTERVAL '30 days', if_not_exists => TRUE);

COMMENT ON TABLE runs IS '实验运行记录';
COMMENT ON TABLE test_results IS '进样测试结果';
COMMENT ON TABLE sensor_readings IS '传感器原始时序数据 (16通道 float32, 10Hz)';
COMMENT ON TABLE weight_samples IS '称重过程时序数据 (用于绘制曲线)';
COMMENT ON TABLE system_logs IS '系统日志';
