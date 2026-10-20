"use client";

import { useEffect, useState } from "react";
import { refreshSession } from "@/lib/auth/refresh";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function SessionRenewal({ next }: { next: string }) {
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    refreshSession()
      .then((renewed) => {
        if (active)
          window.location.replace(
            renewed ? next : `/sign-in?next=${encodeURIComponent(next)}`,
          );
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [next, attempt]);
  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-center gap-4"
      aria-live="polite"
    >
      {!error && <Spinner className="size-6" aria-hidden="true" />}
      <p>
        {error
          ? "We couldn’t reach Welio to restore your session."
          : "Restoring your session…"}
      </p>
      {error && (
        <Button
          onClick={() => {
            setError(false);
            setAttempt(attempt + 1);
          }}
        >
          Try again
        </Button>
      )}
    </main>
  );
}
