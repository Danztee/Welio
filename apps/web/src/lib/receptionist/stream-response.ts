import "server-only";

import {
  ReceptionistError,
  type ReceptionistActivity,
} from "@welio/domain/receptionist/contract";

type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "activity"; activity: ReceptionistActivity }
  | { type: "complete"; data: unknown }
  | { type: "error"; error: string };

export function receptionistStreamResponse<T>(
  requestSignal: AbortSignal,
  run: (options: {
    signal: AbortSignal;
    onTextDelta: (text: string) => void;
    onActivity: (activity: ReceptionistActivity) => void;
  }) => Promise<T>,
  { eventName, fallbackError }: { eventName: string; fallbackError: string },
) {
  const abortController = new AbortController();
  const signal = AbortSignal.any([requestSignal, abortController.signal]);
  let disconnected = false;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: StreamEvent) => {
        if (disconnected) return;

        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          disconnected = true;
          abortController.abort();
        }
      };

      void (async () => {
        try {
          const data = await run({
            signal,
            onTextDelta: (text) => send({ type: "delta", text }),
            onActivity: (activity) => send({ type: "activity", activity }),
          });
          send({ type: "complete", data });
        } catch (error) {
          const message =
            error instanceof ReceptionistError ? error.message : fallbackError;
          if (!(error instanceof ReceptionistError))
            console.error(JSON.stringify({ event: eventName }));

          send({ type: "error", error: message });
        } finally {
          if (!disconnected) controller.close();
        }
      })();
    },
    cancel(reason) {
      disconnected = true;
      abortController.abort(reason);
    },
  });

  return new Response(body, {
    headers: {
      "Cache-Control": "no-store, no-transform",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
