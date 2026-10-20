"use client";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useState, useTransition, type FormEvent } from "react";
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
  const [navigating, startNavigation] = useTransition();
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
    if (busy || navigating) return;

    setBusy(true);
    const next = safeReturnPath(
      new URLSearchParams(window.location.search).get("next"),
    );
    try {
      const response = isSignUp
        ? await authClient.signUp.email({
            firstName: String(data.get("firstName")).trim(),
            lastName: String(data.get("lastName")).trim(),
            email: result.data.email.toLowerCase(),
            password: result.data.password,
          })
        : await authClient.signIn.email({
            email: result.data.email.toLowerCase(),
            password: result.data.password,
          });
      if (response.error) {
        if (response.error.code === "email_not_verified") {
          startNavigation(() =>
            router.replace(
              `/verify-email?email=${encodeURIComponent(result.data.email)}&next=${encodeURIComponent(next)}`,
            ),
          );

          return;
        }

        toast.add({ title: response.error.message, type: "error" });

        return;
      }

      startNavigation(() =>
        router.replace(
          isSignUp
            ? `/verify-email?email=${encodeURIComponent(result.data.email)}&next=${encodeURIComponent(next)}`
            : next,
        ),
      );
    } catch {
      toast.add({
        title: "We couldn’t reach the server. Please try again.",
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  function clearError(field: FieldName) {
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
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
        <Button
          type="submit"
          className="h-10 w-full"
          disabled={busy || navigating}
        >
          {busy || navigating
            ? "Please wait…"
            : isSignUp
              ? "Sign up"
              : "Sign in"}
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
      </div>
    </div>
  );
}
