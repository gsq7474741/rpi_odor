"""茶叶拼配电子鼻论文 — v2 实验代码包

基于 paper_experiments 的 v2 实验链整理而成，仅保留 v2 论文所需模块。

基础层:
  config          - 全局配置 (路径、超参、茶名映射、图表样式)
  data            - 数据加载门面 (复用 truncation_study 的 DB/缓存/对齐)
  viz             - 共享可视化工具 (matplotlib/seaborn, 出版级图表)
  baselines       - ML/DL 基线模型 (TS2Vec, AE, SimCLR, 1D-CNN 等)

核心算法模块:
  nldi             - NLDI 非线性偏差指数计算 + 稳健统计检验
  carl_training    - CARL 对比表征学习 (模型 + 训练)
  carl_finetune    - CARL 分类微调
  backbones        - 端到端 DL 骨干网络 (LSTM, ResNet1D 等)

v2 实验 (experiments/ 子包):
  experiments.nldi           - §3.2 NLDI 非线性可加性分析
  experiments.classification - §3.3 茶类分类对比
  experiments.regression     - §3.4 比例回归对比
  experiments.ablation       - §3.5 消融实验
  experiments.aroma_map      - §3.6 茶叶香气地图

图表生成 (figure/ 子包, 编号与手稿一致):
  figure._style               - 共享色板/路径/样式/数据加载/保存
  figure.gen_fig2_platform     - Fig 2: 平台与实验设计
  figure.gen_fig3_carl         - Fig 3: CARL 框架图
  figure.gen_fig4_merged       - Fig 4: 纯茶表征 + 非线性叠加 (5-panel)
  figure.gen_fig5_aroma_map    - Fig 5: 香气图谱 (handcrafted vs CARL)
  figure.gen_fig6_comparison   - Fig 6: 定量对比 (4-panel)
  figure.gen_sm_figs_v2        - 补充材料图
  figure.batch_generate        - AI 图片生成 (Fig 1 hero + GA)
  figure.generate_image        - 单图 AI 生成封装
"""
