"use client";

import { Notice } from "@/components/platform/shared";
import { Button } from "@welio/ui/components/button";
import { buttonVariants } from "@welio/ui/components/button-variants";
import Link from "next/link";
import type { Mode } from "./account-flow-shared";

export function SuccessState({
  mode,
  reset,
}: {
  mode: Mode;
  reset: () => void;
}) {
  const messages: Record<Mode, string> = {
    "forgot-password":
      "If an account exists for this email, we’ve sent a reset link. Check your inbox.",
    "reset-password":
      "Your password has been reset. Sign in with your new password.",
    "verify-email":
      "If this address belongs to an unverified account, a verification email has been sent.",
  };

  return (
    <>
      <Notice>{messages[mode]}</Notice>
      {mode === "reset-password" ? (
        <Link
          className={buttonVariants({ className: "h-10 w-full" })}
          href="/sign-in"
        >
          Sign in
        </Link>
      ) : (
        <Button variant="outline" onClick={reset}>
          Use another email or resend
        </Button>
      )}
    </>
  );
}
