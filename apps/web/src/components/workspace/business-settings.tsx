"use client";

import { text } from "@/components/platform/form-utils";
import { Button } from "@welio/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@welio/ui/components/field";
import { Input } from "@welio/ui/components/input";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@welio/ui/components/avatar";
import {
  NativeSelect,
  NativeSelectOption,
} from "@welio/ui/components/native-select";
import { Textarea } from "@welio/ui/components/textarea";
import { workspaceInput } from "@welio/domain/workspaces/contract";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { ImagePlusIcon, Trash2Icon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

type Workspace = WorkspaceDashboardData["workspace"];

export function BusinessSettings({
  workspace,
  onSave,
}: {
  workspace: Workspace;
  onSave: (input: unknown) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [bookingLocation, setBookingLocation] = useState(
    workspace.bookingLocation,
  );
  const [logo, setLogo] = useState<string | null>(workspace.logo);
  const [preparingLogo, setPreparingLogo] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);

  async function chooseLogo(file?: File) {
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.error("Choose a PNG, JPG, or WebP image.");

      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      toast.error("Choose an image smaller than 8 MB.");

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
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Could not prepare this image.",
      );
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
      bookingLocation: text(form, "bookingLocation"),
      timeZone: text(form, "timeZone"),
      currency: text(form, "currency"),
    });
    if (!result.success) {
      toast.error(
        result.error.issues[0]?.message ?? "Check the business details.",
      );

      return;
    }

    setSaving(true);
    try {
      await onSave(result.data);
      toast.success("Business details saved.");
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Could not save business details.",
      );
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
      <form onSubmit={submit} className="mt-8 max-w-2xl">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="settings-business-logo">
              Business logo
            </FieldLabel>
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
              <Input
                ref={logoInput}
                id="settings-business-logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={saving || preparingLogo}
                className="sr-only"
                onChange={(event) => void chooseLogo(event.target.files?.[0])}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving || preparingLogo}
                onClick={() => logoInput.current?.click()}
              >
                <ImagePlusIcon data-icon="inline-start" />
                {preparingLogo
                  ? "Preparing…"
                  : logo
                    ? "Change logo"
                    : "Add logo"}
              </Button>
              {logo && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={saving || preparingLogo}
                  onClick={() => {
                    setLogo(null);
                  }}
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
          <Field>
            <FieldLabel htmlFor="settings-business-name">
              Business name
            </FieldLabel>
            <Input
              id="settings-business-name"
              name="name"
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
              autoComplete="off"
              defaultValue={workspace.slug}
              required
              minLength={3}
              maxLength={80}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
            />
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
                autoComplete="tel"
                defaultValue={workspace.phone}
                maxLength={40}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="settings-booking-location">
              Where do appointments take place?
            </FieldLabel>
            <NativeSelect
              id="settings-booking-location"
              name="bookingLocation"
              value={bookingLocation}
              onChange={(event) =>
                setBookingLocation(event.target.value as typeof bookingLocation)
              }
              className="w-full"
            >
              <NativeSelectOption value="customer_address">
                At the customer’s address
              </NativeSelectOption>
              <NativeSelectOption value="business_address">
                At our business address
              </NativeSelectOption>
            </NativeSelect>
            <p className="text-sm text-muted-foreground">
              {bookingLocation === "business_address"
                ? "Customers will see this address and won’t be asked to enter theirs."
                : "Customers will enter the address where you’ll provide the service."}
            </p>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-business-area">
              {bookingLocation === "business_address"
                ? "Business address"
                : "Service area"}
            </FieldLabel>
            <Textarea
              id="settings-business-area"
              name="serviceArea"
              autoComplete="street-address"
              defaultValue={workspace.serviceArea ?? ""}
              required
              minLength={2}
              maxLength={200}
              rows={3}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="settings-business-zone">
                Time zone
              </FieldLabel>
              <NativeSelect
                id="settings-business-zone"
                name="timeZone"
                defaultValue={workspace.timeZone}
                className="w-full"
              >
                {[
                  "Africa/Lagos",
                  "Europe/London",
                  "America/New_York",
                  "UTC",
                ].map((zone) => (
                  <NativeSelectOption key={zone} value={zone}>
                    {zone}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="settings-business-currency">
                Currency
              </FieldLabel>
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
          <Button type="submit" disabled={saving} className="self-start">
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </FieldGroup>
      </form>
    </>
  );
}
