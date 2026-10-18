"use client";

import { AuthShell } from "./auth-shell";
import { toast } from "sonner";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { TextLink } from "@welio/ui/components/text-link";
import { buttonVariants } from "@welio/ui/components/button-variants";
import { Notice } from "@/components/platform/shared";
import { SuccessState } from "./success-state";
import { AccountForm } from "./account-form";
import { type Mode, copy, submitRequest } from "./account-flow-shared";

export function AccountFlow({ mode }: { mode: Mode }) {
  const query = useSearchParams();
  const [done, setDone] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [busy, setBusy] = useState(false);
  const token = query.get("token") ?? "";
  const invalid = mode === "reset-password" && (!token || query.has("error"));

  async function submit(data: FormData) {
    if (busy) return;

    setFieldError("");
    if (
      mode === "reset-password" &&
      data.get("password") !== data.get("confirm")
    ) {
      setFieldError("Passwords don’t match.");

      return;
    }

    setBusy(true);
    try {
      const result = await submitRequest(
        mode,
        data,
        token,
        query.get("next") ?? "",
      );
      if (result.error) {
        toast.error(
          result.error.status === 429
            ? "Too many attempts. Please wait a minute and try again."
            : mode === "reset-password"
              ? "This reset link is invalid or expired. Request a new one."
              : "Could not complete this request. Please try again.",
        );

        return;
      }

      setDone(true);
      toast.success(copy[mode].success);
    } catch {
      toast.error("We couldn’t reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  let content = (
    <AccountForm
      mode={mode}
      email={query.get("email") ?? ""}
      busy={busy}
      fieldError={fieldError}
      submit={submit}
    />
  );
  if (done) content = <SuccessState mode={mode} reset={() => setDone(false)} />;

  if (invalid)
    content = (
      <>
        <Notice error>
          Open a valid reset link from your email, or request a new one.
        </Notice>
        <Link
          className={buttonVariants({ className: "h-10 w-full" })}
          href="/forgot-password"
        >
          Request a new link
        </Link>
      </>
    );

  return (
    <AuthShell>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[1.75rem] font-medium tracking-tight">
            {copy[mode].title}
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {copy[mode].description}
          </p>
        </div>
        {query.has("error") && mode === "verify-email" && (
          <Notice error>
            The verification link is invalid or expired. Request another email
            below.
          </Notice>
        )}
        {content}
        <TextLink href="/sign-in" className="text-center text-sm">
          Return to sign in
        </TextLink>
      </div>
    </AuthShell>
  );
}
