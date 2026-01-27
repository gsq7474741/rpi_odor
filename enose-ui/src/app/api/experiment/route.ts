import { NextResponse } from "next/server";
import * as grpc from "@grpc/grpc-js";
import { ExperimentServiceClient } from "@/generated/enose_experiment.grpc-client";
import { LoadProgramRequest, ValidateProgramRequest } from "@/generated/enose_experiment";
import { Empty } from "@/generated/google/protobuf/empty";
import fs from "fs";
import path from "path";

const GRPC_HOST = process.env.GRPC_HOST || "rpi5.local";
const GRPC_PORT = process.env.GRPC_PORT || "50051";

let experimentClient: ExperimentServiceClient | null = null;

function getExperimentClient(): ExperimentServiceClient {
  if (!experimentClient) {
    experimentClient = new ExperimentServiceClient(
      `${GRPC_HOST}:${GRPC_PORT}`,
      grpc.credentials.createInsecure(),
      {
        "grpc.keepalive_time_ms": 10000,
        "grpc.keepalive_timeout_ms": 5000,
      }
    );
  }
  return experimentClient;
}

// 带超时的 promisify
function promisifyWithTimeout<TReq, TRes>(
  method: (req: TReq, callback: (err: grpc.ServiceError | null, res: TRes) => void) => void,
  request: TReq,
  timeoutMs: number = 5000
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`gRPC call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    
    method(request, (err, res) => {
      clearTimeout(timeout);
      if (err) reject(err);
      else resolve(res);
    });
  });
}

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
    const client = getExperimentClient();
    
    const status = await promisifyWithTimeout(
      client.getExperimentStatus.bind(client),
      Empty,
      3000
    );
    
    return NextResponse.json(status);
  } catch (error: any) {
    console.error("GetExperimentStatus error:", error.message);
    return NextResponse.json(
      { 
        state: "EXP_IDLE",
        error: error.message,
        connected: false 
      },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const body = await request.json().catch(() => ({}));
    
    const client = getExperimentClient();

    let result;
    
    switch (action) {
      case "validate":
        if (body.yaml_content) {
          result = await promisifyWithTimeout(
            client.validateProgram.bind(client),
            ValidateProgramRequest.create({ 
              source: { oneofKind: "yamlContent", yamlContent: body.yaml_content } 
            })
          );
        } else if (body.program) {
          result = await promisifyWithTimeout(
            client.validateProgram.bind(client),
            ValidateProgramRequest.create({ 
              source: { oneofKind: "program", program: body.program } 
            }),
            5000
          );
        } else {
          return NextResponse.json({ error: "Missing yaml_content or program" }, { status: 400 });
        }
        break;
        
      case "load":
        let yamlContent: string | null = null;
        
        // 优先通过文件名加载
        if (body.filename) {
          const programsDir = path.join(process.cwd(), "public", "programs");
          const filePath = path.join(programsDir, body.filename);
          if (!fs.existsSync(filePath)) {
            return NextResponse.json({ error: `文件不存在: ${body.filename}` }, { status: 404 });
          }
          yamlContent = fs.readFileSync(filePath, "utf-8");
          console.log("Loading program from file:", body.filename);
        } else if (body.yaml_content) {
          yamlContent = body.yaml_content;
          console.log("Loading program from YAML, length:", body.yaml_content.length);
        }
        
        if (yamlContent) {
          result = await promisifyWithTimeout(
            client.loadProgram.bind(client),
            LoadProgramRequest.create({ 
              source: { oneofKind: "yamlContent", yamlContent } 
            }),
            5000
          );
        } else if (body.program) {
          console.log("Loading program from struct");
          result = await promisifyWithTimeout(
            client.loadProgram.bind(client),
            LoadProgramRequest.create({ 
              source: { oneofKind: "program", program: body.program } 
            }),
            5000
          );
        } else {
          return NextResponse.json({ error: "Missing filename, yaml_content or program" }, { status: 400 });
        }
        break;
        
      case "start":
        result = await promisifyWithTimeout(
          client.startExperiment.bind(client),
          Empty,
          5000
        );
        break;
        
      case "stop":
        result = await promisifyWithTimeout(
          client.stopExperiment.bind(client),
          Empty,
          5000
        );
        break;
        
      case "pause":
        result = await promisifyWithTimeout(
          client.pauseExperiment.bind(client),
          Empty,
          5000
        );
        break;
        
      case "resume":
        result = await promisifyWithTimeout(
          client.resumeExperiment.bind(client),
          Empty,
          5000
        );
        break;
        
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Experiment API error:", error.message);
    return NextResponse.json(
      { error: "Experiment action failed", details: error.message },
      { status: 503 }
    );
  }
}
