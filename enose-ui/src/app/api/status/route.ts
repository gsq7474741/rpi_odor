import { NextResponse } from "next/server";
import { getStatus } from "@/lib/grpc-client";

export async function GET() {
  try {
    const status = await getStatus();
    return NextResponse.json(status);
  } catch (error: any) {
    console.error("gRPC error:", error.message);
    return NextResponse.json(
      { error: "Failed to get status", details: error.message },
      { status: 503 }
    );
  }
}
