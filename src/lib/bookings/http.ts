import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/db";
import { BookingError } from "./repository";
import { WorkspaceError } from "@/lib/workspaces/repository";
export function appOrigin() {
  const value =
    process.env.BETTER_AUTH_URL ??
    process.env.APP_URL ??
    "http://localhost:3000";
  if (!URL.canParse(value))
    throw new BookingError("The application URL is not configured.", 503);
  return new URL(value).origin;
}
export function requireOrigin(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new BookingError("Use a JSON request.", 415);
  if (request.headers.get("origin") !== appOrigin())
    throw new BookingError("This request origin is not allowed.", 403);
}
export async function readBody(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 8192) throw new BookingError("Request too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new BookingError("Provide booking details.", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new BookingError("Request too large.", 413);
      }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (e) {
    if (e instanceof BookingError) throw e;
    throw new BookingError("Provide valid booking details.", 400);
  }
}
export async function rateLimit(
  request: Request,
  scope: string,
  max: number,
  windowSeconds: number,
) {
  const header = process.env.AUTH_TRUSTED_IP_HEADER;
  const candidate = header ? request.headers.get(header) : null;
  const identity = candidate && isIP(candidate) ? candidate : "local-shared";
  const key =
    "booking:" +
    createHash("sha256")
      .update(scope + ":" + identity)
      .digest("hex");
  const now = Date.now(),
    since = now - windowSeconds * 1000;
  const result = await getDatabase().execute(
    sql`insert into auth_rate_limits (key,count,last_request) values (${key},1,${now}) on conflict (key) do update set count=case when auth_rate_limits.last_request<${since} then 1 else auth_rate_limits.count+1 end,last_request=case when auth_rate_limits.last_request<${since} then ${now} else auth_rate_limits.last_request end returning count`,
  );
  if (Number(result.rows[0]?.count) > max)
    throw new BookingError("Too many requests. Please try again later.", 429);
}
export function bookingResponse(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export function bookingFailure(error: unknown) {
  if (error instanceof z.ZodError)
    return bookingResponse(
      { error: error.issues[0]?.message ?? "Check booking details." },
      400,
    );
  if (error instanceof BookingError)
    return bookingResponse({ error: error.message }, error.status);
  if (error instanceof WorkspaceError)
    return bookingResponse({ error: "Workspace unavailable." }, 404);
  let cause: unknown = error;
  while (cause instanceof Error) {
    if ("code" in cause && cause.code === "23P01")
      return bookingResponse(
        { error: "That time was just taken. Choose another available slot." },
        409,
      );
    cause = cause.cause;
  }
  console.error(JSON.stringify({ event: "booking_request_failed" }));
  return bookingResponse(
    { error: "Could not complete this request. Please try again." },
    500,
  );
}
