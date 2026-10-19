/** Build a browser request URL from the public Go API origin. */
export function apiUrl(path: string): string {
  const configured = process.env.NEXT_PUBLIC_WELIO_API_URL?.trim();
  if (!configured)
    throw new Error("NEXT_PUBLIC_WELIO_API_URL must be configured.");

  let origin: URL;
  try {
    origin = new URL(configured);
  } catch {
    throw new Error("NEXT_PUBLIC_WELIO_API_URL must be an HTTP(S) origin.");
  }

  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    (origin.pathname !== "/" && origin.pathname !== "") ||
    origin.search ||
    origin.hash
  )
    throw new Error("NEXT_PUBLIC_WELIO_API_URL must be an HTTP(S) origin.");

  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
    throw new Error(
      "The API path must be an absolute path on the configured origin.",
    );

  return new URL(path, origin).toString();
}
