"""茶叶拼配电子鼻论文 — 实验代码包

模块:
  config   - 全局配置 (路径、超参、茶名映射、图表样式)
  data     - 数据加载门面 (复用 truncation_study 的 DB/缓存/对齐)
  features - 特征提取 (复用 truncation_study 的特征管线)
  viz      - 共享可视化工具 (matplotlib/seaborn, 出版级图表)
  exp1_discrimination - 实验1: 单茶辨识
  exp2_nldi           - 实验2: NLDI 可加性分析
  exp3_carl           - 实验3: CARL 对比表征学习
  exp4_prediction     - 实验4: 比例预测模型对比
  exp5_aroma_map      - 实验5: 茶叶香气地图
"""
