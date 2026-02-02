import { NextRequest, NextResponse } from "next/server";
import { Client } from "minio";

// MinIO 配置
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

// GET /api/uploads/[...path] - 代理访问 MinIO 文件
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const objectName = path.join("/");

    if (!objectName) {
      return NextResponse.json({ error: "Missing path" }, { status: 400 });
    }

    // 从 MinIO 获取对象
    const stream = await minioClient.getObject(MINIO_BUCKET, objectName);
    
    // 获取对象元数据
    const stat = await minioClient.statObject(MINIO_BUCKET, objectName);
    
    // 将流转换为 Buffer
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // 返回文件内容
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": stat.metaData?.["content-type"] || "application/octet-stream",
        "Content-Length": String(stat.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Proxy error:", error);
    
    // 检查是否是对象不存在的错误
    if (error instanceof Error && error.message.includes("Not Found")) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
