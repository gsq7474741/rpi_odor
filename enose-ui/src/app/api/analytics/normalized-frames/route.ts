import { NextRequest, NextResponse } from "next/server";
import { getNormalizedFramesStatus, generateNormalizedFrames } from "@/lib/analytics-grpc-client";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const runId = parseInt(searchParams.get("runId") || "0");
  const phaseName = searchParams.get("phaseName") || undefined;

  if (!runId) {
    return NextResponse.json(
      { error: "runId is required" },
      { status: 400 }
    );
  }

  try {
    const response = await getNormalizedFramesStatus({
      runId,
      phaseName: phaseName || "",
    });

    return NextResponse.json({
      exists: response.exists,
      totalFrames: response.totalFrames,
      meta: response.meta.map((m) => ({
        method: m.method,
        nSamples: m.nSamples,
        originalPointCounts: m.originalPointCounts,
        timeRangeMs: typeof m.timeRangeMs === 'string' ? parseInt(m.timeRangeMs) : Number(m.timeRangeMs),
        phaseName: m.phaseName,
      })),
    });
  } catch (error) {
    console.error("Failed to get normalized frames status:", error);
    return NextResponse.json(
      { error: "Failed to get normalized frames status" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { runId, phaseNames, nSamples, methods } = body;

    if (!runId) {
      return NextResponse.json(
        { error: "runId is required" },
        { status: 400 }
      );
    }

    const response = await generateNormalizedFrames({
      runId,
      phaseNames: phaseNames || [],
      nSamples: nSamples || 100,
      methods: methods || ["linear", "pchip"],
    });

    return NextResponse.json({
      success: response.success,
      message: response.message,
      framesGenerated: response.framesGenerated,
    });
  } catch (error) {
    console.error("Failed to generate normalized frames:", error);
    return NextResponse.json(
      { error: "Failed to generate normalized frames" },
      { status: 500 }
    );
  }
}
