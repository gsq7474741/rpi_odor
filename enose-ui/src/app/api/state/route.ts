import { NextRequest, NextResponse } from "next/server";
import { setSystemState } from "@/lib/grpc-client";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { target_state } = body;

    if (!target_state) {
      return NextResponse.json(
        { error: "target_state is required" },
        { status: 400 }
      );
    }

    const response = await setSystemState(target_state);
    return NextResponse.json(response);
  } catch (error: any) {
    console.error("gRPC error:", error.message);
    return NextResponse.json(
      { error: "Failed to set state", details: error.message },
      { status: 503 }
    );
  }
}
