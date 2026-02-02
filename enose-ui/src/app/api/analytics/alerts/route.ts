import { NextRequest, NextResponse } from "next/server";

// 注意: 质量告警从数据库读取，目前通过 enose-analytics 的 QualityRepository
// 暂时保留模拟数据，后续可添加 gRPC 接口获取历史告警

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const severity = searchParams.get("severity");
  const flag = searchParams.get("flag");
  const limit = searchParams.get("limit") || "100";

  try {
    // TODO: 添加 GetQualityAlerts gRPC 方法从数据库获取历史告警
    // 目前返回空数据，表示没有告警
    const alerts: Array<{
      id: number;
      ts: string;
      flag: string;
      severity: string;
      message: string;
      channel: number;
      value: number;
      threshold: number;
    }> = [];

    // 过滤
    let filtered = alerts;
    if (severity && severity !== "all") {
      filtered = filtered.filter((a) => a.severity === severity);
    }
    if (flag && flag !== "all") {
      filtered = filtered.filter((a) => a.flag === flag);
    }

    return NextResponse.json({ alerts: filtered.slice(0, parseInt(limit)) });
  } catch (error) {
    console.error("Failed to fetch alerts:", error);
    return NextResponse.json(
      { error: "Failed to fetch alerts" },
      { status: 500 }
    );
  }
}
