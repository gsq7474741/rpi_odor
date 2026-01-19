import * as grpc from "@grpc/grpc-js";
import { ControlServiceClient } from "../generated/enose_service.grpc-client";
import { Empty } from "../generated/google/protobuf/empty";
import { SystemStateEnum } from "../generated/enose_service";
import type { 
  SystemStatus, 
  SetSystemStateResponse,
  ManualControlResponse,
  RunPumpResponse,
  StopAllPumpsResponse 
} from "../generated/enose_service";

// gRPC 服务器地址 (从环境变量读取)
const GRPC_HOST = process.env.GRPC_HOST || "rpi5.local";
const GRPC_PORT = process.env.GRPC_PORT || "50051";

// 创建客户端实例
let client: ControlServiceClient | null = null;

function getClient(): ControlServiceClient {
  if (!client) {
    client = new ControlServiceClient(
      `${GRPC_HOST}:${GRPC_PORT}`,
      grpc.credentials.createInsecure()
    );
  }
  return client;
}

// 辅助函数：将 callback 转为 Promise
function promisify<TReq, TRes>(
  method: (input: TReq, callback: (err: grpc.ServiceError | null, value?: TRes) => void) => grpc.ClientUnaryCall,
  request: TReq
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    method.call(getClient(), request, (error: grpc.ServiceError | null, response?: TRes) => {
      if (error) {
        reject(error);
      } else {
        resolve(response!);
      }
    });
  });
}

// API 方法

export async function getStatus(): Promise<SystemStatus> {
  return promisify<Empty, SystemStatus>(
    getClient().getStatus.bind(getClient()),
    Empty.create()
  );
}

export async function setSystemState(targetState: string): Promise<SetSystemStateResponse> {
  const stateMap: Record<string, SystemStateEnum> = {
    INITIAL: SystemStateEnum.INITIAL,
    DRAIN: SystemStateEnum.DRAIN,
    CLEAN: SystemStateEnum.CLEAN,
    SAMPLE: SystemStateEnum.SAMPLE,
  };
  return promisify(
    getClient().setSystemState.bind(getClient()),
    { targetState: stateMap[targetState] || SystemStateEnum.SYSTEM_STATE_UNSPECIFIED }
  );
}

export async function manualControl(peripheralName: string, value: number): Promise<ManualControlResponse> {
  return promisify(
    getClient().manualControl.bind(getClient()),
    { peripheralName, value }
  );
}

export async function runPump(
  pumpName: string, 
  speed: number, 
  distance?: number, 
  accel?: number
): Promise<RunPumpResponse> {
  return promisify(
    getClient().runPump.bind(getClient()),
    { pumpName, speed, distance, accel }
  );
}

export async function stopAllPumps(): Promise<StopAllPumpsResponse> {
  return promisify(
    getClient().stopAllPumps.bind(getClient()),
    Empty.create()
  );
}

// 检查连接状态
export async function checkConnection(): Promise<boolean> {
  try {
    await getStatus();
    return true;
  } catch {
    return false;
  }
}
