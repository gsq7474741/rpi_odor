-- 添加 pump0/1/6/7 列到 test_results 表
-- 这个迁移脚本为现有表添加新的泵列

-- 添加新列 (如果不存在)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='test_results' AND column_name='pump0_volume') THEN
        ALTER TABLE test_results ADD COLUMN pump0_volume REAL DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='test_results' AND column_name='pump1_volume') THEN
        ALTER TABLE test_results ADD COLUMN pump1_volume REAL DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='test_results' AND column_name='pump6_volume') THEN
        ALTER TABLE test_results ADD COLUMN pump6_volume REAL DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='test_results' AND column_name='pump7_volume') THEN
        ALTER TABLE test_results ADD COLUMN pump7_volume REAL DEFAULT 0;
    END IF;
END $$;
