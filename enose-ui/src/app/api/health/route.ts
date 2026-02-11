import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { createClient } from "redis";
import { Client as MinioClient } from "minio";

const REDIS_URL = process.env.REDIS_URL || "redis://192.168.1.235:6379";
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || "rpi5.local";
const MINIO_PORT = parseInt(process.env.MINIO_PORT || "9000");
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || "minioadmin";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || "minioadmin123";

interface ServiceHealth {
  ok: boolean;
  latencyMs: number | null;
  error?: string;
}

async function checkTimescaleDB(): Promise<ServiceHealth> {
  const start = performance.now();
  try {
    const res = await pool.query("SELECT 1");
    return { ok: !!res, latencyMs: Math.round(performance.now() - start) };
  } catch (e) {
    return { ok: false, latencyMs: null, error: String(e) };
  }
}

async function checkRedis(): Promise<ServiceHealth> {
  const start = performance.now();
  let client;
  try {
    client = createClient({ url: REDIS_URL, socket: { connectTimeout: 2000 } });
    await client.connect();
    const pong = await client.ping();
    const latencyMs = Math.round(performance.now() - start);
    await client.disconnect();
    return { ok: pong === "PONG", latencyMs };
  } catch (e) {
    try { await client?.disconnect(); } catch { /* ignore */ }
    return { ok: false, latencyMs: null, error: String(e) };
  }
}

async function checkMinIO(): Promise<ServiceHealth> {
  const start = performance.now();
  try {
    const minio = new MinioClient({
      endPoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      useSSL: false,
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY,
    });
    // listBuckets 是最轻量的 MinIO 健康检查
    await minio.listBuckets();
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (e) {
    return { ok: false, latencyMs: null, error: String(e) };
  }
}

export async function GET() {
  // 并行检查所有服务
  const [timescaledb, redis, minio] = await Promise.all([
    checkTimescaleDB(),
    checkRedis(),
    checkMinIO(),
  ]);

  return NextResponse.json({
    timestamp: Date.now(),
    services: { timescaledb, redis, minio },
  });
}
