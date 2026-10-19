import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeReturnPath } from "@/lib/auth-path";
import { fromAPIContract } from "@/lib/api-contract";

export async function currentUser() {
  const requestHeaders = await headers();
  const cookies = requestHeaders.get("cookie") ?? "";
  const accessCookie = cookies
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith("welio_access="));
  if (!accessCookie) return null;

  const apiOrigin =
    process.env.WELIO_API_INTERNAL_URL ?? "http://127.0.0.1:8081";
  let response: Response;
  try {
    response = await fetch(new URL("/v1/me", apiOrigin), {
      headers: {
        cookie: accessCookie,
        ...(requestHeaders.get("x-request-id")
          ? { "x-request-id": requestHeaders.get("x-request-id")! }
          : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (cause) {
    throw new Error("The Welio API is unavailable.", { cause });
  }

  if (response.status === 401) return null;

  if (!response.ok) {
    throw new Error(
      `The Welio API could not load the current account (${response.status}).`,
    );
  }

  return fromAPIContract<{
    id: string;
    name: string;
    firstName: string;
    lastName: string;
    email: string;
    emailVerified: boolean;
    image?: string | null;
    createdAt: string;
  }>(await response.json());
}

export async function requireUser(returnTo?: string) {
  const user = await currentUser();
  if (!user)
    redirect(
      returnTo
        ? `/sign-in?next=${encodeURIComponent(safeReturnPath(returnTo))}`
        : "/sign-in",
    );

  if (!user.emailVerified) redirect("/verify-email");

  return user;
}
