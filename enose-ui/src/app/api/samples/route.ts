import { NextRequest, NextResponse } from "next/server";
import { listSamples, getSampleAlignedSeries } from "@/lib/analytics-grpc-client";
import { ListSamplesRequest, Sample } from "@/generated/enose_analytics";
import pool from "@/lib/db";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get("action");

  // 对齐序列数据
  if (action === "aligned-series" || action === "frames") {
    const sampleId = parseInt(searchParams.get("sampleId") || "0");
    const method = searchParams.get("method") || "linear";
    const nSamples = parseInt(searchParams.get("nSamples") || "100");

    try {
      const response = await getSampleAlignedSeries({
        sampleId,
        method,
        nSamples,
        phaseNames: [],
      });

      if (!response.success) {
        return NextResponse.json({
          success: false,
          error: "Failed to get aligned series",
        });
      }

      // 将平铺的序列数组 (n_samples * 8) 转换为点数组
      const pointCount = response.nSamples;
      const sensorCount = response.nSensors || 8;
      const points: { pointIdx: number; values: number[] }[] = [];

      for (let i = 0; i < pointCount; i++) {
        const values: number[] = [];
        for (let j = 0; j < sensorCount; j++) {
          values.push(response.frames[i * sensorCount + j] || 0);
        }
        points.push({
          pointIdx: i,
          values,
        });
      }

      return NextResponse.json({
        success: true,
        frames: points,  // 保持 JSON key 兼容，待前端消费方更新后可改为 points
        nSamples: response.nSamples,
        nSensors: response.nSensors,
        fromCache: response.fromCache,
      });
    } catch (error) {
      console.error("Error fetching sample aligned series:", error);
      return NextResponse.json(
        { success: false, error: "Internal server error" },
        { status: 500 }
      );
    }
  }

  // 获取样本的 ML 标签（按策略名）
  if (action === "labels") {
    const configName = searchParams.get("configName");
    const sampleIdsStr = searchParams.get("sampleIds");
    if (!configName || !sampleIdsStr) {
      return NextResponse.json({ error: "configName and sampleIds required" }, { status: 400 });
    }
    const sampleIds = sampleIdsStr.split(",").map(Number).filter(n => !isNaN(n));
    if (sampleIds.length === 0) {
      return NextResponse.json({ labels: {} });
    }
    try {
      const result = await pool.query(
        `SELECT sml.sample_id, sml.label_str
         FROM sample_ml_labels sml
         JOIN ml_label_configs mlc ON sml.config_id = mlc.id
         WHERE mlc.name = $1 AND sml.sample_id = ANY($2)`,
        [configName, sampleIds]
      );
      const labels: Record<number, string> = {};
      for (const row of result.rows) {
        labels[row.sample_id] = row.label_str;
      }
      return NextResponse.json({ labels });
    } catch (error) {
      console.error("Error fetching sample labels:", error);
      return NextResponse.json({ error: "Failed to fetch labels" }, { status: 500 });
    }
  }

  // 按 ID 批量获取样本（方案C：跨页缓存补全）
  if (action === "byIds") {
    const idsStr = searchParams.get("ids");
    if (!idsStr) {
      return NextResponse.json({ error: "ids required" }, { status: 400 });
    }
    const ids = idsStr.split(",").map(Number).filter(n => !isNaN(n));
    if (ids.length === 0) {
      return NextResponse.json({ samples: [] });
    }
    try {
      // 从数据库直接按 ID 批量查询
      const result = await pool.query(
        `SELECT s.id, s.run_id, s.sample_idx, 
                s.start_time_ms,
                s.end_time_ms,
                s.params_hash, s.total_volume_ml, s.flow_rate_ml_s,
                s.gas_pump_pwm, s.termination_type, s.termination_value,
                s.max_duration_s, s.pre_wash_count, s.phase_name,
                s.avg_temperature_c, s.avg_humidity_pct, s.avg_pressure_hpa,
                s.reagent_batch_id, s.reagent_prep_date, s.prev_sample_id,
                s.samples_since_wash, s.sensor_hours_at_sample,
                s.is_anchor, s.is_blank, s.experiment_phase,
                s.sequence_block, s.randomization_seed,
                s.wash_residual_response, s.quality_score, s.quality_level
         FROM samples s WHERE s.id = ANY($1)`,
        [ids]
      );

      // 获取液体信息
      const liquidResult = await pool.query(
        `SELECT sl.sample_id, l.name, sl.ratio
         FROM sample_liquids sl
         JOIN liquids l ON sl.liquid_id = l.id
         WHERE sl.sample_id = ANY($1)
         ORDER BY sl.sample_id, sl.id`,
        [ids]
      );
      const liquidMap: Record<number, { names: string[]; ratios: number[] }> = {};
      for (const row of liquidResult.rows) {
        if (!liquidMap[row.sample_id]) liquidMap[row.sample_id] = { names: [], ratios: [] };
        liquidMap[row.sample_id].names.push(row.name);
        liquidMap[row.sample_id].ratios.push(row.ratio);
      }

      // 获取加热器配置
      const heaterResult = await pool.query(
        `SELECT sample_id, sensor_indices, profile_name, temps, durs
         FROM sample_heater_configs WHERE sample_id = ANY($1)
         ORDER BY sample_id, id`,
        [ids]
      );
      const heaterMap: Record<number, { sensorIndices: number[]; profileName: string; temps: number[]; durs: number[] }[]> = {};
      for (const row of heaterResult.rows) {
        if (!heaterMap[row.sample_id]) heaterMap[row.sample_id] = [];
        heaterMap[row.sample_id].push({
          sensorIndices: row.sensor_indices || [],
          profileName: row.profile_name || "",
          temps: row.temps || [],
          durs: row.durs || [],
        });
      }

      // 获取 phase transitions
      const ptResult = await pool.query(
        `SELECT id, sample_id, phase_name,
                EXTRACT(EPOCH FROM start_time) * 1000 AS start_time_ms,
                EXTRACT(EPOCH FROM end_time) * 1000 AS end_time_ms,
                phase_order
         FROM sample_phase_transitions WHERE sample_id = ANY($1)
         ORDER BY sample_id, phase_order`,
        [ids]
      );
      const ptMap: Record<number, { id: number; phaseName: string; startTimeMs: number; endTimeMs: number | null; phaseOrder: number }[]> = {};
      for (const row of ptResult.rows) {
        if (!ptMap[row.sample_id]) ptMap[row.sample_id] = [];
        ptMap[row.sample_id].push({
          id: row.id,
          phaseName: row.phase_name,
          startTimeMs: Number(row.start_time_ms),
          endTimeMs: row.end_time_ms ? Number(row.end_time_ms) : null,
          phaseOrder: row.phase_order,
        });
      }

      const samples = result.rows.map((r) => {
        const liq = liquidMap[r.id] || { names: [], ratios: [] };
        const heaters = heaterMap[r.id] || [];
        return {
          id: r.id,
          runId: r.run_id,
          sampleIdx: r.sample_idx,
          startTimeMs: Number(r.start_time_ms) || 0,
          endTimeMs: r.end_time_ms ? Number(r.end_time_ms) : null,
          paramsHash: r.params_hash || "",
          liquidNames: liq.names,
          liquidRatios: liq.ratios,
          totalVolumeMl: r.total_volume_ml || 0,
          flowRateMlS: r.flow_rate_ml_s || 0,
          gasPumpPwm: r.gas_pump_pwm || 0,
          terminationType: r.termination_type || "",
          terminationValue: r.termination_value || 0,
          maxDurationS: r.max_duration_s || 0,
          heaterProfiles: heaters.map(h => h.profileName || `[${h.temps.join(",")}]`),
          heaterConfigs: heaters,
          preWashCount: r.pre_wash_count || 0,
          phaseName: r.phase_name || "",
          avgTemperatureC: r.avg_temperature_c || null,
          avgHumidityPct: r.avg_humidity_pct || null,
          avgPressureHpa: r.avg_pressure_hpa || null,
          durationS: r.end_time_ms && r.start_time_ms
            ? (Number(r.end_time_ms) - Number(r.start_time_ms)) / 1000
            : null,
          phaseTransitions: ptMap[r.id] || [],
          readingCount: 0,
          reagentBatchId: r.reagent_batch_id || null,
          reagentPrepDate: r.reagent_prep_date || null,
          prevSampleId: r.prev_sample_id || null,
          samplesSinceWash: r.samples_since_wash || 0,
          sensorHoursAtSample: r.sensor_hours_at_sample || null,
          isAnchor: r.is_anchor || false,
          isBlank: r.is_blank || false,
          experimentPhase: r.experiment_phase || null,
          sequenceBlock: r.sequence_block || null,
          randomizationSeed: r.randomization_seed || null,
          washResidualResponse: r.wash_residual_response || [],
          qualityScore: r.quality_score || null,
          qualityLevel: r.quality_level || null,
        };
      });

      return NextResponse.json({ samples });
    } catch (error) {
      console.error("Error fetching samples by IDs:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
  // 新增筛选参数（从客户端移至服务端）
  const componentCount = searchParams.get("componentCount"); // 1,2,3,4+
  const qualityLevels = searchParams.get("qualityLevels"); // 逗号分隔
  const showAnchorsOnly = searchParams.get("showAnchorsOnly") === "true";
  const showBlanksOnly = searchParams.get("showBlanksOnly") === "true";
  const hideAnchorsAndBlanks = searchParams.get("hideAnchorsAndBlanks") === "true";
  const experimentPhases = searchParams.get("experimentPhases"); // 逗号分隔
  const searchQuery = searchParams.get("searchQuery") || "";
  const returnIdsOnly = searchParams.get("returnIdsOnly") === "true"; // 方案D：只返回 ID 列表

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

    // 服务端后过滤函数（替代原客户端过滤）
    type MappedSample = ReturnType<typeof mapSample>;
    const applyServerFilters = (samples: MappedSample[]): MappedSample[] => {
      let filtered = samples;

      // 按组件数量过滤
      if (componentCount !== null) {
        const cc = parseInt(componentCount);
        if (!isNaN(cc)) {
          filtered = filtered.filter((s) =>
            cc >= 4 ? s.liquidNames.length >= 4 : s.liquidNames.length === cc
          );
        }
      }

      // 按质量等级过滤
      if (qualityLevels) {
        const levels = qualityLevels.split(",").filter(Boolean);
        if (levels.length > 0) {
          filtered = filtered.filter(
            (s) => s.qualityLevel && levels.includes(s.qualityLevel)
          );
        }
      }

      // 锚点/空白过滤
      if (hideAnchorsAndBlanks) {
        filtered = filtered.filter((s) => !s.isAnchor && !s.isBlank);
      } else if (showAnchorsOnly) {
        filtered = filtered.filter((s) => s.isAnchor);
      } else if (showBlanksOnly) {
        filtered = filtered.filter((s) => s.isBlank);
      }

      // 按实验阶段过滤
      if (experimentPhases) {
        const phases = experimentPhases.split(",").filter(Boolean);
        if (phases.length > 0) {
          filtered = filtered.filter(
            (s) => s.experimentPhase && phases.includes(s.experimentPhase)
          );
        }
      }

      // 搜索过滤
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter((s) => {
          const searchable = [
            `S#${s.id}`,
            `R#${s.runId}`,
            s.liquidNames.join(" "),
            s.phaseName,
            s.paramsHash,
            s.experimentPhase || "",
          ].join(" ").toLowerCase();
          return searchable.includes(q);
        });
      }

      return filtered;
    };

    // 排序函数
    const sortSamples = (samples: MappedSample[]) => {
      const mul = sortOrder === "asc" ? 1 : -1;
      samples.sort((a, b) => {
        switch (sortField) {
          case "sampleId": return mul * (a.id - b.id);
          case "time": return mul * ((a.startTimeMs || 0) - (b.startTimeMs || 0));
          case "runId":
          default: return mul * (a.runId - b.runId) || a.sampleIdx - b.sampleIdx;
        }
      });
    };

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
      const allSamples: MappedSample[] = [];
      const seenIds = new Set<number>();

      for (const response of responses) {
        for (const s of response.samples) {
          if (!seenIds.has(s.id)) {
            seenIds.add(s.id);
            allSamples.push(mapSample(s));
          }
        }
      }

      // 服务端过滤
      const filtered = applyServerFilters(allSamples);

      // 排序
      sortSamples(filtered);

      // 方案D：只返回 ID 列表
      if (returnIdsOnly) {
        return NextResponse.json({
          ids: filtered.map(s => s.id),
          total: filtered.length,
        });
      }

      // 分页
      const paged = filtered.slice(offset, offset + limit);

      return NextResponse.json({
        samples: paged,
        total: filtered.length,
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

    // 服务端过滤
    const filtered = applyServerFilters(allSamples);

    // 排序
    sortSamples(filtered);

    // 方案D：只返回 ID 列表
    if (returnIdsOnly) {
      return NextResponse.json({
        ids: filtered.map(s => s.id),
        total: filtered.length,
      });
    }

    // 分页
    const paged = filtered.slice(offset, offset + limit);

    return NextResponse.json({
      samples: paged,
      total: filtered.length,
    });
  } catch (error) {
    console.error("Error fetching samples:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const sampleIds: number[] = body.sampleIds;

    if (!Array.isArray(sampleIds) || sampleIds.length === 0) {
      return NextResponse.json({ error: "sampleIds is required" }, { status: 400 });
    }

    if (sampleIds.length > 100) {
      return NextResponse.json({ error: "最多一次删除 100 个样本" }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 删除关联数据（按外键依赖顺序）
      await client.query("DELETE FROM sample_ml_labels WHERE sample_id = ANY($1)", [sampleIds]);
      await client.query("DELETE FROM sample_phase_transitions WHERE sample_id = ANY($1)", [sampleIds]);
      await client.query("DELETE FROM sensor_readings_v2 WHERE sample_id = ANY($1)", [sampleIds]);

      // 删除样本本体
      const result = await client.query("DELETE FROM samples WHERE id = ANY($1)", [sampleIds]);

      await client.query("COMMIT");

      return NextResponse.json({
        deleted: result.rowCount,
        sampleIds,
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error deleting samples:", error);
    return NextResponse.json(
      { error: "删除失败: " + String(error) },
      { status: 500 }
    );
  }
}
