import "server-only";

import { headers } from "next/headers";
import { backendOrigin } from "./origin";
import { fromAPIContract, toAPIContract } from "@/lib/api-contract";

type Problem = {
  code?: string;
  detail?: string;
  status?: number;
  title?: string;
};

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

type BackendRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  workspaceId?: string;
  origin?: string;
};

const allowedPath =
  /^\/v1\/(?:[A-Za-z0-9_-]+|%[0-9A-Fa-f]{2})+(?:\/(?:[A-Za-z0-9_.~-]+|%[0-9A-Fa-f]{2})*)*(?:\?[^#]*)?$/;

export async function backendRequest<T>(
  path: string,
  options: BackendRequestOptions = {},
): Promise<T> {
  if (!allowedPath.test(path) || path.includes(".."))
    throw new Error("The backend request path is invalid.");

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
    options.origin ??
    requestHeaders.get("origin") ??
    process.env.APP_URL ??
    "http://localhost:3000";
  const headersOut = new Headers({
    Accept: "application/json, application/problem+json",
    Origin: origin,
  });
  if (cookies.length) headersOut.set("Cookie", cookies.join("; "));

  if (options.body !== undefined)
    headersOut.set("Content-Type", "application/json");

  if (options.workspaceId)
    headersOut.set("X-Welio-Workspace", options.workspaceId);

  const requestId = requestHeaders.get("x-request-id");
  if (requestId) headersOut.set("X-Request-Id", requestId);

  let response: Response;
  try {
    response = await fetch(new URL(path, backendOrigin()), {
      method: options.method ?? "GET",
      headers: headersOut,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(toAPIContract(options.body)) }),
      cache: "no-store",
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
    const problem = (await response.json().catch(() => ({}))) as Problem;
    throw new BackendError(
      problem.detail ?? problem.title ?? "Could not complete this request.",
      problem.status ?? response.status,
      problem.code ?? "request_failed",
    );
  }

  if (response.status === 204) return undefined as T;

  return fromAPIContract<T>(await response.json());
}
