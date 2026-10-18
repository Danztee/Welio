"use client";

import { Notice } from "@/components/platform/shared";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { copy, type Mode } from "./account-flow-shared";
import { AccountFields } from "./account-fields";

export function AccountForm({
  mode,
  email,
  busy,
  fieldError,
  submit,
}: {
  mode: Mode;
  email: string;
  busy: boolean;
  fieldError: string;
  submit: (data: FormData) => Promise<void>;
}) {
  return (
    <form action={submit} className="flex flex-col gap-6">
      <FieldGroup>
        <AccountFields mode={mode} email={email} />
      </FieldGroup>
      {fieldError && <Notice error>{fieldError}</Notice>}
      <Button type="submit" className="h-10 w-full" disabled={busy}>
        {busy ? "Please wait…" : copy[mode].submit}
      </Button>
    </form>
  );
}
