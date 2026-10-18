"use client";

import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Errors, FieldName } from "./auth-form-types";

export function NameFields({
  errors,
  clear,
}: {
  errors: Errors;
  clear: (field: FieldName) => void;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {(["firstName", "lastName"] as const).map((field) => (
        <Field key={field} data-invalid={Boolean(errors[field])}>
          <FieldLabel htmlFor={field}>
            {field === "firstName" ? "First name" : "Last name"}
          </FieldLabel>
          <Input
            id={field}
            name={field}
            placeholder={field === "firstName" ? "Ada" : "Okafor"}
            autoComplete={field === "firstName" ? "given-name" : "family-name"}
            required
            maxLength={50}
            className="h-9"
            aria-invalid={Boolean(errors[field])}
            aria-describedby={errors[field] ? `${field}-error` : undefined}
            onChange={() => clear(field)}
          />
          {errors[field] && (
            <FieldError id={`${field}-error`}>{errors[field]}</FieldError>
          )}
        </Field>
      ))}
    </div>
  );
}
