import "server-only";

/** Resolve the private Go API origin used for server-rendered requests. */
export function backendOrigin(
  env: Readonly<Record<string, string | undefined>> = process.env,
): URL {
  const configured = env.WELIO_API_INTERNAL_URL?.trim();
  const value = configured || "http://127.0.0.1:8081";

  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error(
      "WELIO_API_INTERNAL_URL must be an absolute HTTP(S) origin.",
    );
  }

  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    (origin.pathname !== "/" && origin.pathname !== "") ||
    origin.search ||
    origin.hash
  )
    throw new Error(
      "WELIO_API_INTERNAL_URL must be an absolute HTTP(S) origin.",
    );

  return origin;
}
