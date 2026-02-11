import { NextResponse } from "next/server";
import { getStatus, resetAllControlClients } from "@/lib/grpc-client";

/**
 * Ping API - 测量浏览器到后端的端到端延迟
 * 
 * 链路: 浏览器 -> Next.js -> gRPC -> C++ 后端 -> gRPC 响应 -> Next.js -> 浏览器
 * 
 * 返回:
 * - grpcTime: gRPC 调用时间 (ms)
 * - serverTime: 服务器处理时间戳
 */
export async function GET() {
  try {
    // 记录 gRPC 调用开始时间
    const grpcStart = performance.now();
    
    // 调用轻量级 RPC 获取状态
    await getStatus();
    
    // 记录 gRPC 调用结束时间
    const grpcEnd = performance.now();
    const grpcTime = Math.round(grpcEnd - grpcStart);
    
    return NextResponse.json({
      success: true,
      grpcTime,      // gRPC 调用时间 (Next.js -> C++ -> Next.js)
      serverTime: Date.now(),
      connected: true,
    });
  } catch (error) {
    resetAllControlClients();
    return NextResponse.json({
      success: false,
      grpcTime: null,
      serverTime: Date.now(),
      connected: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
