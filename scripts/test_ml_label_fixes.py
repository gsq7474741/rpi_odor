"""验证 ML 标签策略三项修复"""
import sys
sys.path.insert(0, "d:/WindSurfProjects/rpi_odor/enose-analytics")

from src.ml.label_generator import LabelGenerator
from src.db.sample_reader import SampleReader
from src.db.ml_label_repository import MLLabelRepository

reader = SampleReader()
gen = LabelGenerator()
repo = MLLabelRepository()

# 1. 测试 concentration 策略
print("=" * 60)
print("1. 测试 concentration 策略")
print("=" * 60)
samples = reader.list_samples(limit=5)
for s in samples:
    liquids = s["liquids"]
    names = [(l["name"], l["ratio"], l.get("is_solvent")) for l in liquids]
    result = gen._label_concentration(liquids)
    print(f"  Sample {s['id']}: {names}")
    print(f"    -> concentration: {result}")

# 2. 测试 primary_liquid 策略（过滤稀释液）
print()
print("=" * 60)
print("2. 测试 primary_liquid 策略（过滤稀释液）")
print("=" * 60)
# 模拟有稀释液的情况
test_liquids = [
    {"name": "橙汁", "ratio": 10, "is_solvent": False},
    {"name": "纯净水", "ratio": 90, "is_solvent": True},
]
result = gen._label_primary_liquid(test_liquids)
print(f"  liquids: 橙汁:10(非稀释液) + 纯净水:90(稀释液)")
print(f"    -> primary_liquid: {result}")
assert result["label_str"] == "橙汁", f"Expected '橙汁', got '{result['label_str']}'"
print("    ✓ 正确过滤了稀释液")

# 不标记稀释液的情况
test_liquids2 = [
    {"name": "橙汁", "ratio": 10},
    {"name": "纯净水", "ratio": 90},
]
result2 = gen._label_primary_liquid(test_liquids2)
print(f"  liquids: 橙汁:10 + 纯净水:90 (均未标记)")
print(f"    -> primary_liquid: {result2}")
assert result2["label_str"] == "纯净水", f"Expected '纯净水', got '{result2['label_str']}'"
print("    ✓ 未标记时按比例选择")

# 3. 测试 label_distribution（回归分桶）
print()
print("=" * 60)
print("3. 测试 label_distribution（回归分桶）")
print("=" * 60)
for cfg_name in ["total_volume", "gas_pump_speed", "env_temperature", "concentration"]:
    config = repo.get_config_by_name(cfg_name)
    if not config:
        print(f"  {cfg_name}: 配置不存在")
        continue
    dist = repo.get_label_distribution(cfg_name)
    print(f"  {cfg_name} (type={config['label_type']}): {len(dist)} buckets")
    for label, count in list(dist.items())[:5]:
        print(f"    {label}: {count}")

print()
print("✓ 所有测试通过")
