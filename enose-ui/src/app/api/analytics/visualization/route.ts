import { NextRequest, NextResponse } from "next/server";
import { getVisualization } from "@/lib/analytics-grpc-client";
import { VisualizationType } from "@/generated/enose_analytics";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get("type") || "PCA";
  const nComponents = parseInt(searchParams.get("nComponents") || "2");
  const perplexity = parseInt(searchParams.get("perplexity") || "30");
  const nClusters = parseInt(searchParams.get("nClusters") || "5");
  const maxPoints = parseInt(searchParams.get("maxPoints") || "500");
  
  // 支持多个 run ID（逗号分隔）
  const experimentIds = searchParams.get("experimentIds");
  const experimentId = searchParams.get("experimentId");
  const phaseNames = searchParams.get("phaseNames");
  const sampleIds = searchParams.get("sampleIds");  // 优先使用 sample IDs

  // 映射类型字符串到枚举
  const typeMap: Record<string, VisualizationType> = {
    PCA: VisualizationType.VIS_PCA,
    TSNE: VisualizationType.VIS_TSNE,
    CLUSTERING: VisualizationType.VIS_CLUSTERING,
    PCA_CLUSTERING: VisualizationType.VIS_PCA_CLUSTERING,
  };

  try {
    // 合并多个 run 的结果
    const runIds = experimentIds 
      ? experimentIds.split(",").map(id => id.trim()).filter(Boolean)
      : experimentId 
        ? [experimentId] 
        : [];

    if (runIds.length === 0) {
      return NextResponse.json({ error: "No experiment IDs provided" }, { status: 400 });
    }

    // 优先使用 sampleIds（每个 sample 一个点）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const request: any = {
      type: typeMap[type] || VisualizationType.VIS_PCA,
      nComponents,
      perplexity,
      nClusters,
      maxPoints,
      experimentId: runIds[0] || "",
    };
    if (sampleIds) {
      request.sampleIds = sampleIds;  // 传递 sample IDs（Proto 9 号字段）
    }
    const response = await getVisualization(request);

    // 转换响应格式
    const points = response.points.map((p) => ({
      id: p.id,
      coords: p.coords,
      cluster: p.cluster,
      label: p.label || undefined,
      ts: p.ts ? new Date(Number(p.ts.seconds) * 1000).toISOString() : undefined,
    }));

    const centers = response.centers.map((c) => ({
      id: c.id,
      coords: c.coords,
      cluster: c.cluster,
    }));

    return NextResponse.json({
      type,
      points,
      centers,
      explainedVarianceRatio: response.explainedVarianceRatio,
      totalSamples: response.totalSamples,
      nClusters: response.nClusters,
    });
  } catch (error) {
    console.error("Failed to compute visualization:", error);
    return NextResponse.json(
      { error: "Failed to compute visualization" },
      { status: 500 }
    );
  }
}
