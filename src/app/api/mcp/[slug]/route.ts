import { timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getDatabase } from "@/db";
import { getCatalog } from "@/lib/bookings/repository";
import {
  appOrigin,
  readBody,
  rateLimit,
  bookingResponse,
  bookingFailure,
} from "@/lib/bookings/http";
import { slugInput } from "@/lib/receptionist/contract";
import { createReceptionistServer } from "@/lib/receptionist/tools";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/mcp/[slug]">,
) {
  const secret = process.env.MCP_API_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  if (
    !secret ||
    secret.length < 32 ||
    Buffer.byteLength(authorization) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(authorization), Buffer.from(expected))
  )
    return bookingResponse({ error: "Unauthorized." }, 401);
  try {
    if (
      request.headers.get("origin") &&
      request.headers.get("origin") !== appOrigin()
    )
      return bookingResponse({ error: "Origin not allowed." }, 403);
    if (new URL(request.url).host !== new URL(appOrigin()).host)
      return bookingResponse({ error: "Host not allowed." }, 403);
    if (
      request.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json"
    )
      return bookingResponse({ error: "Use JSON." }, 415);
    await rateLimit(request, "mcp-public", 120, 60);
    const slug = slugInput.parse((await params).slug);
    const body = await readBody(request);
    await getCatalog(getDatabase(), { slug });
    const { server } = await createReceptionistServer(getDatabase(), slug);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, {
        parsedBody: body,
      });
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    } finally {
      await server.close();
    }
  } catch (error) {
    return bookingFailure(error);
  }
}
