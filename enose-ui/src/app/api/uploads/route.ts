import { NextRequest, NextResponse } from "next/server";
import { Client } from "minio";

// MinIO 配置 - 连接到树莓派上的 MinIO 服务
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || "rpi5.local";
const MINIO_PORT = parseInt(process.env.MINIO_PORT || "9000");
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || "minioadmin";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || "minioadmin123";
const MINIO_BUCKET = process.env.MINIO_BUCKET || "attachments";
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === "true";

// 创建 MinIO 客户端
const minioClient = new Client({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: MINIO_USE_SSL,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY,
});

// POST /api/uploads - 上传文件到 MinIO
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const liquidId = formData.get("liquidId") as string;
    const fieldKey = formData.get("fieldKey") as string;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!liquidId || !fieldKey) {
      return NextResponse.json(
        { error: "Missing liquidId or fieldKey" },
        { status: 400 }
      );
    }

    // 生成对象路径
    const timestamp = Date.now();
    const ext = file.name.substring(file.name.lastIndexOf("."));
    const baseName = file.name.substring(0, file.name.lastIndexOf("."));
    const safeBaseName = baseName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const objectName = `liquids/${liquidId}/${fieldKey}_${timestamp}_${safeBaseName}${ext}`;

    // 上传到 MinIO
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    await minioClient.putObject(
      MINIO_BUCKET,
      objectName,
      buffer,
      file.size,
      { "Content-Type": file.type }
    );

    // 生成代理访问 URL (通过 Next.js API 代理，不直接暴露 MinIO 地址)
    const fileUrl = `/api/uploads/${objectName}`;

    return NextResponse.json({
      success: true,
      fileName: file.name,
      filePath: objectName,
      fileUrl,
      fileSize: file.size,
      mimeType: file.type,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

// DELETE /api/uploads - 从 MinIO 删除文件
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const objectName = searchParams.get("path");

    if (!objectName) {
      return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
    }

    await minioClient.removeObject(MINIO_BUCKET, objectName);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
