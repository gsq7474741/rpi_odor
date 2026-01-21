import { NextResponse } from "next/server";
import {
  startLoadCellCalibration,
  setZeroPoint,
  setReferenceWeight,
  saveCalibration,
  cancelCalibration,
} from "@/lib/grpc-client";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, weightGrams } = body;

    let result;
    switch (action) {
      case "start":
        result = await startLoadCellCalibration();
        break;
      case "zero":
        result = await setZeroPoint();
        break;
      case "reference":
        if (!weightGrams || weightGrams <= 0) {
          return NextResponse.json(
            { error: "Invalid weight value" },
            { status: 400 }
          );
        }
        result = await setReferenceWeight(weightGrams);
        break;
      case "save":
        result = await saveCalibration();
        break;
      case "cancel":
        await cancelCalibration();
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
    console.error("Calibration error:", error.message);
    return NextResponse.json(
      { error: "Calibration failed", details: error.message },
      { status: 503 }
    );
  }
}
