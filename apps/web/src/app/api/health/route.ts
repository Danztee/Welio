export function GET() {
  const requestId = crypto.randomUUID();

  return Response.json(
    { status: "ok", service: "welio", requestId },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    },
  );
}
