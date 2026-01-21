import * as grpc from "@grpc/grpc-js";
import { ControlServiceClient, SensorServiceClient } from "../generated/enose_service.grpc-client";
import { Empty } from "../generated/google/protobuf/empty";
import { SystemStateEnum } from "../generated/enose_service";
import type { 
  SystemStatus, 
  SetSystemStateResponse,
  ManualControlResponse,
  RunPumpResponse,
  StopAllPumpsResponse,
  SensorCommandResponse,
  SensorBoardStatus,
  HeaterConfigResponse
} from "../generated/enose_service";

// gRPC 服务器地址 (从环境变量读取)
const GRPC_HOST = process.env.GRPC_HOST || "rpi5.local";
const GRPC_PORT = process.env.GRPC_PORT || "50051";

// 创建客户端实例
let controlClient: ControlServiceClient | null = null;
let sensorClient: SensorServiceClient | null = null;

function getClient(): ControlServiceClient {
  if (!controlClient) {
    controlClient = new ControlServiceClient(
      `${GRPC_HOST}:${GRPC_PORT}`,
      grpc.credentials.createInsecure()
    );
  }
  return controlClient;
}

function getSensorClient(): SensorServiceClient {
  if (!sensorClient) {
    sensorClient = new SensorServiceClient(
      `${GRPC_HOST}:${GRPC_PORT}`,
      grpc.credentials.createInsecure()
    );
  }
  return sensorClient;
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
    INJECT: 5 as SystemStateEnum,  // 待重新生成 protobuf 后改为 SystemStateEnum.INJECT
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

// 进样控制
export interface InjectionParams {
  pump2Volume: number;
  pump3Volume: number;
  pump4Volume: number;
  pump5Volume: number;
  speed?: number;
  accel?: number;
}

export async function startInjection(params: InjectionParams): Promise<{ success: boolean; message: string }> {
  return promisify(
    getClient().startInjection.bind(getClient()),
    {
      pump2Volume: params.pump2Volume,
      pump3Volume: params.pump3Volume,
      pump4Volume: params.pump4Volume,
      pump5Volume: params.pump5Volume,
      speed: params.speed,
      accel: params.accel,
    }
  );
}

export async function stopInjection(): Promise<{ success: boolean; message: string }> {
  return promisify(
    getClient().stopInjection.bind(getClient()),
    Empty.create()
  );
}

// 紧急停止 (发送 M112)
export async function emergencyStop(): Promise<{ success: boolean; message: string }> {
  return promisify(
    getClient().emergencyStop.bind(getClient()),
    Empty.create()
  );
}

// 固件重启 (急停后恢复)
export async function firmwareRestart(): Promise<{ success: boolean; message: string }> {
  return promisify(
    getClient().firmwareRestart.bind(getClient()),
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

// ============================================================
// 传感器服务 API
// ============================================================

function sensorPromisify<TReq, TRes>(
  method: (input: TReq, callback: (err: grpc.ServiceError | null, value?: TRes) => void) => grpc.ClientUnaryCall,
  request: TReq
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    method.call(getSensorClient(), request, (error: grpc.ServiceError | null, response?: TRes) => {
      if (error) {
        reject(error);
      } else {
        resolve(response!);
      }
    });
  });
}

export async function sendSensorCommand(command: string, paramsJson?: string): Promise<SensorCommandResponse> {
  return sensorPromisify(
    getSensorClient().sendCommand.bind(getSensorClient()),
    { command, paramsJson }
  );
}

export async function getSensorStatus(): Promise<SensorBoardStatus> {
  return sensorPromisify(
    getSensorClient().getSensorStatus.bind(getSensorClient()),
    Empty.create()
  );
}

export async function configureHeater(temps: number[], durs: number[], sensors?: number[]): Promise<HeaterConfigResponse> {
  return sensorPromisify(
    getSensorClient().configureHeater.bind(getSensorClient()),
    { temps, durs, sensors: sensors || [] }
  );
}

// 导出 SensorServiceClient 用于流式订阅
export { getSensorClient };
