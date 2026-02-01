-- ============================================================
-- 加热配置表: 存储加热曲线预设
-- ============================================================
CREATE TABLE IF NOT EXISTS heater_profiles (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,      -- 预设名称 (e.g., 'constant_320', 'temp_scan')
    description     TEXT,                      -- 描述
    
    -- 加热曲线 (10步)
    temps           SMALLINT[] NOT NULL,       -- 温度序列 (°C), 长度 1-10
    durs            SMALLINT[] NOT NULL,       -- 持续时间 (×140ms), 长度同 temps
    
    -- 预热配置
    preheat_mode    TEXT NOT NULL DEFAULT 'cycles',  -- 'cycles' 或 'duration'
    preheat_cycles  SMALLINT DEFAULT 3,        -- 预热周期数 (恒温模式)
    preheat_duration_s SMALLINT DEFAULT 60,    -- 预热时间秒 (温度扫描模式)
    
    -- 元数据
    is_builtin      BOOLEAN DEFAULT FALSE,     -- 是否内置预设
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    
    -- 约束: temps 和 durs 长度必须相等
    CONSTRAINT temps_durs_length CHECK (array_length(temps, 1) = array_length(durs, 1)),
    CONSTRAINT temps_length CHECK (array_length(temps, 1) BETWEEN 1 AND 10)
);

-- 插入内置预设
INSERT INTO heater_profiles (name, description, temps, durs, preheat_mode, preheat_cycles, preheat_duration_s, is_builtin) VALUES
    ('constant_320', '恒温 320°C - 稳定检测，需预热', 
     ARRAY[320,320,320,320,320,320,320,320,320,320]::SMALLINT[], 
     ARRAY[5,5,5,5,5,5,5,5,5,5]::SMALLINT[], 
     'cycles', 3, NULL, TRUE),
    ('temp_scan_100_350', '温度扫描 100-350°C - 温度调制，预热影响小', 
     ARRAY[100,150,200,250,300,350,320,280,240,200]::SMALLINT[], 
     ARRAY[3,3,3,3,3,3,3,3,3,3]::SMALLINT[], 
     'duration', NULL, 60, TRUE),
    ('pulse_fast', '脉冲式 - 快速响应', 
     ARRAY[320,100,320,100,320,100,320,100,320,100]::SMALLINT[], 
     ARRAY[2,1,2,1,2,1,2,1,2,1]::SMALLINT[], 
     'cycles', 2, NULL, TRUE),
    ('low_power', '低功耗 200°C - 长期监测', 
     ARRAY[200,200,200,200,200,200,200,200,200,200]::SMALLINT[], 
     ARRAY[10,10,10,10,10,10,10,10,10,10]::SMALLINT[], 
     'cycles', 5, NULL, TRUE)
ON CONFLICT (name) DO NOTHING;
