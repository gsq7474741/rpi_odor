import { NextRequest, NextResponse } from "next/server";
import * as grpc from "@grpc/grpc-js";
import { ConsumableServiceClient } from "@/generated/enose_consumable.grpc-client";

const GRPC_HOST = process.env.GRPC_HOST || "rpi5.local";
const GRPC_PORT = process.env.GRPC_PORT || "50051";

let client: ConsumableServiceClient | null = null;

function getClient(): ConsumableServiceClient {
  if (!client) {
    client = new ConsumableServiceClient(
      `${GRPC_HOST}:${GRPC_PORT}`,
      grpc.credentials.createInsecure()
    );
  }
  return client;
}

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

// GET /api/consumables?type=liquids|pumps|consumables|fields
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "consumables";
  
  try {
    const c = getClient();
    
    switch (type) {
      case "liquids": {
        const typeFilter = searchParams.get("filter") || "";
        const response = await promisify(
          c.listLiquids.bind(c),
          {
            typeFilter: typeFilter === "sample" ? 1 : typeFilter === "rinse" ? 2 : 0,
            includeInactive: false,
            limit: 100,
            offset: 0,
          }
        );
        return NextResponse.json(response);
      }
      
      case "pumps": {
        const response = await promisify(c.getPumpAssignments.bind(c), {});
        return NextResponse.json(response);
      }
      
      case "consumables": {
        const response = await promisify(c.getConsumableStatus.bind(c), {});
        return NextResponse.json(response);
      }
      
      case "fields": {
        const entityType = searchParams.get("entity") || "liquid";
        const response = await promisify(
          c.listMetadataFields.bind(c),
          { entityType, includeInactive: false }
        );
        return NextResponse.json(response);
      }
      
      default:
        return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }
  } catch (error) {
    console.error(`GET /api/consumables error:`, error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/consumables
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  
  try {
    const c = getClient();
    const body = await request.json();
    
    switch (action) {
      case "create-liquid": {
        const response = await promisify(
          c.createLiquid.bind(c),
          {
            name: body.name,
            type: body.type === "sample" ? 1 : body.type === "rinse" ? 2 : 3,
            description: body.description || "",
            density: body.density || 1.0,
            metadataJson: body.metadataJson || "{}",
          }
        );
        return NextResponse.json(response);
      }
      
      case "update-liquid": {
        const response = await promisify(
          c.updateLiquid.bind(c),
          {
            id: body.id,
            name: body.name,
            type: body.type === "sample" ? 1 : body.type === "rinse" ? 2 : 3,
            description: body.description || "",
            density: body.density || 1.0,
            metadataJson: body.metadataJson || "{}",
            isActive: body.isActive !== false,
          }
        );
        return NextResponse.json(response);
      }
      
      case "delete-liquid": {
        await promisify(c.deleteLiquid.bind(c), { id: body.id });
        return NextResponse.json({ success: true });
      }
      
      case "set-pump": {
        const response = await promisify(
          c.setPumpAssignment.bind(c),
          {
            pumpIndex: body.pumpIndex,
            liquidId: body.liquidId,
            notes: body.notes || "",
            initialVolumeMl: body.initialVolumeMl,
            lowVolumeThresholdMl: body.lowVolumeThresholdMl,
          }
        );
        return NextResponse.json(response);
      }
      
      case "set-pump-volume": {
        const response = await promisify(
          c.setPumpVolume.bind(c),
          {
            pumpIndex: body.pumpIndex,
            initialVolumeMl: body.initialVolumeMl,
            lowVolumeThresholdMl: body.lowVolumeThresholdMl,
            resetConsumed: body.resetConsumed !== false,
          }
        );
        return NextResponse.json(response);
      }
      
      case "reset-consumable": {
        const response = await promisify(
          c.resetConsumable.bind(c),
          {
            consumableId: body.consumableId,
            notes: body.notes || "",
          }
        );
        return NextResponse.json(response);
      }
      
      case "update-lifetime": {
        const response = await promisify(
          c.updateConsumableLifetime.bind(c),
          {
            consumableId: body.consumableId,
            lifetimeSeconds: body.lifetimeSeconds,
          }
        );
        return NextResponse.json(response);
      }
      
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error(`POST /api/consumables error:`, error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
