-- ============================================================
-- 0008-tags.sql - 标签系统
-- 来源: 08-tags.sql
-- ============================================================

-- ============================================================
-- 标签表
-- ============================================================
CREATE TABLE IF NOT EXISTS tags (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(50) NOT NULL UNIQUE,    -- 标签名称
    category        VARCHAR(30) DEFAULT 'aroma',    -- 标签分类：aroma, flavor, texture 等
    color           VARCHAR(20),                    -- 可选：标签颜色 (#hex)
    usage_count     INTEGER DEFAULT 0,              -- 使用次数（缓存）
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category);
CREATE INDEX IF NOT EXISTS idx_tags_usage ON tags(usage_count DESC);

COMMENT ON TABLE tags IS '标签表，支持标签去重和统计';

-- ============================================================
-- 液体-标签关系表
-- ============================================================
CREATE TABLE IF NOT EXISTS liquid_tags (
    liquid_id       INTEGER NOT NULL REFERENCES liquids(id) ON DELETE CASCADE,
    tag_id          INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    field_key       VARCHAR(50) DEFAULT 'aroma_notes',  -- 标签所属字段
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (liquid_id, tag_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_liquid_tags_liquid ON liquid_tags(liquid_id);
CREATE INDEX IF NOT EXISTS idx_liquid_tags_tag ON liquid_tags(tag_id);

COMMENT ON TABLE liquid_tags IS '液体与标签的多对多关系';

-- ============================================================
-- 触发器：更新标签使用计数
-- ============================================================
CREATE OR REPLACE FUNCTION update_tag_usage_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE tags SET usage_count = usage_count + 1, updated_at = NOW()
        WHERE id = NEW.tag_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE tags SET usage_count = GREATEST(0, usage_count - 1), updated_at = NOW()
        WHERE id = OLD.tag_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_liquid_tags_usage ON liquid_tags;
CREATE TRIGGER trg_liquid_tags_usage
    AFTER INSERT OR DELETE ON liquid_tags
    FOR EACH ROW
    EXECUTE FUNCTION update_tag_usage_count();

-- ============================================================
-- 初始化常用标签
-- ============================================================
INSERT INTO tags (name, category) VALUES
-- 香气类型
('果香', 'aroma'),
('花香', 'aroma'),
('木香', 'aroma'),
('烟熏', 'aroma'),
('草本', 'aroma'),
('坚果', 'aroma'),
('焦糖', 'aroma'),
('奶香', 'aroma'),
('发酵', 'aroma'),
('海洋', 'aroma'),
-- 味觉特征
('酸', 'flavor'),
('甜', 'flavor'),
('苦', 'flavor'),
('辛辣', 'flavor'),
('咸', 'flavor'),
('鲜', 'flavor'),
-- 感官强度
('清新', 'intensity'),
('浓郁', 'intensity'),
('淡雅', 'intensity'),
('醇厚', 'intensity')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 迁移现有数据：从 metadata JSON 提取标签到关系表
-- ============================================================
DO $$
DECLARE
    liquid_rec RECORD;
    tag_name TEXT;
    tag_id_val INTEGER;
BEGIN
    -- 遍历所有有 aroma_notes 的液体
    FOR liquid_rec IN 
        SELECT id, metadata->'aroma_notes' as aroma_notes
        FROM liquids 
        WHERE metadata ? 'aroma_notes' 
          AND jsonb_typeof(metadata->'aroma_notes') = 'array'
    LOOP
        -- 遍历每个标签
        FOR tag_name IN SELECT jsonb_array_elements_text(liquid_rec.aroma_notes)
        LOOP
            -- 确保标签存在
            INSERT INTO tags (name, category) 
            VALUES (tag_name, 'aroma')
            ON CONFLICT (name) DO NOTHING;
            
            -- 获取标签 ID
            SELECT id INTO tag_id_val FROM tags WHERE name = tag_name;
            
            -- 创建关系
            INSERT INTO liquid_tags (liquid_id, tag_id, field_key)
            VALUES (liquid_rec.id, tag_id_val, 'aroma_notes')
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

-- ============================================================
-- 辅助函数：获取液体的标签数组
-- ============================================================
CREATE OR REPLACE FUNCTION get_liquid_tags(p_liquid_id INTEGER, p_field_key VARCHAR DEFAULT 'aroma_notes')
RETURNS TEXT[] AS $$
    SELECT COALESCE(array_agg(t.name ORDER BY t.name), '{}')
    FROM liquid_tags lt
    JOIN tags t ON t.id = lt.tag_id
    WHERE lt.liquid_id = p_liquid_id AND lt.field_key = p_field_key;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- 辅助函数：设置液体的标签（替换现有）
-- ============================================================
CREATE OR REPLACE FUNCTION set_liquid_tags(
    p_liquid_id INTEGER, 
    p_tag_names TEXT[], 
    p_field_key VARCHAR DEFAULT 'aroma_notes'
) RETURNS VOID AS $$
DECLARE
    tag_name TEXT;
    tag_id_val INTEGER;
BEGIN
    -- 删除现有关系
    DELETE FROM liquid_tags 
    WHERE liquid_id = p_liquid_id AND field_key = p_field_key;
    
    -- 添加新标签
    FOREACH tag_name IN ARRAY p_tag_names
    LOOP
        -- 确保标签存在
        INSERT INTO tags (name, category) 
        VALUES (trim(tag_name), 'aroma')
        ON CONFLICT (name) DO NOTHING;
        
        -- 获取标签 ID
        SELECT id INTO tag_id_val FROM tags WHERE name = trim(tag_name);
        
        -- 创建关系
        IF tag_id_val IS NOT NULL THEN
            INSERT INTO liquid_tags (liquid_id, tag_id, field_key)
            VALUES (p_liquid_id, tag_id_val, p_field_key)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
