import { NextResponse } from "next/server";
import * as grpc from "@grpc/grpc-js";

// gRPC 服务器地址
const GRPC_HOST = process.env.GRPC_HOST || "rpi5.local";
const GRPC_PORT = process.env.GRPC_PORT || "50051";

// 动态导入 TestServiceClient (proto 生成后可用)
let testClient: any = null;

async function getTestClient() {
  if (!testClient) {
    try {
      const { TestServiceClient } = await import("@/generated/enose_service.grpc-client");
      testClient = new TestServiceClient(
        `${GRPC_HOST}:${GRPC_PORT}`,
        grpc.credentials.createInsecure()
      );
    } catch (e) {
      console.error("Failed to import TestServiceClient:", e);
      throw new Error("TestServiceClient not available");
    }
  }
  return testClient;
}

// 辅助函数：将 callback 转为 Promise
function promisify<TReq, TRes>(
  method: (req: TReq, callback: (err: grpc.ServiceError | null, res: TRes) => void) => void,
  request: TReq
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    method(request, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

export async function GET() {
  try {
    const client = await getTestClient();
    const { Empty } = await import("@/generated/google/protobuf/empty");
    
    const status = await promisify(
      client.getTestStatus.bind(client),
      Empty.create()
    );
    
    return NextResponse.json(status);
  } catch (error: any) {
    console.error("GetTestStatus error:", error.message);
    return NextResponse.json(
      { error: "Failed to get test status", details: error.message },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, config } = body;
    const client = await getTestClient();
    const { Empty } = await import("@/generated/google/protobuf/empty");

    let result;
    switch (action) {
      case "start":
        // 启动测试
        result = await promisify(
          client.startTest.bind(client),
          config
        );
        break;
        
      case "stop":
        // 停止测试
        result = await promisify(
          client.stopTest.bind(client),
          Empty.create()
        );
        break;
        
      case "getStatus":
        // 获取状态
        result = await promisify(
          client.getTestStatus.bind(client),
          Empty.create()
        );
        break;
        
      case "getResults":
        // 获取结果
        result = await promisify(
          client.getTestResults.bind(client),
          Empty.create()
        );
        break;
        
      case "clearResults":
        // 清除结果
        await promisify(
          client.clearTestResults.bind(client),
          Empty.create()
        );
        result = { success: true };
        break;
        
      default:
        return NextResponse.json(
          { error: "Unknown action" },
          { status: 400 }
        );
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Test API error:", error.message);
    return NextResponse.json(
      { error: "Test action failed", details: error.message },
      { status: 503 }
    );
  }
}
