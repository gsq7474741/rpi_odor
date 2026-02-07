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
      
      case "wash-pumps": {
        const response = await promisify(c.getWashPumpAssignments.bind(c), {});
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
      
      case "tags": {
        const category = searchParams.get("category") || "";
        const search = searchParams.get("search") || "";
        const orderByUsage = searchParams.get("orderByUsage") === "true";
        const response = await promisify(
          c.listTags.bind(c),
          { category, search, limit: 100, orderByUsage }
        );
        return NextResponse.json(response);
      }
      
      case "tag-suggestions": {
        const prefix = searchParams.get("prefix") || "";
        const category = searchParams.get("category") || "";
        const limit = parseInt(searchParams.get("limit") || "10");
        const response = await promisify(
          c.getTagSuggestions.bind(c),
          { prefix, category, limit }
        );
        return NextResponse.json(response);
      }
      
      case "liquid-tags": {
        const liquidId = parseInt(searchParams.get("liquidId") || "0");
        const fieldKey = searchParams.get("fieldKey") || "aroma_notes";
        const response = await promisify(
          c.getLiquidTags.bind(c),
          { liquidId, fieldKey }
        );
        return NextResponse.json(response);
      }
      
      case "liquids-by-tags": {
        const tagNames = searchParams.get("tags")?.split(",") || [];
        const fieldKey = searchParams.get("fieldKey") || "aroma_notes";
        const typeFilter = searchParams.get("filter") || "";
        const response = await promisify(
          c.listLiquidsByTags.bind(c),
          { 
            tagNames, 
            fieldKey, 
            typeFilter: typeFilter === "sample" ? 1 : typeFilter === "rinse" ? 2 : 0,
            limit: 100,
            offset: 0
          }
        );
        return NextResponse.json(response);
      }
      
      case "attachments": {
        const liquidId = parseInt(searchParams.get("liquidId") || "0");
        const fieldKey = searchParams.get("fieldKey") || "";
        const response = await promisify(
          c.getLiquidAttachments.bind(c),
          { liquidId, fieldKey }
        );
        return NextResponse.json(response);
      }

      case "all-attachments": {
        // 批量获取所有液体的附件，服务端聚合，前端只需 1 次 HTTP 请求
        const liquidIds = searchParams.get("liquidIds")?.split(",").map(Number).filter(Boolean) || [];
        const result: Record<number, Record<string, Array<unknown>>> = {};
        await Promise.all(
          liquidIds.map(async (lid) => {
            try {
              const res = await promisify(
                c.getLiquidAttachments.bind(c),
                { liquidId: lid, fieldKey: "" }
              );
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const attachments = (res as any).attachments || [];
              if (attachments.length > 0) {
                result[lid] = {};
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                for (const att of attachments as any[]) {
                  const fk = att.fieldKey || att.field_key || "";
                  if (!result[lid][fk]) result[lid][fk] = [];
                  result[lid][fk].push(att);
                }
              }
            } catch {
              // 单个液体查询失败不影响整体
            }
          })
        );
        return NextResponse.json({ attachmentsMap: result });
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const req: any = {
          pumpIndex: body.pumpIndex,
          notes: body.notes || "",
        };
        if (body.liquidId !== null && body.liquidId !== undefined) {
          req.liquidId = body.liquidId;
        }
        if (body.initialVolumeMl !== undefined) {
          req.initialVolumeMl = body.initialVolumeMl;
        }
        if (body.lowVolumeThresholdMl !== undefined) {
          req.lowVolumeThresholdMl = body.lowVolumeThresholdMl;
        }
        const response = await promisify(c.setPumpAssignment.bind(c), req);
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
      
      case "set-wash-pump": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const req: any = {
          pumpIndex: body.pumpIndex,
          notes: body.notes || "",
        };
        if (body.liquidId !== null && body.liquidId !== undefined) {
          req.liquidId = body.liquidId;
        }
        if (body.initialVolumeMl !== undefined) {
          req.initialVolumeMl = body.initialVolumeMl;
        }
        if (body.lowVolumeThresholdMl !== undefined) {
          req.lowVolumeThresholdMl = body.lowVolumeThresholdMl;
        }
        const response = await promisify(c.setWashPumpAssignment.bind(c), req);
        return NextResponse.json(response);
      }
      
      case "set-wash-pump-volume": {
        const response = await promisify(
          c.setWashPumpVolume.bind(c),
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
            newLifetimeSeconds: body.newLifetimeSeconds || 0,
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
      
      case "create-field": {
        const response = await promisify(
          c.createMetadataField.bind(c),
          {
            entityType: body.entityType || "liquid",
            fieldKey: body.fieldKey,
            fieldName: body.fieldName,
            fieldType: body.fieldType || 1,
            description: body.description || "",
            isRequired: body.isRequired || false,
            defaultValue: body.defaultValue || "",
            optionsJson: body.optionsJson || "[]",
            displayOrder: body.displayOrder || 0,
          }
        );
        return NextResponse.json(response);
      }
      
      case "update-field": {
        const response = await promisify(
          c.updateMetadataField.bind(c),
          {
            id: body.id,
            fieldName: body.fieldName,
            description: body.description || "",
            isRequired: body.isRequired || false,
            defaultValue: body.defaultValue || "",
            optionsJson: body.optionsJson || "[]",
            displayOrder: body.displayOrder || 0,
            isActive: body.isActive !== false,
          }
        );
        return NextResponse.json(response);
      }
      
      case "delete-field": {
        await promisify(c.deleteMetadataField.bind(c), { id: body.id });
        return NextResponse.json({ success: true });
      }
      
      // 标签管理
      case "create-tag": {
        const response = await promisify(
          c.createTag.bind(c),
          {
            name: body.name,
            category: body.category || "aroma",
            color: body.color || "",
          }
        );
        return NextResponse.json(response);
      }
      
      case "delete-tag": {
        await promisify(c.deleteTag.bind(c), { id: body.id });
        return NextResponse.json({ success: true });
      }
      
      case "set-liquid-tags": {
        const response = await promisify(
          c.setLiquidTags.bind(c),
          {
            liquidId: body.liquidId,
            tagNames: body.tagNames || [],
            fieldKey: body.fieldKey || "aroma_notes",
          }
        );
        return NextResponse.json(response);
      }
      
      case "create-attachment": {
        const response = await promisify(
          c.createLiquidAttachment.bind(c),
          {
            liquidId: body.liquidId,
            fieldKey: body.fieldKey,
            fileType: body.fileType || "image",
            fileName: body.fileName,
            filePath: body.filePath,
            fileSize: body.fileSize || 0,
            mimeType: body.mimeType || "",
          }
        );
        return NextResponse.json(response);
      }
      
      case "delete-attachment": {
        await promisify(c.deleteLiquidAttachment.bind(c), { attachmentId: body.attachmentId });
        return NextResponse.json({ success: true });
      }
      
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error(`POST /api/consumables error:`, error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
