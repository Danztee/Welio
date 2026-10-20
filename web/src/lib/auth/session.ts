import "server-only";
import { cache } from "react";
import { backendClient, BackendError } from "@/lib/backend/server-api";
import { meGet } from "@/lib/backend/generated/sdk.gen";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeReturnPath } from "@/lib/auth-path";
import type { APIModel } from "@/lib/backend/contract";
import { fromAPIContract } from "@/lib/api-contract";

export const currentUser = cache(async function currentUser() {
  const requestHeaders = await headers();
  const cookies = requestHeaders.get("cookie") ?? "";
  const accessCookie = cookies
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith("welio_access="));
  if (!accessCookie) return null;

  try {
    const result = await meGet({
      client: await backendClient(),
      throwOnError: true,
    });
    return fromAPIContract<APIModel<"User">>(result.data);
  } catch (error) {
    if (error instanceof BackendError && error.status === 401) return null;
    throw error;
  }
});

export function redirectToSessionRenewal(returnTo?: string): never {
  redirect(
    returnTo
      ? `/session/renew?next=${encodeURIComponent(safeReturnPath(returnTo))}`
      : "/session/renew",
  );
}

export async function requireUser(returnTo?: string) {
  const user = await currentUser();
  if (!user) redirectToSessionRenewal(returnTo);

  if (!user.emailVerified) redirect("/verify-email");

  return user;
}
