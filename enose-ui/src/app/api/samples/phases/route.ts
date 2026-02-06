import { NextRequest, NextResponse } from "next/server";
import { getAvailablePhases } from "@/lib/analytics-grpc-client";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const runId = searchParams.get("runId");

  try {
    const response = await getAvailablePhases({
      runId: runId ? parseInt(runId) : undefined,
    });

    return NextResponse.json({
      phases: response.phaseNames,
    });
  } catch (error) {
    console.error("Error fetching available phases:", error);
    return NextResponse.json(
      { error: "Internal server error", phases: [] },
      { status: 500 }
    );
  }
}
