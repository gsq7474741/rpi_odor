-- ============================================================
-- 泵容量与余量监控扩展
-- ============================================================

-- 扩展 pump_assignments 表，添加容量相关字段
ALTER TABLE pump_assignments 
    ADD COLUMN IF NOT EXISTS initial_volume_ml DOUBLE PRECISION DEFAULT 0,
    ADD COLUMN IF NOT EXISTS consumed_volume_ml DOUBLE PRECISION DEFAULT 0,
    ADD COLUMN IF NOT EXISTS low_volume_threshold_ml DOUBLE PRECISION DEFAULT 10;

COMMENT ON COLUMN pump_assignments.initial_volume_ml IS '初始容量 (ml)';
COMMENT ON COLUMN pump_assignments.consumed_volume_ml IS '已消耗量 (ml)';
COMMENT ON COLUMN pump_assignments.low_volume_threshold_ml IS '低量预警阈值 (ml)';

-- ============================================================
-- 泵液体消耗历史表
-- ============================================================
CREATE TABLE IF NOT EXISTS pump_consumption_history (
    id              SERIAL PRIMARY KEY,
    pump_index      INTEGER NOT NULL CHECK (pump_index >= 0 AND pump_index <= 7),
    liquid_id       INTEGER REFERENCES liquids(id) ON DELETE SET NULL,
    volume_ml       DOUBLE PRECISION NOT NULL,      -- 消耗量 (ml)
    experiment_id   INTEGER,                        -- 关联的实验ID（如果有）
    notes           TEXT,                           -- 备注
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pump_consumption_history_pump ON pump_consumption_history(pump_index, created_at DESC);
CREATE INDEX idx_pump_consumption_history_liquid ON pump_consumption_history(liquid_id);

COMMENT ON TABLE pump_consumption_history IS '泵液体消耗历史记录';

-- ============================================================
-- 辅助函数：计算泵剩余容量
-- ============================================================
CREATE OR REPLACE FUNCTION get_pump_remaining_ml(p_pump_index INTEGER)
RETURNS DOUBLE PRECISION AS $$
DECLARE
    v_initial DOUBLE PRECISION;
    v_consumed DOUBLE PRECISION;
BEGIN
    SELECT initial_volume_ml, consumed_volume_ml 
    INTO v_initial, v_consumed
    FROM pump_assignments 
    WHERE pump_index = p_pump_index;
    
    IF v_initial IS NULL THEN
        RETURN 0;
    END IF;
    
    RETURN GREATEST(0, v_initial - COALESCE(v_consumed, 0));
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 辅助函数：添加泵消耗量
-- ============================================================
CREATE OR REPLACE FUNCTION add_pump_consumption(
    p_pump_index INTEGER,
    p_volume_ml DOUBLE PRECISION,
    p_experiment_id INTEGER DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_liquid_id INTEGER;
BEGIN
    -- 获取当前绑定的液体
    SELECT liquid_id INTO v_liquid_id
    FROM pump_assignments
    WHERE pump_index = p_pump_index;
    
    -- 更新消耗量
    UPDATE pump_assignments
    SET consumed_volume_ml = COALESCE(consumed_volume_ml, 0) + p_volume_ml
    WHERE pump_index = p_pump_index;
    
    -- 记录历史
    INSERT INTO pump_consumption_history (pump_index, liquid_id, volume_ml, experiment_id)
    VALUES (p_pump_index, v_liquid_id, p_volume_ml, p_experiment_id);
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 辅助函数：重置泵容量（补充液体后调用）
-- ============================================================
CREATE OR REPLACE FUNCTION reset_pump_volume(
    p_pump_index INTEGER,
    p_new_volume_ml DOUBLE PRECISION,
    p_threshold_ml DOUBLE PRECISION DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE pump_assignments
    SET 
        initial_volume_ml = p_new_volume_ml,
        consumed_volume_ml = 0,
        low_volume_threshold_ml = COALESCE(p_threshold_ml, low_volume_threshold_ml)
    WHERE pump_index = p_pump_index;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
