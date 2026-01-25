import { getSensorStatus } from "@/lib/grpc-client";

export const dynamic = 'force-dynamic';

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 5000;

export async function GET() {
  const encoder = new TextEncoder();
  
  let pollInterval: NodeJS.Timeout | null = null;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let isClosed = false;
  
  const stream = new ReadableStream({
    async start(controller) {
      let lastHeartbeat = Date.now();
      
      const send = (data: object) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          lastHeartbeat = Date.now();
        } catch {
          isClosed = true;
        }
      };
      
      const sendHeartbeat = () => {
        if (Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
          send({ type: 'heartbeat', timestamp: Date.now() });
        }
      };
      
      const fetchAndSend = async () => {
        if (isClosed) return;
        try {
          const status = await getSensorStatus();
          send({ type: 'status', ...status, timestamp: Date.now() });
        } catch (e: any) {
          send({ type: 'error', message: e.message || 'Unknown error', timestamp: Date.now() });
        }
      };
      
      // 立即发送一次
      await fetchAndSend();
      
      // 定时轮询 gRPC 并推送
      pollInterval = setInterval(fetchAndSend, POLL_INTERVAL_MS);
      
      // 心跳保活
      heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      isClosed = true;
      if (pollInterval) clearInterval(pollInterval);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    }
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
