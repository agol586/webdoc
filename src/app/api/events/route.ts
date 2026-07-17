import { getLiveRuntime } from "../../../server/context";
import { changeHub } from "../../../live/change-hub";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  // Connecting clients must not wait for an initial scan or a temporarily invalid config.
  void getLiveRuntime().catch(() => changeHub.publish({ kind: "status", status: "degraded" }));
  const hub = changeHub;
  const encoder = new TextEncoder();
  let iterator: AsyncIterator<import("../../../live/change-hub").ChangeEvent> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: "status", status: "connected" })}\n\n`));
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": heartbeat\n\n")), 15_000);
      iterator = hub.subscribe(request.signal)[Symbol.asyncIterator]();
      try {
        while (true) {
          const result = await iterator.next();
          if (result.done) break;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(result.value)}\n\n`));
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        await iterator.return?.();
        try { controller.close(); } catch {}
      }
    },
    async cancel() {
      if (heartbeat) clearInterval(heartbeat);
      await iterator?.return?.();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
