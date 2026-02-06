import { NextRequest, NextResponse } from "next/server";
import { exportData } from "@/lib/analytics-grpc-client";
import type { ExportDataRequest } from "@/generated/enose_analytics";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const grpcRequest: ExportDataRequest = {
      sampleIds: body.sampleIds || [],
      includeParams: body.includeParams ?? false,
      includeRawData: body.includeRawData ?? false,
      includeFrames: body.includeFrames ?? false,
      includeMlLabels: body.includeMlLabels ?? false,
      includeDataset: body.includeDataset ?? false,
      frameMethod: body.frameMethod || "linear",
      frameNSamples: body.frameNSamples || 100,
      frameFormat: body.frameFormat || "npz",
      mlLabelConfigs: body.mlLabelConfigs || [],
      datasetLabelConfig: body.datasetLabelConfig || "",
      datasetSplit: body.datasetSplit ?? false,
      datasetTrainRatio: body.datasetTrainRatio || 0.7,
      datasetValRatio: body.datasetValRatio || 0.15,
      datasetFormat: body.datasetFormat || "npz",
    };

    if (!grpcRequest.sampleIds.length) {
      return NextResponse.json(
        { error: "sampleIds is required" },
        { status: 400 }
      );
    }

    console.log(
      `[Export] Exporting ${grpcRequest.sampleIds.length} samples:`,
      `params=${grpcRequest.includeParams}`,
      `raw=${grpcRequest.includeRawData}`,
      `frames=${grpcRequest.includeFrames}`,
      `labels=${grpcRequest.includeMlLabels}`,
      `dataset=${grpcRequest.includeDataset}`
    );

    const zipBuffer = await exportData(grpcRequest);

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="export_${timestamp}.zip"`,
        "Content-Length": zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("[Export] Failed:", error);
    const message =
      error instanceof Error ? error.message : "Unknown export error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
