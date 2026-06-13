---
name: grpc-service
description: 创建新的 gRPC 服务（Proto + C++ 实现 + 前端 API）
---

# gRPC 服务开发技能

用于在本项目中添加新的 gRPC 服务。

## 文件结构

```
enose-control/
├── proto/
│   └── enose_[service].proto      # Proto 定义
└── src/
    ├── grpc/
    │   ├── [service]_impl.hpp     # 服务实现头文件
    │   └── [service]_impl.cpp     # 服务实现
    └── main.cpp                   # 注册服务

enose-ui/
└── src/
    ├── generated/                 # 自动生成的类型
    ├── lib/
    │   └── grpc-client.ts        # gRPC 客户端方法
    └── app/api/
        └── [endpoint]/route.ts   # Next.js API 路由
```

## 开发步骤

### 1. 定义 Proto

在 `enose-control/proto/` 创建 `.proto` 文件：

```protobuf
syntax = "proto3";
package enose.[service];

service [ServiceName] {
  rpc [MethodName]([Request]) returns ([Response]);
}

message [Request] { ... }
message [Response] { ... }
```

### 2. 实现 C++ 服务

头文件 `src/grpc/[service]_impl.hpp`：

```cpp
#pragma once
#include "[proto].grpc.pb.h"

namespace grpc_service {
class [Service]Impl final : public [Proto]::Service {
public:
    ::grpc::Status [Method](
        ::grpc::ServerContext* context,
        const [Request]* request,
        [Response]* response) override;
};
}
```

### 3. 注册服务

在 `main.cpp` 中：

```cpp
#include "grpc/[service]_impl.hpp"

// 在 main() 中
auto [service] = std::make_shared<grpc_service::[Service]Impl>(...);
builder.RegisterService([service].get());
```

### 4. 前端客户端

在 `grpc-client.ts` 添加方法：

```typescript
export async function [methodName](): Promise<[Response]> {
  return promisify(
    get[Service]Client().[method].bind(get[Service]Client()),
    [Request].create()
  );
}
```

### 5. API 路由

创建 `app/api/[endpoint]/route.ts`：

```typescript
import { [method] } from "@/lib/grpc-client";

export async function GET() {
  try {
    const result = await [method]();
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
```

### 6. 部署

使用 crossbuild 技能部署后端。
