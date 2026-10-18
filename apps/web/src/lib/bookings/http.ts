import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { getDatabase, incrementRateLimit } from "@welio/db";
import { BookingError } from "@welio/domain/bookings/errors";
import { WorkspaceError } from "@welio/domain/workspaces/errors";
import { isAllowedAppOrigin } from "@/lib/app-origin";

export { appOrigin } from "@/lib/app-origin";

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function requireOrigin(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new HttpError("Use a JSON request.", 415);

  const origin = request.headers.get("origin");
  if (!origin || !isAllowedAppOrigin(origin))
    throw new HttpError("This request origin is not allowed.", 403);
}

export async function readBody(request: Request, maxBytes = 8192) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new HttpError("Request too large.", 413);

  const reader = request.body?.getReader();
  if (!reader) throw new HttpError("Provide booking details.", 400);

  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;

      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError("Request too large.", 413);
      }

      chunks.push(part.value);
    }

    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (e) {
    if (e instanceof HttpError) throw e;

    throw new HttpError("Provide valid booking details.", 400);
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
  const count = await incrementRateLimit(
    getDatabase(),
    key,
    windowSeconds * 1000,
  );
  if (count > max)
    throw new HttpError("Too many requests. Please try again later.", 429);
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
    return bookingResponse(
      { error: error.message },
      statusForBookingError(error),
    );

  if (error instanceof HttpError)
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

function statusForBookingError(error: BookingError) {
  switch (error.code) {
    case "invalid":
      return 400;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "unavailable":
      return 503;
    case "conflict":
      return 409;
  }
}
