import * as grpc from "@grpc/grpc-js";
import { getSensorClient } from "@/lib/grpc-client";
import { Empty } from "@/generated/google/protobuf/empty";

export const dynamic = 'force-dynamic';

const HEARTBEAT_INTERVAL_MS = 2000;

export async function GET() {
  const encoder = new TextEncoder();
  
  let grpcStream: ReturnType<typeof getSensorClient>['subscribeSensorReadings'] extends (req: any) => infer R ? R : never;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let isClosed = false;
  let lastHeartbeat = Date.now();
  
  const stream = new ReadableStream({
    async start(controller) {
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
      
      try {
        const client = getSensorClient();
        grpcStream = client.subscribeSensorReadings(Empty.create());
        
        grpcStream.on('data', (reading: any) => {
          if (isClosed) return;
          send({
            type: 'reading',
            timestamp: Number(reading.tickMs),
            sensorIndex: reading.sensorIdx,
            temperature: reading.temperature,
            humidity: reading.humidity,
            pressure: reading.pressure,
            gasResistance: reading.value,
            gasIndex: reading.heaterStep,
          });
        });
        
        grpcStream.on('error', (err: grpc.ServiceError) => {
          if (err.code !== grpc.status.CANCELLED && !isClosed) {
            send({ type: 'error', message: err.message || 'Stream error', timestamp: Date.now() });
          }
        });
        
        grpcStream.on('end', () => {
          if (!isClosed) {
            send({ type: 'end', timestamp: Date.now() });
          }
        });
        
        // 心跳保活
        heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
        
      } catch (e: any) {
        send({ type: 'error', message: e.message || 'Failed to connect', timestamp: Date.now() });
      }
    },
    cancel() {
      isClosed = true;
      if (grpcStream) {
        try {
          grpcStream.cancel();
        } catch {}
      }
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
