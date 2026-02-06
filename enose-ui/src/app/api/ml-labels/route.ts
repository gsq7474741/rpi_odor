import { NextRequest, NextResponse } from "next/server";
import {
  listMLLabelConfigs,
  generateLabels,
  getLabelDistribution,
  previewDataset,
} from "@/lib/analytics-grpc-client";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get("action");

  try {
    // 列出标签策略
    if (!action || action === "configs") {
      const activeOnly = searchParams.get("activeOnly") !== "false";
      const response = await listMLLabelConfigs({ activeOnly });
      return NextResponse.json({
        configs: response.configs.map((c) => ({
          id: c.id,
          name: c.name,
          labelType: c.labelType,
          strategy: c.strategy,
          configJson: c.configJson,
          description: c.description,
          isActive: c.isActive,
          labelCount: c.labelCount,
        })),
      });
    }

    // 获取标签分布
    if (action === "distribution") {
      const configName = searchParams.get("configName");
      if (!configName) {
        return NextResponse.json({ error: "configName required" }, { status: 400 });
      }
      const runIdsStr = searchParams.get("runIds");
      const phaseNamesStr = searchParams.get("phaseNames");
      const sampleIdsStr = searchParams.get("sampleIds");
      const runIds = runIdsStr ? runIdsStr.split(",").map(Number) : [];
      const phaseNames = phaseNamesStr ? phaseNamesStr.split(",") : [];
      const sampleIds = sampleIdsStr ? sampleIdsStr.split(",").map(Number) : [];

      const response = await getLabelDistribution({
        configName,
        runIds,
        phaseNames,
        sampleIds,
      });
      return NextResponse.json({
        configName: response.configName,
        labelType: response.labelType,
        totalSamples: response.totalSamples,
        buckets: response.buckets.map((b) => ({
          label: b.label,
          count: b.count,
          labelIndex: b.labelIndex,
        })),
      });
    }

    // 预览数据集
    if (action === "preview") {
      const configName = searchParams.get("configName");
      if (!configName) {
        return NextResponse.json({ error: "configName required" }, { status: 400 });
      }
      const runIdsStr = searchParams.get("runIds");
      const phaseNamesStr = searchParams.get("phaseNames");
      const sampleIdsStr = searchParams.get("sampleIds");
      const runIds = runIdsStr ? runIdsStr.split(",").map(Number) : [];
      const phaseNames = phaseNamesStr ? phaseNamesStr.split(",") : [];
      const sampleIds = sampleIdsStr ? sampleIdsStr.split(",").map(Number) : [];
      const trainRatio = parseFloat(searchParams.get("trainRatio") || "0.7");
      const valRatio = parseFloat(searchParams.get("valRatio") || "0.15");
      const testRatio = parseFloat(searchParams.get("testRatio") || "0.15");

      const response = await previewDataset({
        configName,
        runIds,
        phaseNames,
        sampleIds,
        trainRatio,
        valRatio,
        testRatio,
      });
      return NextResponse.json({
        configName: response.configName,
        labelType: response.labelType,
        totalSamples: response.totalSamples,
        trainCount: response.trainCount,
        valCount: response.valCount,
        testCount: response.testCount,
        labelDistribution: response.labelDistribution.map((b) => ({
          label: b.label,
          count: b.count,
          labelIndex: b.labelIndex,
        })),
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("ML Labels API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get("action");

  try {
    // 生成标签
    if (action === "generate") {
      const body = await request.json();
      const response = await generateLabels({
        configName: body.configName || "",
        runIds: body.runIds || [],
        phaseNames: body.phaseNames || [],
        sampleIds: body.sampleIds || [],
      });
      return NextResponse.json({
        generatedCounts: response.generatedCounts,
        message: response.message,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("ML Labels API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
