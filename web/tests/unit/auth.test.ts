import { test } from "node:test";
import assert from "node:assert/strict";
import { safeReturnPath } from "../../src/lib/auth-path.ts";
import {
  refreshSession,
  sessionRenewalDelay,
} from "../../src/lib/auth/refresh.ts";

function authenticated(lifetime = 900) {
  return Response.json(
    {},
    { headers: { "X-Welio-Access-TTL": String(lifetime) } },
  );
}

test("renewal preserves supported destinations and refuses external redirects", () => {
  for (const target of [
    "/dashboard/time-off?workspace=11111111-1111-4111-8111-111111111111",
    "/dashboard/customers?search=Jane&cursor=abc",
    "/dashboard/settings?tab=security",
    "/onboarding?new=true",
  ])
    assert.equal(safeReturnPath(target), target);
  for (const target of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/session/renew",
    "/dashboard?next=https://evil.example",
  ])
    assert.equal(safeReturnPath(target), "/dashboard");
});

test("parallel expired requests share renewal and wait for rotated cookies", async () => {
  process.env.NEXT_PUBLIC_WELIO_API_URL = "http://127.0.0.1:8181";
  const original = globalThis.fetch;
  let refreshes = 0;
  let current = false;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/auth/refresh")) {
      refreshes++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      current = true;
      return Response.json({ expires_in: 900 });
    }
    return current ? authenticated() : Response.json({}, { status: 401 });
  };
  try {
    assert.deepEqual(
      await Promise.all([refreshSession(), refreshSession(), refreshSession()]),
      [true, true, true],
    );
    assert.equal(refreshes, 1);
    assert.equal(await refreshSession(), true);
    assert.equal(
      refreshes,
      1,
      "an already renewed session should not rotate again",
    );
    current = false;
    let checks = 0;
    globalThis.fetch = async (input) => {
      if (String(input).endsWith("/auth/refresh"))
        return Response.json({ code: "refresh_race" }, { status: 401 });
      checks++;
      return checks > 1 ? authenticated() : Response.json({}, { status: 401 });
    };
    assert.equal(
      await refreshSession(),
      true,
      "recover a refresh completed by another tab",
    );
    globalThis.fetch = async (input) =>
      String(input).endsWith("/auth/refresh")
        ? Response.json({ code: "refresh_race" }, { status: 401 })
        : Response.json({}, { status: 401 });
    await assert.rejects(
      refreshSession(),
      /still in progress/,
      "a slow competing refresh must remain retryable",
    );
    globalThis.fetch = async () => Response.json({}, { status: 401 });
    assert.equal(
      await refreshSession(),
      false,
      "a revoked session must require sign-in",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("near-expiry requests renew once before the token expires", async () => {
  const original = globalThis.fetch;
  let refreshes = 0;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/auth/refresh")) {
      refreshes++;
      return Response.json({ expires_in: 900 });
    }
    return authenticated(30);
  };
  try {
    assert.deepEqual(await Promise.all([refreshSession(), refreshSession()]), [
      true,
      true,
    ]);
    assert.equal(refreshes, 1);
    assert.ok(sessionRenewalDelay() > 13 * 60 * 1_000);
    assert.ok(sessionRenewalDelay() <= 14 * 60 * 1_000);
  } finally {
    globalThis.fetch = original;
  }
});

test("temporary authentication service errors remain retryable", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return Response.json({ code: "auth_unavailable" }, { status: 503 });
  };
  try {
    await assert.rejects(refreshSession(), /Could not check your session/);
    assert.equal(requests.length, 1);
    assert.ok(requests[0].endsWith("/v1/me"));
  } finally {
    globalThis.fetch = original;
  }
});
