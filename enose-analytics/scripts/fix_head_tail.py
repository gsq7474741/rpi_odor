"""删除旧的 head_tail 结果, 让实验用修正后的逻辑重跑"""
import json
from pathlib import Path

p = Path(__file__).parent / "results" / "truncation" / "phase_study_results.json"
with open(p, "r", encoding="utf-8") as f:
    data = json.load(f)

for task_name, task in data.get("tasks", {}).items():
    conds = task.get("conditions", {})
    if "head_tail" in conds:
        del conds["head_tail"]
        print(f"  删除 {task_name} 的 head_tail 结果")

# 更新描述
data["metadata"]["conditions"]["head_tail"] = "ACQUIRE 前 30s + WASH 前 30s (吸附头+解析头)"

with open(p, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("Done. head_tail 将在下次运行时用修正逻辑重跑。")
