"use client";

import { text } from "@/components/platform/form-utils";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { workspaceInput } from "@/lib/domain/workspaces/contract";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { ServiceAreasField } from "./service-areas-field";
import { ImagePlusIcon, Trash2Icon } from "lucide-react";
import { useRef, useState, type FormEvent, type RefObject } from "react";
import { toast } from "@/components/ui/toast";

type Workspace = WorkspaceDashboardData["workspace"];

function BusinessLogoField({
  logo,
  saving,
  preparing,
  inputRef,
  onChoose,
  onRemove,
}: {
  logo: string | null;
  saving: boolean;
  preparing: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChoose: (file?: File) => void;
  onRemove: () => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="settings-business-logo">Business logo</FieldLabel>
      <div className="flex flex-wrap items-center gap-3">
        {logo && (
          <Avatar className="size-10 shrink-0 rounded-lg border after:rounded-lg">
            <AvatarImage
              src={logo}
              alt="Business logo preview"
              className="rounded-lg object-contain"
            />
            <AvatarFallback className="rounded-lg">Logo</AvatarFallback>
          </Avatar>
        )}
        <input
          ref={inputRef}
          id="settings-business-logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={saving || preparing}
          hidden
          onChange={(event) => onChoose(event.target.files?.[0])}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving || preparing}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlusIcon data-icon="inline-start" />
          {preparing ? "Preparing…" : logo ? "Change logo" : "Add logo"}
        </Button>
        {logo && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={saving || preparing}
            onClick={onRemove}
          >
            <Trash2Icon data-icon="inline-start" />
            Remove
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          PNG, JPG, or WebP. Up to 8 MB.
        </p>
      </div>
    </Field>
  );
}

function BusinessIdentityFields({ workspace }: { workspace: Workspace }) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor="settings-business-name">Business name</FieldLabel>
        <Input
          id="settings-business-name"
          name="name"
          placeholder="Enter your business name"
          autoComplete="organization"
          defaultValue={workspace.name}
          required
          maxLength={100}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="settings-business-slug">
          Booking page URL
        </FieldLabel>
        <Input
          id="settings-business-slug"
          name="slug"
          placeholder="Choose a booking page URL"
          autoComplete="off"
          defaultValue={workspace.slug}
          required
          minLength={3}
          maxLength={80}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          aria-describedby="settings-business-slug-help"
        />
        <FieldDescription id="settings-business-slug-help">
          Use lowercase letters, numbers, and hyphens. Changing this updates
          your public booking link.
        </FieldDescription>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="settings-business-email">
            Business email
          </FieldLabel>
          <Input
            id="settings-business-email"
            name="contactEmail"
            type="email"
            placeholder="hello@example.com"
            autoComplete="email"
            defaultValue={workspace.contactEmail ?? ""}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="settings-business-phone">Phone</FieldLabel>
          <Input
            id="settings-business-phone"
            name="phone"
            type="tel"
            placeholder="Enter a phone number"
            autoComplete="tel"
            defaultValue={workspace.phone}
            maxLength={40}
          />
        </Field>
      </div>
    </>
  );
}

function BusinessLocationFields({
  workspace,
  bookingLocation,
  onBookingLocationChange,
}: {
  workspace: Workspace;
  bookingLocation: Workspace["bookingLocation"];
  onBookingLocationChange: (value: Workspace["bookingLocation"]) => void;
}) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor="settings-booking-location">
          Where do appointments take place?
        </FieldLabel>
        <NativeSelect
          id="settings-booking-location"
          name="bookingLocation"
          value={bookingLocation}
          onChange={(event) =>
            onBookingLocationChange(
              event.target.value as Workspace["bookingLocation"],
            )
          }
          className="w-full"
        >
          <NativeSelectOption value="customer_address">
            At the customer’s address
          </NativeSelectOption>
          <NativeSelectOption value="business_address">
            At our business address
          </NativeSelectOption>
          <NativeSelectOption value="both">
            Both (customer chooses)
          </NativeSelectOption>
        </NativeSelect>
        <p className="text-sm text-muted-foreground">
          {bookingLocation === "both"
            ? "Customers can choose your business address or request service at their address."
            : bookingLocation === "business_address"
              ? "Customers will see this address and won’t be asked to enter theirs."
              : "Customers will enter the address where you’ll provide the service."}
        </p>
      </Field>
      {bookingLocation !== "customer_address" && (
        <Field>
          <FieldLabel htmlFor="settings-business-address">
            Business address
          </FieldLabel>
          <Textarea
            id="settings-business-address"
            name="businessAddress"
            autoComplete="street-address"
            defaultValue={workspace.businessAddress ?? ""}
            required
            minLength={2}
            maxLength={200}
            rows={3}
          />
          <p className="text-sm text-muted-foreground">
            {bookingLocation === "both"
              ? "Customers can book here or enter their own service address."
              : "Customers will book appointments at this address."}
          </p>
        </Field>
      )}
      {bookingLocation !== "business_address" ? (
        <ServiceAreasField
          id="settings-service-area"
          value={workspace.serviceArea}
          label={`Areas you serve${bookingLocation === "both" ? " (optional)" : ""}`}
          required={bookingLocation === "customer_address"}
          description={
            bookingLocation === "both"
              ? "Customers enter their exact address when booking at home."
              : "Customers enter the exact appointment address when booking."
          }
        />
      ) : (
        <input
          type="hidden"
          name="serviceArea"
          value={workspace.serviceArea ?? ""}
        />
      )}
      {bookingLocation === "customer_address" && (
        <input
          type="hidden"
          name="businessAddress"
          value={workspace.businessAddress ?? ""}
        />
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="settings-business-zone">Time zone</FieldLabel>
          <NativeSelect
            id="settings-business-zone"
            name="timeZone"
            defaultValue={workspace.timeZone}
            className="w-full"
          >
            {["Africa/Lagos", "Europe/London", "America/New_York", "UTC"].map(
              (zone) => (
                <NativeSelectOption key={zone} value={zone}>
                  {zone}
                </NativeSelectOption>
              ),
            )}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="settings-business-currency">Currency</FieldLabel>
          <NativeSelect
            id="settings-business-currency"
            name="currency"
            defaultValue={workspace.currency}
            className="w-full"
          >
            {["NGN", "USD", "GBP"].map((currency) => (
              <NativeSelectOption key={currency} value={currency}>
                {currency}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>
    </>
  );
}

export function BusinessSettings({
  workspace,
  onSave,
}: {
  workspace: Workspace;
  onSave: (input: unknown) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [bookingLocationOverride, setBookingLocationOverride] = useState<
    Workspace["bookingLocation"] | null
  >(null);
  const bookingLocation = bookingLocationOverride ?? workspace.bookingLocation;
  const [logo, setLogo] = useState<string | null>(workspace.logo);
  const [preparingLogo, setPreparingLogo] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);

  async function chooseLogo(file?: File) {
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.add({ title: "Choose a PNG, JPG, or WebP image.", type: "error" });

      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      toast.add({ title: "Choose an image smaller than 8 MB.", type: "error" });

      return;
    }

    setPreparingLogo(true);
    try {
      const source = await createImageBitmap(file);
      const scale = Math.min(1, 512 / Math.max(source.width, source.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(source.width * scale));
      canvas.height = Math.max(1, Math.round(source.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare this image.");

      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      source.close();
      let blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", 0.82),
      );
      if (!blob || blob.size > 450 * 1024)
        blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/webp", 0.62),
        );

      if (!blob || blob.size > 450 * 1024)
        throw new Error("Choose an image that can be reduced below 450 KB.");

      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () =>
          typeof reader.result === "string"
            ? resolve(reader.result)
            : reject(new Error("Could not read this image."));
        reader.onerror = () => reject(new Error("Could not read this image."));
        reader.readAsDataURL(blob);
      });
      setLogo(dataUrl);
    } catch (cause) {
      toast.add({
        title:
          cause instanceof Error
            ? cause.message
            : "Could not prepare this image.",
        type: "error",
      });
    } finally {
      setPreparingLogo(false);
      if (logoInput.current) logoInput.current.value = "";
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const form = new FormData(event.currentTarget);
    const result = workspaceInput.safeParse({
      name: text(form, "name"),
      logo,
      slug: text(form, "slug"),
      contactEmail: text(form, "contactEmail"),
      phone: text(form, "phone"),
      serviceArea: text(form, "serviceArea"),
      businessAddress: text(form, "businessAddress"),
      bookingLocation: text(form, "bookingLocation"),
      timeZone: text(form, "timeZone"),
      currency: text(form, "currency"),
    });
    if (!result.success) {
      toast.add({ title: result.error.issues[0].message, type: "error" });

      return;
    }

    setSaving(true);
    try {
      await onSave(result.data);
      toast.add({ title: "Business details saved.", type: "success" });
    } catch (cause) {
      toast.add({
        title:
          cause instanceof Error
            ? cause.message
            : "Could not save business details.",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h2 id="settings-section-title" className="text-lg font-semibold">
        Business
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Update the details shown on your booking page.
      </p>
      <form
        onSubmit={submit}
        aria-busy={saving || preparingLogo}
        className="mt-6 max-w-2xl"
      >
        <div className="flex flex-col gap-6">
          <Separator />
          <section
            className="flex flex-col gap-5"
            aria-labelledby="business-profile-heading"
          >
            <div className="flex flex-col gap-1">
              <h3
                id="business-profile-heading"
                className="text-sm font-semibold"
              >
                Business profile
              </h3>
              <p className="text-sm text-muted-foreground">
                Your name, booking link, and contact details.
              </p>
            </div>
            <FieldGroup>
              <BusinessLogoField
                logo={logo}
                saving={saving}
                preparing={preparingLogo}
                inputRef={logoInput}
                onChoose={(file) => void chooseLogo(file)}
                onRemove={() => setLogo(null)}
              />
              <BusinessIdentityFields workspace={workspace} />
            </FieldGroup>
          </section>
          <Separator />
          <section
            className="flex flex-col gap-5"
            aria-labelledby="business-booking-heading"
          >
            <div className="flex flex-col gap-1">
              <h3
                id="business-booking-heading"
                className="text-sm font-semibold"
              >
                Booking details
              </h3>
              <p className="text-sm text-muted-foreground">
                Set service location, time zone, and currency.
              </p>
            </div>
            <FieldGroup>
              <BusinessLocationFields
                workspace={workspace}
                bookingLocation={bookingLocation}
                onBookingLocationChange={setBookingLocationOverride}
              />
            </FieldGroup>
          </section>
          <Button
            type="submit"
            disabled={saving || preparingLogo}
            className="self-start"
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </>
  );
}
