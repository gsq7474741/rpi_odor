import { NextRequest, NextResponse } from "next/server";
import { runPump, stopAllPumps } from "@/lib/grpc-client";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pump_name, speed, distance, accel } = body;

    if (!pump_name || speed === undefined) {
      return NextResponse.json(
        { error: "pump_name and speed are required" },
        { status: 400 }
      );
    }

    const response = await runPump(pump_name, speed, distance, accel);
    return NextResponse.json(response);
  } catch (error: any) {
    console.error("gRPC error:", error.message);
    return NextResponse.json(
      { error: "Failed to run pump", details: error.message },
      { status: 503 }
    );
  }
}

export async function DELETE() {
  try {
    const response = await stopAllPumps();
    return NextResponse.json(response);
  } catch (error: any) {
    console.error("gRPC error:", error.message);
    return NextResponse.json(
      { error: "Failed to stop pumps", details: error.message },
      { status: 503 }
    );
  }
}
