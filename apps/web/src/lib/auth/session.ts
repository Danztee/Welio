import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { safeReturnPath } from "@/lib/auth-path";

export async function currentUser() {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });

  return session?.user ?? null;
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
