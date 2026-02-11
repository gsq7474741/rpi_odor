import { NextResponse } from 'next/server';
import * as grpc from '@grpc/grpc-js';
import { ExperimentServiceClient } from '@/generated/enose_experiment.grpc-client';
import { Empty } from '@/generated/google/protobuf/empty';
import { ExperimentStatusResponse } from '@/generated/enose_experiment';

const GRPC_HOST = process.env.GRPC_HOST || 'rpi5.local';
const GRPC_PORT = process.env.GRPC_PORT || '50051';

let experimentClient: ExperimentServiceClient | null = null;

function getClient(): ExperimentServiceClient {
  if (!experimentClient) {
    experimentClient = new ExperimentServiceClient(
      `${GRPC_HOST}:${GRPC_PORT}`,
      grpc.credentials.createInsecure(),
      {
        'grpc.keepalive_time_ms': 10000,
        'grpc.keepalive_timeout_ms': 5000,
      }
    );
  }
  return experimentClient;
}

function getExperimentStatus(): Promise<ExperimentStatusResponse> {
  return new Promise((resolve, reject) => {
    const client = getClient();
    client.getExperimentStatus(Empty.create(), (err, res) => {
      if (err) reject(err);
      else if (res) resolve(res);
      else reject(new Error('Empty response'));
    });
  });
}

export async function GET() {
  const encoder = new TextEncoder();
  let intervalId: NodeJS.Timeout | null = null;
  let isActive = true;

  const stream = new ReadableStream({
    async start(controller) {
      const pollStatus = async () => {
        if (!isActive) return;
        
        try {
          const response = await getExperimentStatus();
          
          const data = {
            state: response.state,
            programId: response.programId,
            currentStepIndex: response.currentStepIndex,
            currentStepName: response.currentStepName,
            loopIteration: response.loopIteration,
            loopTotal: response.loopTotal,
            progressPercent: response.progressPercent,
            elapsedS: response.elapsedS,
            stepElapsedS: (response as any).stepElapsedS ?? 0,
            programFilename: (response as any).programFilename ?? "",
            remainingS: response.remainingS,
            message: response.message,
            logs: response.logs,
            error: response.error,
            quality: (response as any).quality,
            timestamp: Date.now(),
          };

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch (error) {
          console.error('获取实验状态失败:', error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '获取状态失败' })}\n\n`));
        }
      };

      // 立即获取一次状态
      await pollStatus();

      // 每 500ms 轮询一次
      intervalId = setInterval(pollStatus, 500);

      // 每 5 秒发送心跳
      const heartbeatId = setInterval(() => {
        if (isActive) {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        }
      }, 5000);

      // 清理函数
      const cleanup = () => {
        isActive = false;
        if (intervalId) clearInterval(intervalId);
        clearInterval(heartbeatId);
      };

      // 监听取消
      return () => {
        cleanup();
      };
    },

    cancel() {
      isActive = false;
      if (intervalId) clearInterval(intervalId);
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
