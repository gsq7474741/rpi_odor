import { NextResponse } from "next/server";
import * as grpc from "@grpc/grpc-js";
import { ExperimentServiceClient } from "@/generated/enose_experiment.grpc-client";
import { LoadProgramRequest, ValidateProgramRequest } from "@/generated/enose_experiment";
import { Empty } from "@/generated/google/protobuf/empty";

const GRPC_HOST = process.env.GRPC_HOST || "rpi5.local";
const GRPC_PORT = process.env.GRPC_PORT || "50051";

let experimentClient: ExperimentServiceClient | null = null;

function getExperimentClient(): ExperimentServiceClient {
  if (!experimentClient) {
    experimentClient = new ExperimentServiceClient(
      `${GRPC_HOST}:${GRPC_PORT}`,
      grpc.credentials.createInsecure()
    );
  }
  return experimentClient;
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
    
    const status = await promisify(
      client.getExperimentStatus.bind(client),
      Empty
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
          result = await promisify(
            client.validateProgram.bind(client),
            ValidateProgramRequest.create({ yamlContent: body.yaml_content })
          );
        } else {
          result = await promisify(
            client.validateProgram.bind(client),
            ValidateProgramRequest.create({ program: body.program })
          );
        }
        break;
        
      case "load":
        if (body.yaml_content) {
          console.log("Loading program from YAML");
          result = await promisify(
            client.loadProgram.bind(client),
            LoadProgramRequest.create({ yamlContent: body.yaml_content })
          );
        } else {
          console.log("Loading program from struct");
          result = await promisify(
            client.loadProgram.bind(client),
            LoadProgramRequest.create({ program: body.program })
          );
        }
        break;
        
      case "start":
        result = await promisify(
          client.startExperiment.bind(client),
          Empty
        );
        break;
        
      case "stop":
        result = await promisify(
          client.stopExperiment.bind(client),
          Empty
        );
        break;
        
      case "pause":
        result = await promisify(
          client.pauseExperiment.bind(client),
          Empty
        );
        break;
        
      case "resume":
        result = await promisify(
          client.resumeExperiment.bind(client),
          Empty
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
