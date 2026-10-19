import { apiUrl } from "../api-url.ts";

let pending: Promise<boolean> | undefined;

async function renew(): Promise<boolean> {
  const request = (path: string, method = "GET") =>
    fetch(apiUrl(`/v1${path}`), {
      method,
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json, application/problem+json" },
    });

  // Another request or tab may already have renewed while we waited for the lock.
  const account = await request("/me");
  if (account.ok) return true;
  if (account.status !== 401)
    throw new Error("Could not check your session. Please try again.");
  const response = await request("/auth/refresh", "POST");
  if (response.ok) return true;
  if (response.status !== 401)
    throw new Error("Could not renew your session. Please try again.");
  const problem = await response.json().catch(() => ({}));
  if (problem.code === "refresh_race") {
    // Support browsers without Web Locks and requests made by another API client.
    for (const delay of [100, 250, 500]) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const account = await request("/me");
      if (account.ok) return true;
      if (account.status !== 401)
        throw new Error("Could not check your session. Please try again.");
    }
    throw new Error("Session renewal is still in progress. Please try again.");
  }
  return false;
}

/** One renewal per origin across tabs; one promise per tab on older browsers. */
export function refreshSession(): Promise<boolean> {
  if (!pending) {
    const locks =
      typeof navigator !== "undefined" ? navigator.locks : undefined;
    pending = Promise.resolve(
      locks ? locks.request("welio-session-refresh", renew) : renew(),
    )
      .then((result) => result)
      .finally(() => {
        pending = undefined;
      });
  }
  return pending;
}
