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
      name: "示例标签",
      description: "标签描述",
      createdAt: new Date().toISOString(),
      ranges: [],
    });
  } catch (error) {
    console.error("Failed to fetch label:", error);
    return NextResponse.json(
      { error: "Failed to fetch label" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    // TODO: 连接到 enose-analytics gRPC 服务更新标签
    return NextResponse.json({ id, ...body });
  } catch (error) {
    console.error("Failed to update label:", error);
    return NextResponse.json(
      { error: "Failed to update label" },
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
    // TODO: 连接到 enose-analytics gRPC 服务删除标签
    console.log(`Deleting label: ${id}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete label:", error);
    return NextResponse.json(
      { error: "Failed to delete label" },
      { status: 500 }
    );
  }
}
