import { Button } from "@welio/ui/components/button";
import { Checkbox } from "@welio/ui/components/checkbox";
import { DialogFooter } from "@welio/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@welio/ui/components/field";
import { Input } from "@welio/ui/components/input";
import { Textarea } from "@welio/ui/components/textarea";
import type { FormEvent } from "react";

export type BookingCustomerDetails = {
  name: string;
  email: string;
  phone: string;
  address: string;
};

export function RealBookingDetailsForm({
  serviceArea,
  bookingLocation,
  details,
  onBack,
  onNext,
}: {
  serviceArea: string | null;
  bookingLocation: "customer_address" | "business_address";
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
    ...(bookingLocation === "customer_address"
      ? [
          {
            key: "address",
            label: `Service address (${serviceArea ?? "your area"})`,
            type: "text",
            required: true,
            max: 500,
          },
        ]
      : []),
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
                autoComplete={
                  field.key === "name"
                    ? "name"
                    : field.key === "email"
                      ? "email"
                      : "tel"
                }
                required={field.required}
                maxLength={field.max}
                defaultValue={
                  field.key === "name"
                    ? details.name
                    : field.key === "email"
                      ? details.email
                      : details.phone
                }
              />
            )}
          </Field>
        ))}
        {bookingLocation === "business_address" && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">Appointment location</p>
            <p className="mt-1 text-muted-foreground">
              {serviceArea || "Business address not provided"}
            </p>
          </div>
        )}
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
