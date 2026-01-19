# Protobuf 配置定义

使用 Protocol Buffers 定义配置数据结构，支持 C++、Python、TypeScript 代码生成。

## 目录结构

```
proto/
├── enose_config.proto    # 配置数据结构定义
├── buf.yaml              # Buf 配置
├── buf.gen.yaml          # 代码生成配置
└── README.md

config/data/
├── liquids.json          # 液体实例 (JSON 格式)
├── substances.json       # 待测物实例
├── workflows.json        # 工作流实例
└── experiments.json      # 实验实例
```

## 安装 Buf

```bash
# macOS
brew install bufbuild/buf/buf

# Linux
curl -sSL https://github.com/bufbuild/buf/releases/latest/download/buf-$(uname -s)-$(uname -m) -o /usr/local/bin/buf
chmod +x /usr/local/bin/buf

# Windows (PowerShell)
scoop install buf
# 或
choco install buf
```

## 代码生成

```bash
cd proto
buf generate
```

生成的代码位于:
- `gen/cpp/` - C++ 代码
- `gen/python/` - Python 代码
- `gen/typescript/` - TypeScript 代码

## 使用示例

### Python

```python
import json
from google.protobuf.json_format import Parse, MessageToJson
from gen.python.enose_config_pb2 import LiquidList, Workflow, Experiment

# 读取 JSON 配置
with open('config/data/liquids.json') as f:
    data = f.read()
    
# 解析为 Protobuf 对象
liquids = Parse(data, LiquidList())

# 访问数据
for liquid in liquids.liquids:
    print(f"{liquid.id}: {liquid.name} (泵{liquid.pump_index})")

# 序列化回 JSON
json_str = MessageToJson(liquids)
```

### C++

```cpp
#include <fstream>
#include <google/protobuf/util/json_util.h>
#include "gen/cpp/enose_config.pb.h"

// 读取 JSON 配置
std::ifstream file("config/data/workflows.json");
std::string json_str((std::istreambuf_iterator<char>(file)),
                      std::istreambuf_iterator<char>());

// 解析为 Protobuf 对象
enose::config::WorkflowList workflows;
google::protobuf::util::JsonStringToMessage(json_str, &workflows);

// 访问数据
for (const auto& wf : workflows.workflows()) {
    std::cout << wf.id() << ": " << wf.name() << std::endl;
}

// 序列化回 JSON
std::string output;
google::protobuf::util::MessageToJsonString(workflows, &output);
```

### TypeScript

```typescript
import { LiquidList, Workflow, Experiment } from './gen/typescript/enose_config';
import * as fs from 'fs';

// 读取 JSON 配置
const data = fs.readFileSync('config/data/experiments.json', 'utf8');

// 解析为 Protobuf 对象
const experiments = Experiment.fromJson(JSON.parse(data));

// 访问数据
experiments.experiments.forEach(exp => {
    console.log(`${exp.id}: ${exp.name}`);
    console.log(`  Workflow: ${exp.workflowId}`);
    console.log(`  Substance: ${exp.substanceId}`);
});

// 序列化回 JSON
const jsonStr = Experiment.toJson(experiments);
```

## 数据关系

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Liquid    │◄────│  Substance   │     │  Workflow   │
│  (液体)     │ 1:N │  (待测物)     │     │  (工作流)   │
└─────────────┘     └──────┬───────┘     └──────┬──────┘
                           │                    │
                           │ N:1                │ N:1
                           ▼                    ▼
                    ┌──────────────────────────────┐
                    │         Experiment           │
                    │          (实验)              │
                    └──────────────┬───────────────┘
                                   │ 1:N
                                   ▼
                            ┌─────────────┐
                            │   Sample    │
                            │   (样本)    │
                            └─────────────┘
```

## 验证配置

```bash
# 使用 buf 验证 proto 文件
buf lint

# 检查 breaking changes
buf breaking --against '.git#branch=main'
```
