"""茶叶拼配电子鼻论文 — v2 实验代码包

基于 paper_experiments 的 v2 实验链整理而成，仅保留 v2 论文所需模块。

基础层:
  config          - 全局配置 (路径、超参、茶名映射、图表样式)
  data            - 数据加载门面 (复用 truncation_study 的 DB/缓存/对齐)
  drift           - 漂移检测与校正
  viz             - 共享可视化工具 (matplotlib/seaborn, 出版级图表)
  baselines       - ML/DL 基线模型 (TS2Vec, Autoencoder, SimCLR 等)

核心算法模块:
  nldi             - NLDI 非线性偏差指数计算
  nldi_robust_stats - Bootstrap CI + Wilcoxon 检验
  carl_training    - CARL 对比表征学习 (模型 + 训练)
  carl_finetune    - CARL 分类微调
  prediction       - 比例预测模型 (CNN/MLP 回归)
  discrimination   - 1D-CNN 分类评估
  backbones        - 端到端 DL 骨干网络 (LSTM, ResNet1D 等)
  aroma_map_utils  - 香气地图可视化辅助

v2 实验 (experiments/ 子包):
  experiments.nldi           - §3.2 NLDI 非线性可加性分析
  experiments.classification - §3.3 茶类分类对比
  experiments.regression     - §3.4 比例回归对比
  experiments.ablation       - §3.5 消融实验
  experiments.aroma_map      - §3.6 茶叶香气地图

图表生成 (figure/ 子包):
  figure.gen_fig3_carl         - Fig 3: CARL 框架图
  figure.gen_fig4_merged       - Fig 4: 纯茶表征 + 非线性叠加 (5-panel)
  figure.gen_fig5_comparison   - Fig 5/6: 定量对比
  figure.gen_nature_figs_v2    - 主文合并图
  figure.gen_sm_figs_v2        - 补充材料图
  figure.batch_generate        - AI 图片批量生成 + composite 拼装
  figure.generate_image        - 单图 AI 生成封装
"""
