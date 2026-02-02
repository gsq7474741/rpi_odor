import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // TODO: 连接到 enose-analytics gRPC 服务
    return NextResponse.json({
      id,
      name: "juice-classifier-v1",
      description: "果汁分类模型",
      inputDim: 15,
      outputDim: 3,
      classNames: ["apple", "orange", "blank"],
      trainAccuracy: 0.95,
      valAccuracy: 0.92,
      createdAt: new Date().toISOString(),
      minioPath: `models/${id}.pt`,
    });
  } catch (error) {
    console.error("Failed to fetch model:", error);
    return NextResponse.json(
      { error: "Failed to fetch model" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // TODO: 连接到 enose-analytics gRPC 服务删除模型
    console.log(`Deleting model: ${id}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete model:", error);
    return NextResponse.json(
      { error: "Failed to delete model" },
      { status: 500 }
    );
  }
}
