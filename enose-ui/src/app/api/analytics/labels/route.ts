import { NextRequest, NextResponse } from "next/server";
import { listLabels, createLabel } from "@/lib/analytics-grpc-client";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get("limit") || "100");
  const offset = parseInt(searchParams.get("offset") || "0");
  const experimentId = searchParams.get("experimentId") || undefined;

  try {
    const response = await listLabels({ limit, offset, experimentId });

    // 转换响应格式
    const labels = response.labels.map((label) => ({
      id: label.id,
      name: label.name,
      description: label.description,
      createdAt: label.createdAt
        ? new Date(Number(label.createdAt.seconds) * 1000).toISOString()
        : undefined,
      updatedAt: label.updatedAt
        ? new Date(Number(label.updatedAt.seconds) * 1000).toISOString()
        : undefined,
      sampleCount: label.sampleCount,
      ranges: label.ranges.map((r) => ({
        experimentId: r.experimentId,
        startTime: r.startTime
          ? new Date(Number(r.startTime.seconds) * 1000).toISOString()
          : undefined,
        endTime: r.endTime
          ? new Date(Number(r.endTime.seconds) * 1000).toISOString()
          : undefined,
        phase: r.phase,
      })),
    }));

    return NextResponse.json({ labels, total: response.total });
  } catch (error) {
    console.error("Failed to fetch labels:", error);
    return NextResponse.json(
      { error: "Failed to fetch labels" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, ranges } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Label name is required" },
        { status: 400 }
      );
    }

    const response = await createLabel({
      name,
      description,
      ranges: ranges || [],
    });

    return NextResponse.json({
      id: response.id,
      name: response.name,
      description: response.description,
      createdAt: response.createdAt
        ? new Date(Number(response.createdAt.seconds) * 1000).toISOString()
        : new Date().toISOString(),
      ranges: [],
    });
  } catch (error) {
    console.error("Failed to create label:", error);
    return NextResponse.json(
      { error: "Failed to create label" },
      { status: 500 }
    );
  }
}
