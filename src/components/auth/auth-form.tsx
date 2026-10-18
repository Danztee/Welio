"use client";

import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { TextLink } from "@/components/ui/text-link";
import { signInSchema, signUpSchema } from "@/lib/auth/validation";
import { safeReturnPath } from "@/lib/auth-path";
import { authClient } from "@/lib/auth-client";
import { AuthFields } from "./auth-fields";
import { type FieldName, type Errors } from "./auth-form-types";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const isSignUp = mode === "sign-up";
  const [errors, setErrors] = useState<Errors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = (isSignUp ? signUpSchema : signInSchema).safeParse({
      firstName: data.get("firstName"),
      lastName: data.get("lastName"),
      confirmPassword: data.get("confirmPassword"),
      email: String(data.get("email") ?? "").trim(),
      password: data.get("password"),
    });
    if (!result.success) {
      const nextErrors: Errors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (
          field === "firstName" ||
          field === "lastName" ||
          field === "email" ||
          field === "password" ||
          field === "confirmPassword"
        )
          nextErrors[field] ??= issue.message;
      }
      setErrors(nextErrors);
      const firstField = (
        [
          "firstName",
          "lastName",
          "email",
          "password",
          "confirmPassword",
        ] as const
      ).find((field) => nextErrors[field]);
      if (firstField)
        form.querySelector<HTMLInputElement>(`[name="${firstField}"]`)?.focus();
      return;
    }
    setErrors({});
    if (busy) return;
    setBusy(true);
    const next = safeReturnPath(
      new URLSearchParams(window.location.search).get("next"),
    );
    try {
      const response = isSignUp
        ? await authClient.signUp.email({
            name: `${String(data.get("firstName")).trim()} ${String(data.get("lastName")).trim()}`,
            firstName: String(data.get("firstName")).trim(),
            lastName: String(data.get("lastName")).trim(),
            email: result.data.email.toLowerCase(),
            password: result.data.password,
            callbackURL: window.location.origin + next,
          })
        : await authClient.signIn.email({
            email: result.data.email.toLowerCase(),
            password: result.data.password,
            callbackURL: window.location.origin + next,
          });
      if (response.error) {
        if (response.error.code === "EMAIL_NOT_VERIFIED") {
          router.push(
            `/verify-email?email=${encodeURIComponent(result.data.email)}&next=${encodeURIComponent(next)}`,
          );
          return;
        }
        toast.error(
          response.error.status === 429
            ? "Too many attempts. Please wait a minute and try again."
            : isSignUp
              ? "Could not create your account. Check your details or try signing in."
              : "Could not sign in. Check your email and password.",
        );
        return;
      }
      form.reset();
      toast.success(isSignUp ? "Account created." : "Signed in.");
      router.push(
        isSignUp
          ? `/verify-email?email=${encodeURIComponent(result.data.email)}&next=${encodeURIComponent(next)}`
          : next,
      );
      router.refresh();
    } catch {
      toast.error("We couldn’t reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function clearError(field: FieldName) {
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[1.75rem] font-medium tracking-tight">
          {isSignUp ? "Get started" : "Welcome back"}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {isSignUp ? "Create a new account" : "Sign in to your account"}
        </p>
      </div>
      <form
        noValidate
        method="post"
        onSubmit={submit}
        className="flex flex-col gap-6"
      >
        <AuthFields isSignUp={isSignUp} errors={errors} clear={clearError} />
        <Button type="submit" className="h-10 w-full" disabled={busy}>
          {busy ? "Please wait…" : isSignUp ? "Sign up" : "Sign in"}
        </Button>
      </form>
      <div className="flex flex-col gap-5">
        <p className="text-center text-sm text-muted-foreground">
          {isSignUp ? "Already have an account?" : "Don’t have an account?"}{" "}
          <TextLink
            href={isSignUp ? "/sign-in" : "/sign-up"}
            onClick={(e) => {
              const next = safeReturnPath(
                new URLSearchParams(window.location.search).get("next"),
              );
              if (next !== "/dashboard") {
                e.preventDefault();
                router.push(
                  `${isSignUp ? "/sign-in" : "/sign-up"}?next=${encodeURIComponent(next)}`,
                );
              }
            }}
            className="font-medium"
          >
            {isSignUp ? "Sign in" : "Sign up"}
          </TextLink>
        </p>
        <p className="text-center text-xs leading-5 text-muted-foreground">
          Your account gives you secure access to your business workspace.
        </p>
      </div>
    </div>
  );
}
