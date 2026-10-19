"use client";

import Link from "next/link";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "./password-input";
import type { Errors, FieldName } from "./auth-form-types";
import { NameFields } from "./name-fields";

export function AuthFields({
  isSignUp,
  errors,
  clear,
}: {
  isSignUp: boolean;
  errors: Errors;
  clear: (field: FieldName) => void;
}) {
  return (
    <FieldGroup>
      {isSignUp && <NameFields errors={errors} clear={clear} />}
      <Field data-invalid={Boolean(errors.email)}>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="name@example.com"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          className="h-9"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "email-error" : undefined}
          onChange={() => clear("email")}
        />
        {errors.email && (
          <FieldError id="email-error">{errors.email}</FieldError>
        )}
      </Field>
      <Field data-invalid={Boolean(errors.password)}>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel htmlFor="password">Password</FieldLabel>
          {!isSignUp && (
            <Link
              href="/forgot-password"
              className="rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              Forgot password?
            </Link>
          )}
        </div>
        <PasswordInput
          id="password"
          name="password"
          placeholder="Enter your password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          required
          aria-invalid={Boolean(errors.password)}
          aria-describedby={
            errors.password
              ? "password-error"
              : isSignUp
                ? "password-hint"
                : undefined
          }
          onChange={() => clear("password")}
        />
        {errors.password ? (
          <FieldError id="password-error">{errors.password}</FieldError>
        ) : isSignUp ? (
          <FieldDescription id="password-hint">
            Use at least 12 characters.
          </FieldDescription>
        ) : null}
      </Field>
      {isSignUp && (
        <Field data-invalid={Boolean(errors.confirmPassword)}>
          <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            placeholder="Re-enter your password"
            autoComplete="new-password"
            required
            maxLength={128}
            aria-invalid={Boolean(errors.confirmPassword)}
            aria-describedby={
              errors.confirmPassword ? "confirmPassword-error" : undefined
            }
            onChange={() => clear("confirmPassword")}
          />
          {errors.confirmPassword && (
            <FieldError id="confirmPassword-error">
              {errors.confirmPassword}
            </FieldError>
          )}
        </Field>
      )}
    </FieldGroup>
  );
}
