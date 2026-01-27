-- ============================================================
-- 耗材管理系统数据库迁移
-- ============================================================

-- ============================================================
-- 元数据字段定义表
-- 用于动态定义实体的可配置字段
-- ============================================================
CREATE TABLE IF NOT EXISTS metadata_fields (
    id              SERIAL PRIMARY KEY,
    entity_type     VARCHAR(30) NOT NULL,       -- 'liquid', 'sample', etc.
    field_key       VARCHAR(50) NOT NULL,       -- 字段键名
    field_name      VARCHAR(100) NOT NULL,      -- 显示名称
    field_type      VARCHAR(20) NOT NULL,       -- 'string', 'number', 'boolean', 'select', 'tags', 'image', 'rich_text'
    description     TEXT,                       -- 字段描述
    is_required     BOOLEAN DEFAULT FALSE,      -- 是否必填
    default_value   TEXT,                       -- 默认值
    options         JSONB,                      -- 下拉选项、验证规则等
    display_order   INTEGER DEFAULT 0,          -- 显示顺序
    is_active       BOOLEAN DEFAULT TRUE,       -- 是否启用
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(entity_type, field_key)
);

CREATE INDEX idx_metadata_fields_entity ON metadata_fields(entity_type, is_active);

COMMENT ON TABLE metadata_fields IS '元数据字段定义，支持动态扩展实体属性';

-- ============================================================
-- 样品/液体库表
-- ============================================================
CREATE TABLE IF NOT EXISTS liquids (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,      -- 液体名称
    type            VARCHAR(20) NOT NULL,       -- 'sample', 'rinse', 'other'
    description     TEXT,                       -- 描述
    density         REAL DEFAULT 1.0,           -- 密度 g/ml
    metadata        JSONB DEFAULT '{}',         -- 动态元数据
    is_active       BOOLEAN DEFAULT TRUE,       -- 是否启用
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_liquids_type ON liquids(type, is_active);

COMMENT ON TABLE liquids IS '样品和液体库，支持可配置元数据';

-- ============================================================
-- 液体附件表（图片等）
-- ============================================================
CREATE TABLE IF NOT EXISTS liquid_attachments (
    id              SERIAL PRIMARY KEY,
    liquid_id       INTEGER REFERENCES liquids(id) ON DELETE CASCADE,
    field_key       VARCHAR(50) NOT NULL,       -- 对应 metadata_fields.field_key
    file_type       VARCHAR(20) NOT NULL,       -- 'image', 'document'
    file_name       VARCHAR(255) NOT NULL,      -- 原始文件名
    file_path       VARCHAR(500) NOT NULL,      -- 存储路径
    file_size       INTEGER,                    -- 文件大小 (bytes)
    mime_type       VARCHAR(100),               -- MIME 类型
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_liquid_attachments_liquid ON liquid_attachments(liquid_id);

COMMENT ON TABLE liquid_attachments IS '液体关联的附件（图片等）';

-- ============================================================
-- 泵-液体配置表
-- ============================================================
CREATE TABLE IF NOT EXISTS pump_assignments (
    pump_index      INTEGER PRIMARY KEY CHECK (pump_index >= 0 AND pump_index <= 7),
    liquid_id       INTEGER REFERENCES liquids(id) ON DELETE SET NULL,
    notes           TEXT,                       -- 备注
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 初始化 8 个泵的配置
INSERT INTO pump_assignments (pump_index) VALUES (0), (1), (2), (3), (4), (5), (6), (7)
ON CONFLICT (pump_index) DO NOTHING;

COMMENT ON TABLE pump_assignments IS '蠕动泵与液体的绑定配置';

-- ============================================================
-- 耗材状态表
-- ============================================================
CREATE TABLE IF NOT EXISTS consumables (
    id                      VARCHAR(50) PRIMARY KEY,    -- 'pump_tube_0', 'carbon_filter', 'vacuum_filter'
    name                    VARCHAR(100) NOT NULL,      -- 显示名称
    type                    VARCHAR(30) NOT NULL,       -- 'pump_tube', 'carbon_filter', 'vacuum_filter'
    accumulated_seconds     BIGINT DEFAULT 0,           -- 累积运行秒数
    lifetime_seconds        BIGINT NOT NULL,            -- 设计寿命秒数
    warning_threshold       REAL DEFAULT 0.2,           -- 警告阈值 (剩余比例)
    critical_threshold      REAL DEFAULT 0.05,          -- 危险阈值 (剩余比例)
    last_reset_at           TIMESTAMPTZ DEFAULT NOW(),  -- 上次重置时间
    metadata                JSONB DEFAULT '{}',         -- 其他元数据
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- 初始化耗材记录
INSERT INTO consumables (id, name, type, lifetime_seconds) VALUES
    -- 蠕动泵管 (8个, 默认 100 小时 = 360000 秒)
    ('pump_tube_0', '泵管 #0', 'pump_tube', 360000),
    ('pump_tube_1', '泵管 #1', 'pump_tube', 360000),
    ('pump_tube_2', '泵管 #2', 'pump_tube', 360000),
    ('pump_tube_3', '泵管 #3', 'pump_tube', 360000),
    ('pump_tube_4', '泵管 #4', 'pump_tube', 360000),
    ('pump_tube_5', '泵管 #5', 'pump_tube', 360000),
    ('pump_tube_6', '泵管 #6', 'pump_tube', 360000),
    ('pump_tube_7', '泵管 #7', 'pump_tube', 360000),
    -- 活性炭管 (默认 200 小时 = 720000 秒)
    ('carbon_filter', '活性炭管', 'carbon_filter', 720000),
    -- 真空过滤器 (默认 500 小时 = 1800000 秒)
    ('vacuum_filter', '真空过滤器', 'vacuum_filter', 1800000)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX idx_consumables_type ON consumables(type);

COMMENT ON TABLE consumables IS '耗材状态跟踪';

-- ============================================================
-- 耗材操作历史表
-- ============================================================
CREATE TABLE IF NOT EXISTS consumable_history (
    id                      SERIAL PRIMARY KEY,
    consumable_id           VARCHAR(50) REFERENCES consumables(id) ON DELETE CASCADE,
    action                  VARCHAR(20) NOT NULL,       -- 'reset', 'replace', 'adjust', 'runtime_add'
    old_accumulated_seconds BIGINT,                     -- 操作前累积秒数
    new_accumulated_seconds BIGINT,                     -- 操作后累积秒数
    delta_seconds           BIGINT,                     -- 变化量
    notes                   TEXT,                       -- 备注
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_consumable_history_consumable ON consumable_history(consumable_id, created_at DESC);

COMMENT ON TABLE consumable_history IS '耗材操作历史记录';

-- ============================================================
-- 初始化常用元数据字段
-- ============================================================
INSERT INTO metadata_fields (entity_type, field_key, field_name, field_type, description, display_order, options) VALUES
-- 基础信息
('liquid', 'category', '分类', 'select', '样品分类', 1, 
 '{"options": ["果汁", "酒类", "乳制品", "调味品", "饮料", "其他"]}'),
('liquid', 'origin', '产地', 'string', '样品来源/产地', 2, NULL),
('liquid', 'brand', '品牌', 'string', '品牌名称', 3, NULL),
('liquid', 'batch_no', '批次号', 'string', '生产批次', 4, NULL),

-- 嗅觉语义
('liquid', 'aroma_notes', '香气描述', 'tags', '嗅觉特征标签', 10,
 '{"suggestions": ["果香", "花香", "木香", "烟熏", "酸", "甜", "苦", "辛辣", "清新", "浓郁", "发酵", "焦糖"]}'),
('liquid', 'aroma_intensity', '香气强度', 'number', '1-10 评分', 11,
 '{"min": 1, "max": 10, "step": 1}'),
('liquid', 'flavor_notes', '风味描述', 'rich_text', '详细风味描述', 12, NULL),

-- 图片
('liquid', 'main_image', '主图', 'image', '样品主图片', 20, 
 '{"max_size_mb": 5, "accept": ["image/jpeg", "image/png", "image/webp"]}'),

-- 实验参数建议
('liquid', 'suggested_temp', '建议检测温度', 'number', '摄氏度', 30, 
 '{"min": 0, "max": 100, "unit": "°C"}'),
('liquid', 'suggested_volume', '建议进样量', 'number', '毫升', 31,
 '{"min": 0, "max": 50, "unit": "ml"}')
ON CONFLICT (entity_type, field_key) DO NOTHING;

-- ============================================================
-- 初始化常用液体
-- ============================================================
INSERT INTO liquids (name, type, description, density, metadata) VALUES
-- 清洗液
('蒸馏水', 'rinse', '标准清洗液', 1.0, '{}'),
('75%乙醇', 'rinse', '消毒清洗液', 0.87, '{}'),
-- 示例样品
('苹果汁', 'sample', '100%纯苹果汁', 1.05, '{"category": "果汁", "aroma_notes": ["果香", "甜"]}'),
('橙汁', 'sample', '100%纯橙汁', 1.04, '{"category": "果汁", "aroma_notes": ["果香", "酸"]}')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 触发器：自动更新 updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    -- metadata_fields
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_metadata_fields_updated_at') THEN
        CREATE TRIGGER trg_metadata_fields_updated_at
            BEFORE UPDATE ON metadata_fields
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    
    -- liquids
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_liquids_updated_at') THEN
        CREATE TRIGGER trg_liquids_updated_at
            BEFORE UPDATE ON liquids
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    
    -- pump_assignments
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pump_assignments_updated_at') THEN
        CREATE TRIGGER trg_pump_assignments_updated_at
            BEFORE UPDATE ON pump_assignments
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    
    -- consumables
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_consumables_updated_at') THEN
        CREATE TRIGGER trg_consumables_updated_at
            BEFORE UPDATE ON consumables
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;
