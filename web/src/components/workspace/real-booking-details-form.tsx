import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogFooter } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ServiceLocation } from "@/lib/domain/bookings/contract";
import { BookingLocation } from "@/lib/domain/workspaces/enums";
import { useState, type FormEvent } from "react";

export type BookingCustomerDetails = {
  name: string;
  email: string;
  phone: string;
  address: string;
  serviceLocation: ServiceLocation | "";
};

export function RealBookingDetailsForm({
  serviceArea,
  businessAddress,
  bookingLocation,
  details,
  owner,
  onBack,
  onNext,
}: {
  serviceArea: string | null;
  businessAddress: string | null;
  bookingLocation: BookingLocation;
  details: BookingCustomerDetails;
  owner: boolean;
  onBack: () => void;
  onNext: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const fields = [
    {
      key: "name",
      label: "Full name",
      type: "text",
      placeholder: "e.g. Jane Doe",
      required: true,
      max: 100,
    },
    {
      key: "email",
      label: "Email",
      type: "email",
      placeholder: "name@example.com",
      required: true,
      max: 254,
    },
    {
      key: "phone",
      label: "Phone (optional)",
      type: "tel",
      placeholder: "Enter a phone number",
      required: false,
      max: 40,
    },
  ] as const;
  const [serviceLocation, setServiceLocation] = useState<ServiceLocation | "">(
    bookingLocation === BookingLocation.Both
      ? details.serviceLocation
      : bookingLocation,
  );
  const customerAddress = serviceLocation === BookingLocation.CustomerAddress;
  const atBusinessAddress = serviceLocation === BookingLocation.BusinessAddress;
  const serviceAreaSummary = serviceArea
    ?.split(/\r?\n/)
    .map((area) => area.trim())
    .filter(Boolean)
    .join(", ");

  return (
    <form
      onSubmit={(event) => {
        if (bookingLocation === BookingLocation.Both && !serviceLocation) {
          event.preventDefault();

          return;
        }

        onNext(event);
      }}
      className="flex flex-col gap-5"
    >
      <FieldGroup>
        {fields.map((field) => (
          <Field key={field.key}>
            <FieldLabel htmlFor={`real-${field.key}`}>{field.label}</FieldLabel>
            <Input
              id={`real-${field.key}`}
              name={field.key}
              type={field.type}
              placeholder={field.placeholder}
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
          </Field>
        ))}
        {bookingLocation === BookingLocation.Both && (
          <Field>
            <FieldLabel htmlFor="real-service-location">
              Where should we provide the service?
            </FieldLabel>
            <NativeSelect
              id="real-service-location"
              name="serviceLocation"
              value={serviceLocation}
              onChange={(event) =>
                setServiceLocation(event.target.value as ServiceLocation | "")
              }
              required
              className="w-full"
            >
              <NativeSelectOption value="" disabled>
                Choose a location
              </NativeSelectOption>
              <NativeSelectOption value={BookingLocation.CustomerAddress}>
                At my address
              </NativeSelectOption>
              <NativeSelectOption value={BookingLocation.BusinessAddress}>
                At the business address
              </NativeSelectOption>
            </NativeSelect>
          </Field>
        )}
        {customerAddress && (
          <Field>
            <FieldLabel htmlFor="real-address">Your service address</FieldLabel>
            <Textarea
              id="real-address"
              name="address"
              required
              maxLength={500}
              defaultValue={details.address}
              autoComplete="street-address"
              rows={3}
            />
            {serviceAreaSummary && (
              <p className="text-sm text-muted-foreground">
                This business serves {serviceAreaSummary}.
              </p>
            )}
          </Field>
        )}
        {atBusinessAddress && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">Appointment location</p>
            <p className="mt-1 text-muted-foreground">
              {businessAddress || "Business address not provided"}
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
      <DialogFooter
        className={
          owner ? "justify-between" : "justify-between border-t-0 pt-0"
        }
      >
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="submit">Review booking</Button>
      </DialogFooter>
    </form>
  );
}
