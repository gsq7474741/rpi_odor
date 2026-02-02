import { NextResponse } from "next/server";
import { checkAnalyticsConnection } from "@/lib/analytics-grpc-client";

export async function GET() {
  const startTime = performance.now();

  try {
    const connected = await checkAnalyticsConnection();
    const grpcTime = Math.round(performance.now() - startTime);

    return NextResponse.json({
      success: true,
      connected,
      grpcTime,
      service: "enose-analytics",
    });
  } catch (error) {
    console.error("Analytics ping failed:", error);
    return NextResponse.json({
      success: false,
      connected: false,
      grpcTime: null,
      service: "enose-analytics",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
