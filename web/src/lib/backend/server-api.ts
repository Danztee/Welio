import "server-only";

import { headers } from "next/headers";
import { createClient } from "./generated/client";
import { backendOrigin } from "./origin";

type Problem = { code?: string; detail?: string; status?: number };

export class BackendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

async function backendHeaders(workspaceId?: string): Promise<Headers> {
  const requestHeaders = await headers();
  const cookies = (requestHeaders.get("cookie") ?? "")
    .split(";")
    .map((cookie) => cookie.trim())
    .filter(
      (cookie) =>
        cookie.startsWith("welio_access=") ||
        cookie.startsWith("welio_refresh="),
    );
  const origin =
    requestHeaders.get("origin") ??
    process.env.APP_URL ??
    "http://localhost:3000";
  const headersOut = new Headers({
    Accept: "application/json, application/problem+json",
    Origin: origin,
  });
  if (cookies.length) headersOut.set("Cookie", cookies.join("; "));

  if (workspaceId) headersOut.set("X-Welio-Workspace", workspaceId);

  const requestId = requestHeaders.get("x-request-id");
  if (requestId) headersOut.set("X-Request-Id", requestId);

  return headersOut;
}

export async function backendClient(workspaceId?: string) {
  return createClient({
    baseUrl: backendOrigin().toString(),
    headers: await backendHeaders(workspaceId),
    cache: "no-store",
    throwOnError: true,
    fetch: async (request) => {
      let response: Response;
      try {
        response = await fetch(request, {
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new BackendError(
          "The Welio API is unavailable. Please try again.",
          0,
          "api_unavailable",
        );
      }
      if (!response.ok) {
        const problem: Problem = await response
          .clone()
          .json()
          .catch(() => ({}));
        throw new BackendError(
          problem.detail ?? "",
          problem.status ?? response.status,
          problem.code ?? "request_failed",
        );
      }
      return response;
    },
  });
}
