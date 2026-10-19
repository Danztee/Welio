"use client";

import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "./password-input";
import type { Mode } from "./account-flow-shared";

export function AccountFields({ mode, email }: { mode: Mode; email: string }) {
  if (mode !== "reset-password")
    return (
      <Field>
        <FieldLabel htmlFor="account-email">Email</FieldLabel>
        <Input
          id="account-email"
          name="email"
          type="email"
          placeholder="name@example.com"
          autoCapitalize="none"
          spellCheck={false}
          className="h-9"
          autoComplete="email"
          defaultValue={email}
          maxLength={254}
          required
        />
      </Field>
    );

  return (
    <>
      <Field>
        <FieldLabel htmlFor="new-password">New password</FieldLabel>
        <PasswordInput
          id="new-password"
          name="password"
          placeholder="Enter a new password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
        <PasswordInput
          id="confirm-password"
          name="confirm"
          placeholder="Re-enter your new password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
      </Field>
    </>
  );
}
