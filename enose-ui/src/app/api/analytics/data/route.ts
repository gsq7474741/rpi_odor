import { NextRequest, NextResponse } from "next/server";
import {
  listExperiments,
  querySensorData,
  getAggregatedStats,
  getExperimentDetail,
  generateNormalizedFrames,
} from "@/lib/analytics-grpc-client";
import { Timestamp } from "@/generated/google/protobuf/timestamp";
import { AggregationDimension } from "@/generated/enose_analytics";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "experiments";

  try {
    switch (action) {
      case "experiments": {
        const limit = parseInt(searchParams.get("limit") || "50");
        const offset = parseInt(searchParams.get("offset") || "0");
        const labelId = searchParams.get("labelId") || undefined;

        const response = await listExperiments({
          limit,
          offset,
          labelId,
        });

        return NextResponse.json({
          success: true,
          experiments: response.experiments.map((exp) => ({
            experimentId: exp.experimentId,
            startTime: exp.startTime ? Timestamp.toDate(exp.startTime).toISOString() : null,
            endTime: exp.endTime ? Timestamp.toDate(exp.endTime).toISOString() : null,
            frameCount: exp.frameCount,
            sampleCount: (exp as { sampleCount?: number }).sampleCount || 0,
            phases: exp.phases,
            labels: exp.labels,
            status: exp.status,
          })),
          total: response.total,
        });
      }

      case "sensor-data": {
        const experimentId = searchParams.get("experimentId") || undefined;
        const labelId = searchParams.get("labelId") || undefined;
        const phase = searchParams.get("phase") || undefined;
        const limit = parseInt(searchParams.get("limit") || "1000");
        const offset = parseInt(searchParams.get("offset") || "0");
        const downsampleFactor = parseInt(searchParams.get("downsample") || "1");

        const response = await querySensorData({
          experimentId,
          labelId,
          phase,
          limit,
          offset,
          downsampleFactor,
          fields: [],
        });

        return NextResponse.json({
          success: true,
          rows: response.rows.map((row) => ({
            ts: row.ts ? Timestamp.toDate(row.ts).toISOString() : null,
            seq: Number(row.seq),
            experimentId: row.experimentId,
            phase: row.phase,
            moxReadings: row.moxReadings,
            temperature: row.temperature,
            humidity: row.humidity,
            heaterStep: row.heaterStep,
            label: row.label,
          })),
          total: response.total,
          returned: response.returned,
          columns: response.columns,
        });
      }

      case "aggregated": {
        const dimensionStr = searchParams.get("dimension") || "experiment";
        const experimentId = searchParams.get("experimentId") || undefined;
        const labelId = searchParams.get("labelId") || undefined;
        const timeBucket = searchParams.get("timeBucket") || "1h";

        const dimensionMap: Record<string, AggregationDimension> = {
          experiment: AggregationDimension.AGG_BY_EXPERIMENT,
          label: AggregationDimension.AGG_BY_LABEL,
          phase: AggregationDimension.AGG_BY_PHASE,
          time: AggregationDimension.AGG_BY_TIME,
          heaterStep: AggregationDimension.AGG_BY_HEATER_STEP,
          sensor: AggregationDimension.AGG_BY_SENSOR,
        };

        const response = await getAggregatedStats({
          dimension: dimensionMap[dimensionStr] || AggregationDimension.AGG_BY_EXPERIMENT,
          experimentId,
          labelId,
          timeBucket,
          sensorIndices: [],
        });

        return NextResponse.json({
          success: true,
          groups: response.groups.map((group) => ({
            key: group.key,
            label: group.label,
            sampleCount: group.sampleCount,
            sensorStats: group.sensorStats.map((s) => ({
              sensorIdx: s.sensorIdx,
              min: s.min,
              max: s.max,
              mean: s.mean,
              std: s.std,
              median: s.median,
            })),
            avgTemperature: group.avgTemperature,
            avgHumidity: group.avgHumidity,
            startTime: group.startTime ? Timestamp.toDate(group.startTime).toISOString() : null,
            endTime: group.endTime ? Timestamp.toDate(group.endTime).toISOString() : null,
          })),
          dimension: dimensionStr,
        });
      }

      case "experiment-detail": {
        const experimentId = searchParams.get("experimentId");
        if (!experimentId) {
          return NextResponse.json(
            { success: false, error: "Missing experimentId" },
            { status: 400 }
          );
        }

        const response = await getExperimentDetail({ experimentId });

        return NextResponse.json({
          success: true,
          detail: {
            experimentId: response.experimentId,
            startTime: response.startTime ? Timestamp.toDate(response.startTime).toISOString() : null,
            endTime: response.endTime ? Timestamp.toDate(response.endTime).toISOString() : null,
            frameCount: response.frameCount,
            status: response.status,
            phases: response.phases.map((p) => ({
              name: p.name,
              startTime: p.startTime ? Timestamp.toDate(p.startTime).toISOString() : null,
              endTime: p.endTime ? Timestamp.toDate(p.endTime).toISOString() : null,
              frameCount: p.frameCount,
            })),
            labels: response.labels,
            sensorSummary: response.sensorSummary.map((s) => ({
              sensorIdx: s.sensorIdx,
              min: s.min,
              max: s.max,
              mean: s.mean,
              std: s.std,
              median: s.median,
            })),
            avgTemperature: response.avgTemperature,
            avgHumidity: response.avgHumidity,
            totalAlerts: response.totalAlerts,
            criticalAlerts: response.criticalAlerts,
            warningAlerts: response.warningAlerts,
          },
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Data API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action;

    switch (action) {
      case "generate-frames": {
        const { runIds, nSamples = 100, methods = ["linear"] } = body;
        
        if (!runIds || !Array.isArray(runIds) || runIds.length === 0) {
          return NextResponse.json(
            { success: false, error: "Missing runIds" },
            { status: 400 }
          );
        }

        const results: Record<number, { success: boolean; message: string; framesGenerated?: Record<string, number> }> = {};

        for (const runId of runIds) {
          try {
            const response = await generateNormalizedFrames({
              runId: parseInt(runId),
              nSamples,
              methods,
              phaseNames: [],
            });
            // framesGenerated is a Map from protobuf-ts
            const framesMap: Record<string, number> = {};
            for (const [key, value] of Object.entries(response.framesGenerated)) {
              framesMap[key] = value;
            }
            results[runId] = {
              success: response.success,
              message: response.message,
              framesGenerated: framesMap,
            };
          } catch (err) {
            results[runId] = {
              success: false,
              message: err instanceof Error ? err.message : "Unknown error",
            };
          }
        }

        const totalGenerated = Object.values(results)
          .filter(r => r.success)
          .reduce((sum, r) => sum + Object.values(r.framesGenerated || {}).reduce((a, b) => a + b, 0), 0);

        return NextResponse.json({
          success: true,
          results,
          totalGenerated,
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Data API POST error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
