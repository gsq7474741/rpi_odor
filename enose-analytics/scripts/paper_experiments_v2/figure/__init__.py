"""图表生成子包 — matplotlib 数据图 + AI 示意图。

编号与手稿一致 (Fig 1 = AI hero, 不在此包生成)。

共享模块:
  _style               - 色板、路径、样式初始化、数据加载、保存工具

matplotlib 数据图 (每张主图一个脚本):
  gen_fig2_platform     - Fig 2: 平台与实验设计 (A 照片 B CAD C CFD D 流程)
  gen_fig3_carl         - Fig 3: CARL 框架示意图
  gen_fig4_merged       - Fig 4: 纯茶表征 + 非线性叠加 (5-panel)
  gen_fig5_aroma_map    - Fig 5: 香气图谱 (handcrafted vs CARL)
  gen_fig6_comparison   - Fig 6: 定量对比 (4-panel)
  gen_sm_figs_v2        - 补充材料图

AI 生成:
  batch_generate        - 批量 AI 图片生成 (Fig 1 hero + GA)
  generate_image        - 单图 AI 生成封装
"""
