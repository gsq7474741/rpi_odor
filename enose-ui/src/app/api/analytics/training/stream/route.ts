import { NextRequest } from "next/server";
import { streamTrainingProgress } from "@/lib/analytics-grpc-client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return new Response("jobId required", { status: 400 });
  }

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    start(controller) {
      try {
        const stream = streamTrainingProgress({ jobId });

        stream.on("data", (update: { epoch?: number; totalEpochs?: number; trainLoss?: number; valLoss?: number; trainAccuracy?: number; valAccuracy?: number; extraMetricsJson?: string }) => {
          const data = JSON.stringify({
            epoch: update.epoch || 0,
            totalEpochs: update.totalEpochs || 0,
            trainLoss: update.trainLoss || 0,
            valLoss: update.valLoss || 0,
            trainAccuracy: update.trainAccuracy || 0,
            valAccuracy: update.valAccuracy || 0,
            extraMetrics: update.extraMetricsJson ? JSON.parse(update.extraMetricsJson) : {},
          });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        });

        stream.on("end", () => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();
        });

        stream.on("error", (err: Error) => {
          console.error("[training stream] error:", err.message);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`)
          );
          controller.close();
        });
      } catch (err) {
        console.error("[training stream] setup error:", err);
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
