import { NextResponse } from "next/server";
import {
  getLoadCellConfig,
  saveLoadCellConfig,
  setEmptyBottleBaseline,
  setOverflowThreshold,
  tareLoadCell,
} from "@/lib/grpc-client";

export async function GET() {
  try {
    const config = await getLoadCellConfig();
    return NextResponse.json(config);
  } catch (error: any) {
    console.error("gRPC error:", error.message);
    return NextResponse.json(
      { error: "Failed to get config", details: error.message },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, config, value } = body;

    let result;
    switch (action) {
      case "save":
        await saveLoadCellConfig(config);
        result = { success: true };
        break;
      case "setEmptyBottle":
        result = await setEmptyBottleBaseline();
        break;
      case "setOverflow":
        await setOverflowThreshold(value);
        result = { success: true };
        break;
      case "tare":
        result = await tareLoadCell();
        break;
      default:
        return NextResponse.json(
          { error: "Unknown action" },
          { status: 400 }
        );
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Config error:", error.message);
    return NextResponse.json(
      { error: "Config action failed", details: error.message },
      { status: 503 }
    );
  }
}
