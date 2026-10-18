import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getDatabase } from "@welio/db";
import { getCatalog } from "@welio/db/bookings";
import {
  readBody,
  rateLimit,
  bookingResponse,
  bookingFailure,
} from "@/lib/bookings/http";
import { isAllowedMcpHost, isAllowedMcpOrigin } from "@/lib/app-origin";
import { slugInput } from "@welio/domain/receptionist/contract";
import { createReceptionistServer } from "@/lib/receptionist/tools";
import { isAuthorizedMcpBearer } from "@/lib/receptionist/mcp-auth";

export const runtime = "nodejs";

export const maxDuration = 30;

function authorizeMcpRequest(request: Request, slug: string): Response | null {
  const origin = request.headers.get("origin");
  if (origin && !isAllowedMcpOrigin(origin))
    return bookingResponse({ error: "Origin not allowed." }, 403);

  if (!isAllowedMcpHost(new URL(request.url).host))
    return bookingResponse({ error: "Host not allowed." }, 403);

  const authorization = request.headers.get("authorization") ?? "";
  if (!isAuthorizedMcpBearer(slug, authorization))
    return bookingResponse({ error: "Unauthorized." }, 401);

  return null;
}

function methodNotAllowed(): Response {
  return new Response(null, {
    status: 405,
    headers: {
      Allow: "POST",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/mcp/[slug]">,
): Promise<Response> {
  try {
    const slug = slugInput.parse((await params).slug);
    const denied = authorizeMcpRequest(request, slug);
    if (denied) return denied;

    return methodNotAllowed();
  } catch (error) {
    return bookingFailure(error);
  }
}

export async function HEAD(
  request: Request,
  context: RouteContext<"/api/mcp/[slug]">,
): Promise<Response> {
  return GET(request, context);
}

export async function OPTIONS(
  request: Request,
  { params }: RouteContext<"/api/mcp/[slug]">,
): Promise<Response> {
  try {
    const slug = slugInput.parse((await params).slug);
    const denied = authorizeMcpRequest(request, slug);
    if (denied) return denied;

    return methodNotAllowed();
  } catch (error) {
    return bookingFailure(error);
  }
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/mcp/[slug]">,
): Promise<Response> {
  try {
    const slug = slugInput.parse((await params).slug);
    const denied = authorizeMcpRequest(request, slug);
    if (denied) return denied;

    if (
      request.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json"
    )
      return bookingResponse({ error: "Use JSON." }, 415);

    await rateLimit(request, "mcp-public", 120, 60);
    const body = await readBody(request);
    await getCatalog(getDatabase(), { slug });
    const { server } = await createReceptionistServer(
      getDatabase(),
      slug,
      undefined,
      undefined,
      {
        externalMcp: true,
        allowBookingConfirmation:
          process.env.MCP_BOOKING_CONFIRMATION_ENABLED === "true",
      },
    );
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
