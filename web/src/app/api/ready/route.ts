import { backendOrigin } from "@/lib/backend/origin";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };

  try {
    const response = await fetch(new URL("/readyz", backendOrigin()), {
      headers: { "X-Request-Id": requestId },
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ status: "not_ready" }));

      return Response.json(body, { status: response.status, headers });
    }
    const body = await response.json().catch(() => ({ status: "not_ready" }));

    return Response.json(body, { status: response.status, headers });
  } catch {
    console.error(JSON.stringify({ event: "api_readiness_failed", requestId }));

    return Response.json(
      { status: "not_ready", service: "welio", requestId },
      { status: 503, headers },
    );
  }
}
