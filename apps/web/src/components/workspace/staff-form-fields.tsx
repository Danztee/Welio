import { Input } from "@welio/ui/components/input";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@welio/ui/components/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@welio/ui/components/native-select";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";

type Data = WorkspaceDashboardData;

export function StaffFormFields({
  worker,
  isActive,
  onActiveChange,
}: {
  worker?: Data["staff"][number];
  isActive: boolean;
  onActiveChange: (value: boolean) => void;
}) {
  const linkedAccount = Boolean(worker?.userId);

  return (
    <section aria-label="Team member details">
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="staff-name">Full name</FieldLabel>
          <Input
            id="staff-name"
            name="name"
            placeholder="e.g. Jane Doe"
            required
            readOnly={linkedAccount}
            autoComplete="name"
            defaultValue={worker?.name ?? ""}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="staff-email">Email</FieldLabel>
          <Input
            id="staff-email"
            name="email"
            type="email"
            placeholder="name@example.com"
            autoComplete="email"
            required
            readOnly={linkedAccount}
            defaultValue={worker?.email ?? ""}
            maxLength={254}
          />
        </Field>
        {linkedAccount && (
          <FieldDescription className="sm:col-span-2">
            Name and email are managed in the account profile.
          </FieldDescription>
        )}
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="staff-job">Job title</FieldLabel>
          <Input
            id="staff-job"
            name="jobTitle"
            placeholder="Enter a job title"
            defaultValue={worker?.jobTitle ?? "Service specialist"}
            maxLength={100}
          />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="staff-active">Member status</FieldLabel>
          <NativeSelect
            className="w-full"
            id="staff-active"
            name="active"
            value={String(isActive)}
            onChange={(event) => onActiveChange(event.target.value === "true")}
          >
            <NativeSelectOption value="true">Active</NativeSelectOption>
            <NativeSelectOption value="false">Inactive</NativeSelectOption>
          </NativeSelect>
        </Field>
      </FieldGroup>
    </section>
  );
}
