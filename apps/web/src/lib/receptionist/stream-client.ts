import { z } from "zod";
import {
  receptionistStreamEventSchema,
  type ReceptionistActivity,
} from "@welio/domain/receptionist/contract";

const errorResponseSchema = z.object({ error: z.string() });

export async function readReceptionistStream<T>(
  response: Response,
  onTextDelta: (text: string) => void,
  resultSchema: z.ZodType<T>,
  onActivity?: (activity: ReceptionistActivity) => void,
): Promise<T> {
  if (!response.ok) {
    let message = "Could not complete this request. Please retry.";
    try {
      const parsed = errorResponseSchema.safeParse(await response.json());
      if (parsed.success) message = parsed.data.error;
    } catch {
      // Keep the safe fallback when the server did not return JSON.
    }

    throw new Error(message);
  }

  if (!response.headers.get("content-type")?.includes("application/x-ndjson"))
    throw new Error("Could not read the receptionist response. Please retry.");

  const reader = response.body?.getReader();
  if (!reader)
    throw new Error(
      "The receptionist response ended unexpectedly. Please retry.",
    );

  const decoder = new TextDecoder();
  let buffer = "";
  const completed: { data: T | null } = { data: null };

  const readLine = (line: string) => {
    if (!line.trim()) return;

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(
        "Could not read the receptionist response. Please retry.",
      );
    }

    const event = receptionistStreamEventSchema.safeParse(raw);
    if (!event.success)
      throw new Error(
        "Could not read the receptionist response. Please retry.",
      );

    if (event.data.type === "delta") {
      onTextDelta(event.data.text);

      return;
    }

    if (event.data.type === "activity") {
      onActivity?.(event.data.activity);

      return;
    }

    if (event.data.type === "error") throw new Error(event.data.error);

    const result = resultSchema.safeParse(event.data.data);
    if (!result.success)
      throw new Error(
        "Could not read the receptionist response. Please retry.",
      );

    completed.data = result.data;
  };

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        readLine(buffer.slice(0, newline).replace(/\r$/, ""));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) readLine(buffer.replace(/\r$/, ""));
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (completed.data === null)
    throw new Error("The receptionist response ended before it was complete.");

  return completed.data;
}
