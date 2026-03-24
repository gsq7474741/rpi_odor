"""检查截断实验进度"""
import json
from pathlib import Path

p = Path(__file__).parent / "results" / "truncation" / "truncation_results.json"
if not p.exists():
    print("结果文件不存在")
    exit()

with open(p, encoding="utf-8") as f:
    data = json.load(f)

for tn, t in data["tasks"].items():
    cutoffs = t.get("cutoffs", {})
    print(f"\n{tn}: {len(cutoffs)}/14 cutoffs")
    for k in sorted(cutoffs.keys(), key=lambda x: int(x)):
        v = cutoffs[k]
        has_ml = bool(v.get("ml_results"))
        has_dl = bool(v.get("dl_results"))
        print(f"  {k:>4}s: ML={'Y' if has_ml else 'N'} DL={'Y' if has_dl else 'N'} "
              f"best={v.get('best_overall',0):.1%}")

print(f"\nTasks: {list(data['tasks'].keys())}")
print(f"Updated: {data['metadata'].get('updated_at','?')}")
