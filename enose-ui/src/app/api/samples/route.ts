import { NextRequest, NextResponse } from "next/server";
import { listSamples, getSampleFrames } from "@/lib/analytics-grpc-client";
import { ListSamplesRequest, Sample } from "@/generated/enose_analytics";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get("action");

  // 归一化帧数据
  if (action === "frames") {
    const sampleId = parseInt(searchParams.get("sampleId") || "0");
    const method = searchParams.get("method") || "linear";
    const nSamples = parseInt(searchParams.get("nSamples") || "100");

    try {
      const response = await getSampleFrames({
        sampleId,
        method,
        nSamples,
      });

      if (!response.success) {
        return NextResponse.json({
          success: false,
          error: "Failed to get frames",
        });
      }

      // 将平铺的 frames 数组 (n_samples * 8) 转换为帧数组
      const frameCount = response.nSamples;
      const sensorCount = response.nSensors || 8;
      const frames: { frameIdx: number; values: number[] }[] = [];

      for (let i = 0; i < frameCount; i++) {
        const values: number[] = [];
        for (let j = 0; j < sensorCount; j++) {
          values.push(response.frames[i * sensorCount + j] || 0);
        }
        frames.push({
          frameIdx: i,
          values,
        });
      }

      return NextResponse.json({
        success: true,
        frames,
        nSamples: response.nSamples,
        nSensors: response.nSensors,
        fromCache: response.fromCache,
      });
    } catch (error) {
      console.error("Error fetching sample frames:", error);
      return NextResponse.json(
        { success: false, error: "Internal server error" },
        { status: 500 }
      );
    }
  }

  // 默认：列出样本
  const runId = searchParams.get("runId");
  const runIds = searchParams.get("runIds"); // 逗号分隔的多 runId
  const phase = searchParams.get("phase");
  const paramsHash = searchParams.get("paramsHash");
  const liquid = searchParams.get("liquid");
  const limit = parseInt(searchParams.get("limit") || "100");
  const offset = parseInt(searchParams.get("offset") || "0");
  const sortField = searchParams.get("sortField") || "runId"; // runId | sampleId | time
  const sortOrder = searchParams.get("sortOrder") || "desc";  // asc | desc

  try {
    // 解析 runId 列表
    const runIdList: number[] = [];
    if (runIds) {
      runIdList.push(...runIds.split(",").map(Number).filter(n => !isNaN(n)));
    } else if (runId) {
      runIdList.push(parseInt(runId));
    }

    const mapSample = (s: Sample) => ({
      id: s.id,
      runId: s.runId,
      sampleIdx: s.sampleIdx,
      startTimeMs: Number(s.startTimeMs),
      endTimeMs: s.endTimeMs ? Number(s.endTimeMs) : null,
      paramsHash: s.paramsHash,
      liquidNames: s.liquids.map((l) => l.name),
      liquidRatios: s.liquids.map((l) => l.ratio),
      totalVolumeMl: s.totalVolumeMl,
      flowRateMlS: s.flowRateMlS,
      gasPumpPwm: s.gasPumpPwm,
      terminationType: s.terminationType,
      terminationValue: s.terminationValue,
      maxDurationS: s.maxDurationS,
      heaterProfiles: s.heaterConfigs.map((h) => h.profileName || `[${h.temps.join(",")}]`),
      heaterConfigs: s.heaterConfigs.map((h) => ({
        sensorIndices: h.sensorIndices,
        profileName: h.profileName,
        temps: h.temps,
        durs: h.durs,
      })),
      preWashCount: s.preWashCount,
      phaseName: s.phaseName,
      avgTemperatureC: s.avgTemperatureC || null,
      avgHumidityPct: s.avgHumidityPct || null,
      avgPressureHpa: s.avgPressureHpa || null,
      durationS: s.endTimeMs && s.startTimeMs 
        ? (Number(s.endTimeMs) - Number(s.startTimeMs)) / 1000 
        : null,
      phaseTransitions: s.phaseTransitions.map((t) => ({
        id: t.id,
        phaseName: t.phaseName,
        startTimeMs: Number(t.startTimeMs),
        endTimeMs: t.endTimeMs ? Number(t.endTimeMs) : null,
        phaseOrder: t.phaseOrder,
      })),
      readingCount: s.readingCount,
      // 组合实验元数据 (0016)
      reagentBatchId: s.reagentBatchId || null,
      reagentPrepDate: s.reagentPrepDate || null,
      prevSampleId: s.prevSampleId || null,
      samplesSinceWash: s.samplesSinceWash || 0,
      sensorHoursAtSample: s.sensorHoursAtSample || null,
      isAnchor: s.isAnchor || false,
      isBlank: s.isBlank || false,
      experimentPhase: s.experimentPhase || null,
      sequenceBlock: s.sequenceBlock || null,
      randomizationSeed: s.randomizationSeed || null,
      washResidualResponse: s.washResidualResponse || [],
      qualityScore: s.qualityScore || null,
      qualityLevel: s.qualityLevel || null,
    });

    // 多 runId: 并行请求后合并
    if (runIdList.length > 1) {
      const responses = await Promise.all(
        runIdList.map((rid) =>
          listSamples({
            runId: rid,
            phaseName: phase || undefined,
            paramsHash: paramsHash || undefined,
            liquidIds: liquid ? liquid.split(",") : [],
            limit: 1000, // 每个 run 取足够多
            offset: 0,
          })
        )
      );

      // 合并去重
      const allSamples: ReturnType<typeof mapSample>[] = [];
      const seenIds = new Set<number>();
      let total = 0;

      for (const response of responses) {
        total += response.total;
        for (const s of response.samples) {
          if (!seenIds.has(s.id)) {
            seenIds.add(s.id);
            allSamples.push(mapSample(s));
          }
        }
      }

      // 排序
      const mul = sortOrder === "asc" ? 1 : -1;
      allSamples.sort((a, b) => {
        switch (sortField) {
          case "sampleId": return mul * (a.id - b.id);
          case "time": return mul * ((a.startTimeMs || 0) - (b.startTimeMs || 0));
          case "runId":
          default: return mul * (a.runId - b.runId) || a.sampleIdx - b.sampleIdx;
        }
      });

      // 分页
      const paged = allSamples.slice(offset, offset + limit);

      return NextResponse.json({
        samples: paged,
        total: allSamples.length,
      });
    }

    // 单 runId 或无 runId — 也统一获取全部再排序分页
    const grpcRequest: Partial<ListSamplesRequest> & { limit: number; offset: number; liquidIds: string[] } = {
      limit: 10000, // 获取全部用于排序
      offset: 0,
      liquidIds: liquid ? liquid.split(",") : [],
    };
    if (runIdList.length === 1) grpcRequest.runId = runIdList[0];
    if (phase) grpcRequest.phaseName = phase;
    if (paramsHash) grpcRequest.paramsHash = paramsHash;

    const response = await listSamples(grpcRequest);
    const allSamples = response.samples.map(mapSample);

    // 排序
    const mul = sortOrder === "asc" ? 1 : -1;
    allSamples.sort((a, b) => {
      switch (sortField) {
        case "sampleId": return mul * (a.id - b.id);
        case "time": return mul * ((a.startTimeMs || 0) - (b.startTimeMs || 0));
        case "runId":
        default: return mul * (a.runId - b.runId) || a.sampleIdx - b.sampleIdx;
      }
    });

    // 分页
    const paged = allSamples.slice(offset, offset + limit);

    return NextResponse.json({
      samples: paged,
      total: allSamples.length,
    });
  } catch (error) {
    console.error("Error fetching samples:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
