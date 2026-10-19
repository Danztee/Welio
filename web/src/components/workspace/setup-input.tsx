"use client";

import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type ComponentProps } from "react";

export function SetupInput({
  label,
  description,
  ...props
}: ComponentProps<typeof Input> & {
  label: string;
  name: string;
  description?: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={`setup-${props.name}`}>{label}</FieldLabel>
      <Input id={`setup-${props.name}`} {...props} />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}
