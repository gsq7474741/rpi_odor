import { NextRequest } from "next/server";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lines = searchParams.get("lines") || "100";

  // 从环境变量加载 SSH 配置
  const sshHost = process.env.SSH_HOST || process.env.GRPC_HOST || "rpi5.local";
  const sshUser = process.env.SSH_USER || "user";

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      
      const safeEnqueue = (data: Uint8Array) => {
        if (!closed) {
          try {
            controller.enqueue(data);
          } catch {
            closed = true;
          }
        }
      };
      
      const safeClose = () => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      };

      const sshProcess = spawn("ssh", [
        `${sshUser}@${sshHost}`,
        `journalctl -u enose-control -n ${lines} -f --no-pager`,
      ]);

      sshProcess.stdout.on("data", (data: Buffer) => {
        const text = data.toString();
        safeEnqueue(encoder.encode(`data: ${JSON.stringify({ log: text })}\n\n`));
      });

      sshProcess.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        safeEnqueue(encoder.encode(`data: ${JSON.stringify({ error: text })}\n\n`));
      });

      sshProcess.on("close", (code) => {
        safeEnqueue(encoder.encode(`data: ${JSON.stringify({ closed: true, code })}\n\n`));
        safeClose();
      });

      sshProcess.on("error", (err) => {
        safeEnqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
        safeClose();
      });

      request.signal.addEventListener("abort", () => {
        closed = true;
        sshProcess.kill();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
