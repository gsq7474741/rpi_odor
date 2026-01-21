import { NextResponse } from "next/server";
import { getLoadCellReading } from "@/lib/grpc-client";

export async function GET() {
  try {
    const reading = await getLoadCellReading();
    return NextResponse.json(reading);
  } catch (error: any) {
    console.error("gRPC error:", error.message);
    return NextResponse.json(
      { error: "Failed to get load cell reading", details: error.message },
      { status: 503 }
    );
  }
}
