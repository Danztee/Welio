"use client";

import { Field, FieldLabel } from "@welio/ui/components/field";
import { Input } from "@welio/ui/components/input";
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
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
      </Field>
    </>
  );
}
