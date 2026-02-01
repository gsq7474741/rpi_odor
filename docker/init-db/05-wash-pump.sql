-- ============================================================
-- 清洗泵配置表
-- 用于区分样品泵和清洗泵，清洗泵只能绑定 rinse 类型的液体
-- ============================================================

-- 创建清洗泵配置表
CREATE TABLE IF NOT EXISTS wash_pump_assignments (
    pump_index INTEGER PRIMARY KEY CHECK (pump_index >= 0),
    liquid_id INTEGER REFERENCES liquids(id) ON DELETE SET NULL,
    initial_volume_ml DOUBLE PRECISION DEFAULT 0,
    consumed_volume_ml DOUBLE PRECISION DEFAULT 0,
    low_volume_threshold_ml DOUBLE PRECISION DEFAULT 10,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建更新时间触发器
CREATE OR REPLACE FUNCTION update_wash_pump_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wash_pump_updated_at_trigger ON wash_pump_assignments;
CREATE TRIGGER wash_pump_updated_at_trigger
    BEFORE UPDATE ON wash_pump_assignments
    FOR EACH ROW
    EXECUTE FUNCTION update_wash_pump_updated_at();

-- 添加约束：清洗泵只能绑定 rinse 类型的液体
CREATE OR REPLACE FUNCTION check_wash_pump_liquid_type()
RETURNS TRIGGER AS $$
DECLARE
    liquid_type VARCHAR(20);
BEGIN
    IF NEW.liquid_id IS NOT NULL THEN
        SELECT type INTO liquid_type FROM liquids WHERE id = NEW.liquid_id;
        IF liquid_type IS NULL THEN
            RAISE EXCEPTION '液体 ID % 不存在', NEW.liquid_id;
        END IF;
        IF liquid_type != 'rinse' THEN
            RAISE EXCEPTION '清洗泵只能绑定清洗液 (rinse 类型)，当前液体类型为: %', liquid_type;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wash_pump_liquid_type_check ON wash_pump_assignments;
CREATE TRIGGER wash_pump_liquid_type_check
    BEFORE INSERT OR UPDATE ON wash_pump_assignments
    FOR EACH ROW
    EXECUTE FUNCTION check_wash_pump_liquid_type();

-- 添加约束：样品泵不能绑定 rinse 类型的液体
CREATE OR REPLACE FUNCTION check_sample_pump_liquid_type()
RETURNS TRIGGER AS $$
DECLARE
    liquid_type VARCHAR(20);
BEGIN
    IF NEW.liquid_id IS NOT NULL THEN
        SELECT type INTO liquid_type FROM liquids WHERE id = NEW.liquid_id;
        IF liquid_type = 'rinse' THEN
            RAISE EXCEPTION '样品泵不能绑定清洗液 (rinse 类型)，请使用清洗泵';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sample_pump_liquid_type_check ON pump_assignments;
CREATE TRIGGER sample_pump_liquid_type_check
    BEFORE INSERT OR UPDATE ON pump_assignments
    FOR EACH ROW
    EXECUTE FUNCTION check_sample_pump_liquid_type();

-- 初始化默认清洗泵 (pump_index 0 为清洗泵)
INSERT INTO wash_pump_assignments (pump_index, notes)
VALUES (0, '默认清洗泵')
ON CONFLICT (pump_index) DO NOTHING;

-- 辅助函数：获取清洗泵剩余容量
CREATE OR REPLACE FUNCTION get_wash_pump_remaining_ml(p_pump_index INTEGER)
RETURNS DOUBLE PRECISION AS $$
DECLARE
    remaining DOUBLE PRECISION;
BEGIN
    SELECT initial_volume_ml - consumed_volume_ml INTO remaining
    FROM wash_pump_assignments
    WHERE pump_index = p_pump_index;
    
    RETURN COALESCE(remaining, 0);
END;
$$ LANGUAGE plpgsql;

-- 辅助函数：添加清洗泵消耗记录
CREATE OR REPLACE FUNCTION add_wash_pump_consumption(
    p_pump_index INTEGER,
    p_volume_ml DOUBLE PRECISION
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE wash_pump_assignments
    SET consumed_volume_ml = consumed_volume_ml + p_volume_ml
    WHERE pump_index = p_pump_index;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- 辅助函数：重置清洗泵容量
CREATE OR REPLACE FUNCTION reset_wash_pump_volume(
    p_pump_index INTEGER,
    p_new_volume_ml DOUBLE PRECISION
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE wash_pump_assignments
    SET initial_volume_ml = p_new_volume_ml,
        consumed_volume_ml = 0
    WHERE pump_index = p_pump_index;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- 视图：清洗泵完整信息（包含液体详情）
CREATE OR REPLACE VIEW wash_pump_assignments_view AS
SELECT 
    wpa.pump_index,
    wpa.liquid_id,
    l.name AS liquid_name,
    l.type AS liquid_type,
    wpa.initial_volume_ml,
    wpa.consumed_volume_ml,
    (wpa.initial_volume_ml - wpa.consumed_volume_ml) AS remaining_volume_ml,
    wpa.low_volume_threshold_ml,
    (wpa.initial_volume_ml - wpa.consumed_volume_ml) <= wpa.low_volume_threshold_ml AS is_low_volume,
    wpa.notes,
    wpa.created_at,
    wpa.updated_at
FROM wash_pump_assignments wpa
LEFT JOIN liquids l ON wpa.liquid_id = l.id;

-- 确保有 rinse 类型的液体可用
INSERT INTO liquids (name, type, description)
VALUES ('蒸馏水', 'rinse', '用于清洗管路的蒸馏水')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE wash_pump_assignments IS '清洗泵配置表，用于绑定清洗液体';
COMMENT ON COLUMN wash_pump_assignments.pump_index IS '清洗泵索引，从0开始';
COMMENT ON COLUMN wash_pump_assignments.liquid_id IS '绑定的液体ID，必须为rinse类型';
