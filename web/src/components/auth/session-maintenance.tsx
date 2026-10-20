"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { refreshSession, sessionRenewalDelay } from "@/lib/auth/refresh";
import { safeReturnPath } from "@/lib/auth-path";

/** Keep active workspaces authenticated without replacing the page or its forms. */
export function SessionMaintenance() {
  const pathname = usePathname();
  const router = useRouter();
  const protectedRoute =
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/onboarding";

  useEffect(() => {
    if (!protectedRoute) return;
    let active = true;
    let checking = false;
    let timer: ReturnType<typeof setTimeout>;

    function schedule(delay: number) {
      clearTimeout(timer);
      if (active) timer = setTimeout(check, Math.max(1_000, delay));
    }

    async function check() {
      if (!active || checking || document.visibilityState === "hidden") return;
      checking = true;
      clearTimeout(timer);
      try {
        if (!(await refreshSession())) {
          if (active) {
            const next = safeReturnPath(
              window.location.pathname + window.location.search,
            );
            router.replace(`/sign-in?next=${encodeURIComponent(next)}`);
          }
          return;
        }
        schedule(sessionRenewalDelay());
      } catch {
        // Connection failures are retryable; they do not end the account session.
        schedule(30_000);
      } finally {
        checking = false;
      }
    }

    function resume() {
      if (checking || document.visibilityState === "hidden") return;
      const delay = sessionRenewalDelay();
      if (delay === 0) void check();
      else schedule(delay);
    }

    void check();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
    };
  }, [protectedRoute, router]);

  return null;
}
