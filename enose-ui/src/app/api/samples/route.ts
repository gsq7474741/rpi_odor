import { NextRequest, NextResponse } from "next/server";
import { listSamples } from "@/lib/analytics-grpc-client";
import { ListSamplesRequest } from "@/generated/enose_analytics";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const runId = searchParams.get("runId");
  const phase = searchParams.get("phase");
  const paramsHash = searchParams.get("paramsHash");
  const liquid = searchParams.get("liquid");
  const limit = parseInt(searchParams.get("limit") || "100");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    // 构建 gRPC 请求
    const grpcRequest: Partial<ListSamplesRequest> & { limit: number; offset: number; liquidIds: string[] } = {
      limit,
      offset,
      liquidIds: liquid ? liquid.split(",") : [],
    };
    if (runId) grpcRequest.runId = parseInt(runId);
    if (phase) grpcRequest.phaseName = phase;
    if (paramsHash) grpcRequest.paramsHash = paramsHash;

    const response = await listSamples(grpcRequest);

    // 转换响应格式以匹配前端期望
    const samples = response.samples.map((s) => ({
      id: s.id,
      runId: s.runId,
      sampleIdx: s.sampleIdx,
      startTimeMs: Number(s.startTimeMs),
      endTimeMs: s.endTimeMs ? Number(s.endTimeMs) : null,
      paramsHash: s.paramsHash,
      liquidNames: s.liquids.map((l) => l.name),
      liquidRatios: s.liquids.map((l) => l.ratio),
      totalVolumeMl: s.totalVolumeMl,
      gasPumpPwm: s.gasPumpPwm,
      phaseName: s.phaseName,
      durationS: s.endTimeMs && s.startTimeMs 
        ? (Number(s.endTimeMs) - Number(s.startTimeMs)) / 1000 
        : null,
    }));

    return NextResponse.json({
      samples,
      total: response.total,
    });
  } catch (error) {
    console.error("Error fetching samples:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
