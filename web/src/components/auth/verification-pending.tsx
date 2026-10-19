"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";
import { safeReturnPath } from "@/lib/auth-path";
import { AuthShell } from "./auth-shell";

export function VerificationPending() {
  const query = useSearchParams();
  const [accountEmail, setAccountEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState(false);
  const verification = useRef<{
    token: string;
    request: ReturnType<typeof authClient.verifyEmail>;
  } | null>(null);
  const token = query.get("token");
  const email = query.get("email") || accountEmail;

  useEffect(() => {
    if (query.get("email")) return;
    let active = true;
    void authClient.getSession().then((result) => {
      if (active && result.data?.user) setAccountEmail(result.data.user.email);
    });
    return () => {
      active = false;
    };
  }, [query]);

  const next = safeReturnPath(query.get("next"));
  useEffect(() => {
    if (!token) return;
    let active = true;
    if (verification.current?.token !== token) {
      verification.current = {
        token,
        request: authClient.verifyEmail({ token }),
      };
    }
    void verification.current.request.then(async (result) => {
      if (!active) return;
      if (result.error) {
        setError(result.error.message);
        setFailed(true);
        return;
      }
      const session = await authClient.getSession();
      if (!active) return;
      window.location.replace(
        session.data?.user?.emailVerified
          ? next
          : `/sign-in?next=${encodeURIComponent(next)}`,
      );
    });
    return () => {
      active = false;
    };
  }, [token, next]);

  async function resend() {
    if (busy || !email) return;
    setBusy(true);
    setError("");
    setSent(false);
    try {
      const result = await authClient.sendVerificationEmail({ email });
      if (result.error) {
        setError(result.error.message);
      } else setSent(true);
    } catch {
      setError("We couldn’t reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {token
              ? failed
                ? "That link didn’t work"
                : "Verifying your email…"
              : "Check your inbox"}
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {token ? (
              failed ? (
                "Request another verification email below."
              ) : (
                "Please wait while we confirm your email address."
              )
            ) : (
              <>
                Follow the link we sent to{" "}
                {email ? (
                  <span className="break-words font-medium text-foreground">
                    {email}
                  </span>
                ) : (
                  "your email address"
                )}{" "}
                to verify your account.
              </>
            )}
          </p>
        </div>
        {query.has("error") && (
          <p role="alert" className="text-sm leading-6 text-destructive">
            That verification link is invalid or has expired. Request a new
            email below.
          </p>
        )}
        {(!token || failed) && (
          <div className="flex flex-col gap-4 text-center">
            <p className="text-sm leading-6 text-muted-foreground">
              Can’t find it? Check your spam folder.
            </p>
            {email && (
              <Button className="h-10 w-full" disabled={busy} onClick={resend}>
                {busy ? "Sending…" : "Resend verification email"}
              </Button>
            )}
            {sent && (
              <p
                role="status"
                className="text-sm leading-6 text-muted-foreground"
              >
                Another verification email is on its way.
              </p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm leading-6 text-destructive">
            {error}
          </p>
        )}
        <TextLink
          href={`/sign-in?next=${encodeURIComponent(safeReturnPath(query.get("next")))}`}
          className="self-center text-sm"
        >
          Return to sign in
        </TextLink>
      </div>
    </AuthShell>
  );
}
