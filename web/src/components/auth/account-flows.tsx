"use client";

import { AuthShell } from "./auth-shell";
import { toast } from "@/components/ui/toast";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { TextLink } from "@/components/ui/text-link";
import { buttonVariants } from "@/components/ui/button-variants";
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
      const result = await submitRequest(mode, data, token);
      if (result.error) {
        toast.add({ title: result.error.message, type: "error" });

        return;
      }

      setDone(true);
      toast.add({ title: copy[mode].success, type: "success" });
    } catch {
      toast.add({
        title: "We couldn’t reach the server. Please try again.",
        type: "error",
      });
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
        <div className="flex flex-col gap-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {copy[mode].title}
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {copy[mode].description}
          </p>
        </div>
        {content}
        <TextLink href="/sign-in" className="text-center text-sm">
          Return to sign in
        </TextLink>
      </div>
    </AuthShell>
  );
}
