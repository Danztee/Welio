import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogFooter } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FormEvent } from "react";

export type BookingCustomerDetails = {
  name: string;
  email: string;
  phone: string;
  address: string;
};
export function RealBookingDetailsForm({
  serviceArea,
  details,
  onBack,
  onNext,
}: {
  serviceArea: string | null;
  details: BookingCustomerDetails;
  onBack: () => void;
  onNext: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const fields = [
    { key: "name", label: "Full name", type: "text", required: true, max: 100 },
    { key: "email", label: "Email", type: "email", required: true, max: 254 },
    {
      key: "phone",
      label: "Phone (optional)",
      type: "tel",
      required: false,
      max: 40,
    },
    {
      key: "address",
      label: `Service address (${serviceArea ?? "your area"})`,
      type: "text",
      required: true,
      max: 500,
    },
  ] as const;
  return (
    <form onSubmit={onNext} className="flex flex-col gap-5">
      <FieldGroup>
        {fields.map((field) => (
          <Field key={field.key}>
            <FieldLabel htmlFor={`real-${field.key}`}>{field.label}</FieldLabel>
            {field.key === "address" ? (
              <Textarea
                id={`real-${field.key}`}
                name={field.key}
                placeholder="Street, area, and city"
                required
                maxLength={field.max}
                defaultValue={details.address}
                autoComplete="street-address"
                rows={3}
              />
            ) : (
              <Input
                id={`real-${field.key}`}
                name={field.key}
                type={field.type}
                placeholder={
                  field.key === "name"
                    ? "Your full name"
                    : field.key === "email"
                      ? "you@example.com"
                      : "+234 801 234 5678"
                }
                required={field.required}
                maxLength={field.max}
                defaultValue={details[field.key]}
              />
            )}
          </Field>
        ))}
        <Field orientation="horizontal">
          <Checkbox id="real-consent" required />
          <FieldLabel htmlFor="real-consent">
            Email me confirmations, changes, and appointment reminders.
          </FieldLabel>
        </Field>
      </FieldGroup>
      <DialogFooter className="justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="submit">Review booking</Button>
      </DialogFooter>
    </form>
  );
}
