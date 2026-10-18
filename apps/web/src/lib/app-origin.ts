import "server-only";
import { z } from "zod";

const mcpOriginsSchema = z.array(
  z.url({ protocol: /^https$/ }).refine((value) => {
    const url = new URL(value);

    return (
      url.origin === value &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  }),
);

export function appOrigin(): string {
  const value =
    process.env.BETTER_AUTH_URL ??
    process.env.APP_URL ??
    "http://127.0.0.1:3000";
  if (!URL.canParse(value))
    throw new Error("The application URL is not configured.");

  return new URL(value).origin;
}

/**
 * Return the configured origin and, in local development only, its equivalent
 * loopback hostname. This lets the app work from either localhost or
 * 127.0.0.1 without weakening production origin checks.
 */
export function appOrigins(): string[] {
  const configured = new URL(appOrigin());
  const origins = new Set([configured.origin]);

  if (
    process.env.NODE_ENV !== "production" &&
    configured.protocol === "http:" &&
    (configured.hostname === "localhost" || configured.hostname === "127.0.0.1")
  ) {
    const alternate = new URL(configured.origin);
    alternate.hostname =
      configured.hostname === "localhost" ? "127.0.0.1" : "localhost";
    origins.add(alternate.origin);
  }

  return [...origins];
}

export function isAllowedAppOrigin(origin: string): boolean {
  return appOrigins().includes(origin);
}

export function isAllowedAppHost(host: string): boolean {
  return appOrigins().some((origin) => new URL(origin).host === host);
}

function configuredMcpOrigins(): string[] {
  const values = (process.env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const result = mcpOriginsSchema.safeParse(values);
  if (!result.success)
    throw new Error(
      "MCP_ALLOWED_ORIGINS must contain comma-separated HTTPS origins without paths.",
    );

  return result.data;
}

/** Exact additional origins for trusted MCP clients, separate from browser APIs. */
export function isAllowedMcpOrigin(origin: string): boolean {
  return isAllowedAppOrigin(origin) || configuredMcpOrigins().includes(origin);
}

export function isAllowedMcpHost(host: string): boolean {
  return (
    isAllowedAppHost(host) ||
    configuredMcpOrigins().some((origin) => new URL(origin).host === host)
  );
}
