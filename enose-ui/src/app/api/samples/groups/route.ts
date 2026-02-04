import { NextRequest, NextResponse } from "next/server";
import { getSampleGroups } from "@/lib/analytics-grpc-client";
import { GetSampleGroupsRequest } from "@/generated/enose_analytics";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const phase = searchParams.get("phase");
  const liquid = searchParams.get("liquid");
  const limit = parseInt(searchParams.get("limit") || "100");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    // 构建 gRPC 请求
    const grpcRequest: GetSampleGroupsRequest = {
      limit,
      offset,
      liquidIds: liquid ? liquid.split(",") : [],
    };
    if (phase) grpcRequest.phaseName = phase;

    const response = await getSampleGroups(grpcRequest);

    // 转换响应格式以匹配前端期望
    const groups = response.groups.map((g) => ({
      paramsHash: g.paramsHash,
      liquidNames: g.liquids.map((l) => l.name),
      gasPumpPwm: g.gasPumpPwm,
      phaseName: g.phaseName,
      sampleCount: g.sampleCount,
      runIds: g.runIds,
      firstCreated: g.firstCreated ? new Date(Number(g.firstCreated.seconds) * 1000).toISOString() : null,
      lastCreated: g.lastCreated ? new Date(Number(g.lastCreated.seconds) * 1000).toISOString() : null,
    }));

    return NextResponse.json({
      groups,
      total: response.total,
    });
  } catch (error) {
    console.error("Error fetching sample groups:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
