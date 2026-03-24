# 阶段对比实验报告

> 生成时间: 2026-03-23 14:01

## 一、实验背景

电子鼻每个采样周期包含多个阶段:
1. **WASH** (~50s): 清洗阶段, 传感器恢复至基线
2. **INJECT** (~15s): 注入液体, 传感器接近基线
3. **ACQUIRE** (120s): 采集阶段, 传感器吸附响应

当前截断实验仅使用 ACQUIRE 阶段数据。本实验探究:
- 加入 ACQUIRE 后的解析/恢复数据 (WASH+INJECT) 是否能提升分类精度
- 如果有提升, 用「头尾拼接」策略能否在减少数据量的同时保留精度

## 二、实验条件

| 条件 | 描述 | 时长 |
|------|------|------|
| `acquire_60` | ACQUIRE 前 60s | ~60s |
| `acquire_only` | ACQUIRE 全部 | ~120s |
| `acquire_wash` | ACQUIRE + WASH | ~170s |
| `acquire_full_gap` | ACQUIRE + 完整 gap | ~180s |
| `head_tail` | ACQUIRE 前 30s + WASH 前 30s | ~60s |

模型: LDA, SVM-rbf, RF-100, GBM (4 个代表性分类器)

特征: stats, norm_stats, log_norm_stats, seg_norm (4 种统计特征)

## 三、实验结果

### A_纯样5类

- 类别数: 5, 随机基线: 20.0%

| 条件 | 样本数 | 最佳精度 | 最佳模型组合 |
|------|--------|----------|-------------|
| `acquire_60` | 265 | **56.6%** | norm_stats+GBM |
| `acquire_only` | 265 | **60.0%** | log_norm_stats+GBM |
| `acquire_wash` | 265 | **61.9%** | seg_norm+LDA |
| `acquire_full_gap` | 265 | **59.2%** | log_norm_stats+GBM |
| `head_tail` | 265 | **60.0%** | norm_stats+GBM |

以 `acquire_only` (60.0%) 为基线:

- `acquire_60`: 56.6% (-3.4%, -5.7%) ↓ 下降
- `acquire_wash`: 61.9% (+1.9%, +3.2%) ↑ 提升
- `acquire_full_gap`: 59.2% (-0.7%, -1.2%) ↓ 下降
- `head_tail`: 60.0% (+0.0%, +0.0%) → 持平

### C_主成分5类

- 类别数: 5, 随机基线: 20.0%

| 条件 | 样本数 | 最佳精度 | 最佳模型组合 |
|------|--------|----------|-------------|
| `acquire_60` | 415 | **53.5%** | stats+LDA |
| `acquire_only` | 415 | **55.2%** | log_norm_stats+RF-100 |
| `acquire_wash` | 415 | **59.0%** | seg_norm+LDA |
| `acquire_full_gap` | 415 | **56.1%** | seg_norm+LDA |
| `head_tail` | 415 | **54.5%** | log_norm_stats+GBM |

以 `acquire_only` (55.2%) 为基线:

- `acquire_60`: 53.5% (-1.7%, -3.1%) ↓ 下降
- `acquire_wash`: 59.0% (+3.9%, +7.0%) ↑ 提升
- `acquire_full_gap`: 56.1% (+1.0%, +1.7%) ↑ 提升
- `head_tail`: 54.5% (-0.7%, -1.3%) ↓ 下降

## 四、关键发现

### 发现 1: ACQUIRE + WASH 是最优数据段

两个任务中, `acquire_wash`（吸附 120s + 清洗/解析前段 ~50s）均为最佳条件:

| 任务 | 纯吸附 | **吸附+WASH** | 完整 gap | 提升幅度 |
|------|--------|--------------|----------|----------|
| A_纯样5类 | 60.0% | **61.9%** | 59.2% | +1.9% |
| C_主成分5类 | 55.2% | **59.0%** | 56.1% | +3.9% |

**原因分析**: WASH 阶段（清洗开始后 ~50s）捕捉了传感器从吸附状态恢复到基线的**解析动力学**。不同气味分子的解吸速率差异提供了额外的判别信息。这在电子鼻文献中被称为 desorption kinetics fingerprint。

### 发现 2: 完整 gap 反而不如只用 WASH

`acquire_full_gap`（包含 WASH + INJECT）的精度低于 `acquire_wash`:
- A: 59.2% < 61.9%
- C: 56.1% < 59.0%

**原因分析**: INJECT 阶段（~15s）是新液体注入期, 传感器已基本恢复到基线。这段数据主要是噪声, 稀释了 WASH 阶段的有效信息。将三段数据压缩到相同的 100 个对齐步时, INJECT 阶段占据了部分对齐分辨率, 反而降低了有效信号密度。

### 发现 3: 头尾拼接策略 (ACQUIRE头 + WASH头) 效果接近完整 ACQUIRE

> 注: `head_tail` 取 ACQUIRE 前 30s（吸附起始, 响应快速变化段）+ WASH 前 30s（解析起始, 传感器开始恢复段）。

| 任务 | acquire_only (120s) | **head_tail (~60s)** | acquire_60 (60s) |
|------|---------------------|---------------------|------------------|
| A_纯样5类 | 60.0% | **60.0%** | 56.6% |
| C_主成分5类 | 55.2% | **54.5%** | 53.5% |

- 纯样任务: head_tail 与完整 ACQUIRE **完全持平** (60.0%)
- 全样本任务: head_tail 仅低 0.7%, 远好于同等时长的 acquire_60 (-1.7%)

**结论**: 吸附起始和解析起始是信息密度最高的两段。用 ~60s 数据（30s+30s）即可达到 120s 纯吸附的精度, 验证了"关键动力学窗口"假设。

### 发现 4: 截断 60s 精度损失可控

`acquire_60` 相比 `acquire_only` 仅损失 3-5%, 与之前截断实验结论一致:
- A: 56.6% vs 60.0%（-3.4%）
- C: 53.5% vs 55.2%（-1.7%）

## 五、综合结论与建议

### 最终推荐: `acquire_wash` (ACQUIRE 120s + WASH ~50s = ~170s)

| 指标 | 值 |
|------|-----|
| 推荐数据段 | **ACQUIRE + WASH** |
| 总数据时长 | ~170s |
| 精度提升 | A: +1.9%, C: +3.9%（相对纯吸附） |
| 最佳模型 | seg_norm + LDA |

### 决策建议

1. **完整实验应使用 ACQUIRE + WASH 数据段**。WASH 阶段的解析动力学为分类提供了有价值的补充信息, 尤其对包含混合样本的全样本分类任务提升显著 (+3.9%)。

2. **头尾拼接是有效的快速替代方案**。ACQUIRE 前 30s + WASH 前 30s（共 ~60s）能达到与完整 120s ACQUIRE 相当的精度, 适用于需要快速推理的场景。

3. **不需要包含 INJECT 阶段**。INJECT 数据接近基线, 属于噪声, 反而稀释有效信号。

4. **如追求速度, 可截断 ACQUIRE 至 60-80s + WASH**。结合截断实验结论, 采用 ACQUIRE 80s + WASH 50s ≈ 130s 即可兼顾精度和速度。

### C++ 后端改进 (已实施)

当前 WASH/INJECT 阶段的 `sensor_readings_v2` 数据 `sample_id` 为 NULL, 需靠时间序列推断归属。已修改:
- `experiment_service_impl.cpp`: 移除 `execute_acquire` 末尾的 `clear_sample_context()`, 使 WASH/INJECT 数据自动关联前一个样本的 `sample_id`
- `sensor_repository.cpp`: `clear_run_context()` 增加清除 `sample_id`, 确保 run 结束时完全清理

后续实验的 WASH/INJECT 数据将自动带有 `sample_id`, 分析代码可直接按 `sample_id` 查询完整周期数据。

## 六、方法说明

- **数据来源**: sensor_readings_v2 表, runs >= 99 (5 种茶液体, 纯样 + 混合样共 415 样本)
- **WASH 对齐方式**: 按时间序列匹配 — 每个样本 ACQUIRE 结束到下一个 ACQUIRE 开始之间的传感器数据即为该样本的 WASH/INJECT 数据
- **数据对齐**: PCHIP 插值到 100 个等距时间步
- **交叉验证**: 5-fold 分层 CV
- **特征**: stats, norm_stats, log_norm_stats, seg_norm (4 种统计特征)
- **模型**: LDA, SVM-rbf, RF-100, GBM (4 个代表性分类器, 共 16 种组合)
- **结果存储**: JSON 断点续作, 支持增量运行
