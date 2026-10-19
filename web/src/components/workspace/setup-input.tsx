"use client";

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useId, type ComponentProps } from "react";

export function SetupInput({
  label,
  description,
  id,
  "aria-describedby": describedBy,
  ...props
}: ComponentProps<typeof Input> & {
  label: string;
  name: string;
  description?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? `setup-${props.name}-${generatedId}`;
  const descriptionId = `${inputId}-description`;

  return (
    <Field>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Input
        id={inputId}
        aria-describedby={
          [describedBy, description && descriptionId]
            .filter(Boolean)
            .join(" ") || undefined
        }
        {...props}
      />
      {description && (
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      )}
    </Field>
  );
}
