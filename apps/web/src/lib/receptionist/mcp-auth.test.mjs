import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorizedMcpBearer, mcpSecretEnvironmentName } from "./mcp-auth.ts";

test("uses a separate secret environment variable for each business slug", () => {
  assert.equal(
    mcpSecretEnvironmentName("lagos-cleaning"),
    "MCP_API_SECRET__LAGOS_CLEANING",
  );
});

test("accepts the configured business secret as a bearer token", () => {
  const secret = "a".repeat(64);

  assert.equal(
    isAuthorizedMcpBearer("lagos-cleaning", `Bearer ${secret}`, {
      MCP_API_SECRET__LAGOS_CLEANING: secret,
    }),
    true,
  );
});

test("does not accept one business secret on another business endpoint", () => {
  const secret = "b".repeat(64);

  assert.equal(
    isAuthorizedMcpBearer("ikeja-plumbing", `Bearer ${secret}`, {
      MCP_API_SECRET__LAGOS_CLEANING: secret,
    }),
    false,
  );
});

test("does not fall back to the former shared server secret", () => {
  const secret = "c".repeat(64);

  assert.equal(
    isAuthorizedMcpBearer("lagos-cleaning", `Bearer ${secret}`, {
      MCP_API_SECRET: secret,
    }),
    false,
  );
});

test("rejects missing, weak, malformed, and incorrect bearer tokens", () => {
  const weakSecret = "d".repeat(31);

  assert.equal(
    isAuthorizedMcpBearer("lagos-cleaning", "", {
      MCP_API_SECRET__LAGOS_CLEANING: weakSecret,
    }),
    false,
  );
  assert.equal(
    isAuthorizedMcpBearer("lagos-cleaning", `Bearer ${weakSecret}`, {
      MCP_API_SECRET__LAGOS_CLEANING: weakSecret,
    }),
    false,
  );
  assert.equal(
    isAuthorizedMcpBearer("lagos-cleaning", `Bearer ${"e".repeat(64)}`, {
      MCP_API_SECRET__LAGOS_CLEANING: "d".repeat(64),
    }),
    false,
  );
});
