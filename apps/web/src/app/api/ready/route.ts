import { checkDatabaseReadiness, getDatabase } from "@welio/db";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };

  try {
    await checkDatabaseReadiness(getDatabase());

    return Response.json(
      { status: "ready", service: "welio", requestId },
      { headers },
    );
  } catch {
    console.error(
      JSON.stringify({ event: "database_readiness_failed", requestId }),
    );

    return Response.json(
      { status: "not_ready", service: "welio", requestId },
      { status: 503, headers },
    );
  }
}
