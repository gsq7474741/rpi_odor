-- ============================================================
-- 0020-disable-compression.sql
-- 取消 TimescaleDB 压缩和保留策略，数据永不过期
-- ============================================================

-- ============================================================
-- 1. 移除自动压缩策略
-- ============================================================
SELECT remove_compression_policy('sensor_readings_v2', if_exists => true);
SELECT remove_compression_policy('weight_samples', if_exists => true);

-- ============================================================
-- 2. 移除保留策略（数据永不过期）
-- ============================================================
SELECT remove_retention_policy('system_logs', if_exists => true);
SELECT remove_retention_policy('weight_samples', if_exists => true);

-- ============================================================
-- 3. 解压所有已压缩的 chunk
-- ============================================================

-- sensor_readings_v2: 解压所有压缩 chunk
DO $$
DECLARE
    chunk_name regclass;
    cnt int := 0;
BEGIN
    FOR chunk_name IN
        SELECT format('%I.%I', chunk_schema, chunk_name)::regclass
        FROM timescaledb_information.chunks
        WHERE hypertable_name = 'sensor_readings_v2'
          AND is_compressed = true
    LOOP
        PERFORM decompress_chunk(chunk_name);
        cnt := cnt + 1;
    END LOOP;
    RAISE NOTICE 'sensor_readings_v2: 解压 % 个 chunk', cnt;
END $$;

-- weight_samples: 解压所有压缩 chunk
DO $$
DECLARE
    chunk_name regclass;
    cnt int := 0;
BEGIN
    FOR chunk_name IN
        SELECT format('%I.%I', chunk_schema, chunk_name)::regclass
        FROM timescaledb_information.chunks
        WHERE hypertable_name = 'weight_samples'
          AND is_compressed = true
    LOOP
        PERFORM decompress_chunk(chunk_name);
        cnt := cnt + 1;
    END LOOP;
    RAISE NOTICE 'weight_samples: 解压 % 个 chunk', cnt;
END $$;

-- ============================================================
-- 4. 关闭压缩功能
-- ============================================================
ALTER TABLE sensor_readings_v2 SET (timescaledb.compress = false);
ALTER TABLE weight_samples SET (timescaledb.compress = false);

-- ============================================================
-- 完成
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '0020-disable-compression.sql: 压缩和保留策略已全部移除，数据永不过期';
END $$;
