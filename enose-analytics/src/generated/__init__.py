"""Generated protobuf modules"""

import sys
from pathlib import Path

# 将 generated 目录加入 sys.path，让生成的 proto 文件能找到彼此
_generated_dir = Path(__file__).parent
if str(_generated_dir) not in sys.path:
    sys.path.insert(0, str(_generated_dir))

from .enose_analytics_pb2 import *
from .enose_analytics_pb2_grpc import *
from .enose_data_pb2 import *
from .enose_data_pb2_grpc import *
