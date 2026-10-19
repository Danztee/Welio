import { test } from "node:test";
import assert from "node:assert/strict";
import { safeReturnPath } from "../../src/lib/auth-path.ts";
import { refreshSession } from "../../src/lib/auth/refresh.ts";

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
      return Response.json({});
    }
    return Response.json({}, { status: current ? 200 : 401 });
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
      return Response.json({}, { status: checks > 1 ? 200 : 401 });
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
