import { timingSafeEqual } from "node:crypto";

export function mcpSecretEnvironmentName(slug: string) {
  return `MCP_API_SECRET__${slug.toUpperCase().replaceAll("-", "_")}`;
}

export function isAuthorizedMcpBearer(
  slug: string,
  authorization: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const secret = env[mcpSecretEnvironmentName(slug)];
  if (!secret || secret.length < 32) return false;

  const expected = `Bearer ${secret}`;

  return (
    Buffer.byteLength(authorization) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(authorization), Buffer.from(expected))
  );
}
