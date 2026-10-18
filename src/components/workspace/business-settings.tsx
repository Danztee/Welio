"use client";

import { text } from "@/components/platform/form-utils";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { workspaceInput } from "@/lib/workspace-contract";
import type { workspaceDetail } from "@/lib/workspaces/repository";
import { ImagePlusIcon, Trash2Icon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

type Workspace = Awaited<ReturnType<typeof workspaceDetail>>["workspace"];

export function BusinessSettings({
  workspace,
  onSave,
}: {
  workspace: Workspace;
  onSave: (input: unknown) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
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
              placeholder="e.g. Maple Studio"
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
              placeholder="your-business"
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
                placeholder="you@example.com"
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
                placeholder="+234 801 234 5678"
                defaultValue={workspace.phone}
                maxLength={40}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="settings-business-area">
              Service area or business address
            </FieldLabel>
            <Textarea
              id="settings-business-area"
              name="serviceArea"
              placeholder="Street, area, and city"
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
