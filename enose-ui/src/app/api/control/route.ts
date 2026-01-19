import { NextRequest, NextResponse } from "next/server";
import { manualControl } from "@/lib/grpc-client";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { peripheral_name, value } = body;

    if (!peripheral_name || value === undefined) {
      return NextResponse.json(
        { error: "peripheral_name and value are required" },
        { status: 400 }
      );
    }

    const response = await manualControl(peripheral_name, value);
    return NextResponse.json(response);
  } catch (error: any) {
    console.error("gRPC error:", error.message);
    return NextResponse.json(
      { error: "Failed to control peripheral", details: error.message },
      { status: 503 }
    );
  }
}
