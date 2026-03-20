import { NextRequest, NextResponse } from "next/server";
import { 
  getSampleAlignedSeriesStatus, 
  getBatchSampleAlignedSeriesStatus,
  generateSampleAlignedSeries,
  generateBatchSampleAlignedSeries,
  getSampleAlignedSeries 
} from "@/lib/analytics-grpc-client";

// GET /api/analytics/sample-aligned-series?sampleId=123
// GET /api/analytics/sample-aligned-series?sampleIds=123,456,789 (批量查询)
// 获取指定 sample 的对齐序列状态
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const sampleIdsParam = searchParams.get("sampleIds");
  const sampleId = parseInt(searchParams.get("sampleId") || "0");

  // 批量查询模式
  if (sampleIdsParam) {
    const sampleIds = sampleIdsParam.split(",").map(id => parseInt(id.trim())).filter(id => id > 0);
    
    if (sampleIds.length === 0) {
      return NextResponse.json(
        { error: "sampleIds is required" },
        { status: 400 }
      );
    }

    try {
      const response = await getBatchSampleAlignedSeriesStatus({ sampleIds });
      
      // 转换 map 为对象
      const statuses: Record<number, {
        exists: boolean;
        cached: boolean;
        variants: Array<{
          method: string;
          nSamples: number;
          originalPointCounts: number[];
          timeRangeMs: number;
        }>;
      }> = {};
      
      for (const [id, status] of Object.entries(response.statuses)) {
        statuses[parseInt(id)] = {
          exists: status.exists,
          cached: status.cached,
          variants: status.variants.map((v) => ({
            method: v.method,
            nSamples: v.nSamples,
            originalPointCounts: [...v.originalPointCounts],
            timeRangeMs: typeof v.timeRangeMs === "string" 
              ? parseInt(v.timeRangeMs) 
              : Number(v.timeRangeMs),
          })),
        };
      }

      return NextResponse.json({ statuses });
    } catch (error) {
      console.error("Failed to get batch sample aligned series status:", error);
      return NextResponse.json(
        { error: "Failed to get batch sample aligned series status" },
        { status: 500 }
      );
    }
  }

  // 单条查询模式（保持向后兼容）
  if (!sampleId) {
    return NextResponse.json(
      { error: "sampleId or sampleIds is required" },
      { status: 400 }
    );
  }

  try {
    const response = await getSampleAlignedSeriesStatus({ sampleId });

    return NextResponse.json({
      exists: response.exists,
      cached: response.cached,
      variants: response.variants.map((v) => ({
        method: v.method,
        nSamples: v.nSamples,
        originalPointCounts: v.originalPointCounts,
        timeRangeMs: typeof v.timeRangeMs === "string" 
          ? parseInt(v.timeRangeMs) 
          : Number(v.timeRangeMs),
      })),
    });
  } catch (error) {
    console.error("Failed to get sample aligned series status:", error);
    return NextResponse.json(
      { error: "Failed to get sample aligned series status" },
      { status: 500 }
    );
  }
}

// POST /api/analytics/sample-aligned-series
// 生成或获取指定 sample 的对齐序列
// 支持批量: { sampleIds: [1,2,3], action: "generateBatch" }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sampleId, sampleIds, nSamples, method, useCache, action, phaseNames } = body;

    // 批量生成模式
    if (action === "generateBatch" && sampleIds && Array.isArray(sampleIds)) {
      const response = await generateBatchSampleAlignedSeries({
        sampleIds: sampleIds.map((id: number | string) => typeof id === 'string' ? parseInt(id) : id),
        nSamples: nSamples || 50,
        methods: body.methods || ["linear", "pchip"],
        useCache: useCache !== false,
      });

      return NextResponse.json({
        totalSamples: response.totalSamples,
        successCount: response.successCount,
        failedCount: response.failedCount,
        fromCacheCount: response.fromCacheCount,
        errors: response.errors,
      });
    }

    // 单个样本操作需要 sampleId
    if (!sampleId) {
      return NextResponse.json(
        { error: "sampleId is required for single sample operations" },
        { status: 400 }
      );
    }

    // action: "generate" | "get" (默认 generate)
    if (action === "get") {
      const response = await getSampleAlignedSeries({
        sampleId,
        nSamples: nSamples || 50,
        method: method || "linear",
        useCache: useCache !== false,
        phaseNames: Array.isArray(phaseNames) ? phaseNames : [],
      });

      return NextResponse.json({
        success: response.success,
        frames: response.alignedSeries,
        nSamples: response.nSamples,
        nChannels: response.nChannels,
        fromCache: response.fromCache,
      });
    }

    // 默认: 生成对齐序列
    const response = await generateSampleAlignedSeries({
      sampleId,
      nSamples: nSamples || 50,
      methods: body.methods || ["linear", "pchip"],
      useCache: useCache !== false,
    });

    return NextResponse.json({
      success: response.success,
      message: response.message,
      framesGenerated: response.framesGenerated,
      fromCache: response.fromCache,
    });
  } catch (error) {
    console.error("Failed to process sample aligned series:", error);
    return NextResponse.json(
      { error: "Failed to process sample aligned series" },
      { status: 500 }
    );
  }
}
