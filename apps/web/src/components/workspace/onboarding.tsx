"use client";

import { toast } from "sonner";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { runServerAction } from "@/lib/run-server-action";
import { Textarea } from "@welio/ui/components/textarea";
import {
  NativeSelect,
  NativeSelectOption,
} from "@welio/ui/components/native-select";
import { Field, FieldGroup, FieldLabel } from "@welio/ui/components/field";
import { Button } from "@welio/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@welio/ui/components/card";
import { Brand } from "@/components/brand";
import {
  createWorkspaceAction,
  finishWorkspaceSetupAction,
  saveBusinessAction,
} from "@/app/dashboard/workspace-actions";
import { SetupInput } from "./setup-input";

type Data = WorkspaceDashboardData;

function slugifyBusinessName(name: string) {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
    .replace(/-$/g, "");

  if (!name.trim()) return "";

  if (!slug) return "my-business";

  return slug.length < 3 ? `${slug}-business` : slug;
}

export function WorkspaceOnboarding({
  user,
  data,
}: {
  user: { name: string; email: string };
  data: Data | null;
}) {
  const router = useRouter();
  const workspace = data?.workspace;
  const [businessName, setBusinessName] = useState(workspace?.name ?? "");
  const [slug, setSlug] = useState(workspace?.slug ?? "");
  const [bookingLocation, setBookingLocation] = useState(
    workspace?.bookingLocation ?? "customer_address",
  );
  const slugEdited = useRef(Boolean(workspace));
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);

    try {
      const input = Object.fromEntries(new FormData(event.currentTarget));
      const result = await runServerAction(() =>
        workspace
          ? saveBusinessAction(workspace.id, input)
          : createWorkspaceAction(input),
      );
      if (!result.ok) throw Error(result.error);

      if (workspace) {
        const finished = await runServerAction(() =>
          finishWorkspaceSetupAction(result.id),
        );
        if (!finished.ok) throw Error(finished.error);
      }

      toast.success(
        workspace ? "Business setup completed." : "Business created.",
      );
      router.replace(`/dashboard?workspace=${result.id}`);
      router.refresh();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Could not save your business. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="flex h-16 w-full items-center px-4 sm:px-6 lg:px-8">
          <Brand />
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
        <Card className="gap-0 py-0 shadow-xs">
          <form onSubmit={save} className="flex flex-col">
            <CardHeader className="border-b px-5 py-6 sm:px-8">
              <CardTitle className="text-2xl font-semibold tracking-tight">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {workspace
                    ? "Finish setting up your business"
                    : "Create your business"}
                </h1>
              </CardTitle>
              <CardDescription className="mt-1 text-sm">
                Add your business details. Set up your team and services later
                in the dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5 py-6 sm:px-8 sm:py-8">
              <FieldGroup>
                <SetupInput
                  label="Business name"
                  name="name"
                  autoComplete="organization"
                  value={businessName}
                  onChange={(event) => {
                    const name = event.target.value;
                    setBusinessName(name);
                    if (!slugEdited.current) setSlug(slugifyBusinessName(name));
                  }}
                  minLength={2}
                  maxLength={100}
                  required
                />
                <SetupInput
                  label="Booking page URL"
                  name="slug"
                  autoComplete="off"
                  value={slug}
                  onChange={(event) => {
                    setSlug(event.target.value);
                    slugEdited.current = true;
                  }}
                  minLength={3}
                  maxLength={80}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  required
                  description="Your public booking link updates as you type."
                />
                <div className="grid gap-5 sm:grid-cols-2">
                  <SetupInput
                    label="Business email"
                    name="contactEmail"
                    type="email"
                    autoComplete="email"
                    defaultValue={workspace?.contactEmail ?? user.email}
                    maxLength={254}
                    required
                  />
                  <SetupInput
                    label="Phone (optional)"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    defaultValue={workspace?.phone ?? ""}
                    maxLength={40}
                  />
                </div>
                <Field>
                  <FieldLabel htmlFor="setup-bookingLocation">
                    Where do appointments take place?
                  </FieldLabel>
                  <NativeSelect
                    id="setup-bookingLocation"
                    name="bookingLocation"
                    value={bookingLocation}
                    onChange={(event) =>
                      setBookingLocation(
                        event.target.value as typeof bookingLocation,
                      )
                    }
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
                  <FieldLabel htmlFor="setup-serviceArea">
                    {bookingLocation === "business_address"
                      ? "Business address"
                      : "Service area"}
                  </FieldLabel>
                  <Textarea
                    id="setup-serviceArea"
                    name="serviceArea"
                    autoComplete="street-address"
                    defaultValue={workspace?.serviceArea ?? ""}
                    minLength={2}
                    maxLength={200}
                    rows={3}
                    required
                  />
                </Field>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="setup-timeZone">Time zone</FieldLabel>
                    <NativeSelect
                      id="setup-timeZone"
                      name="timeZone"
                      defaultValue={workspace?.timeZone ?? "Africa/Lagos"}
                    >
                      {[
                        "Africa/Lagos",
                        "Europe/London",
                        "America/New_York",
                        "UTC",
                      ].map((value) => (
                        <NativeSelectOption key={value} value={value}>
                          {value}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="setup-currency">Currency</FieldLabel>
                    <NativeSelect
                      id="setup-currency"
                      name="currency"
                      defaultValue={workspace?.currency ?? "NGN"}
                    >
                      {["NGN", "USD", "GBP"].map((value) => (
                        <NativeSelectOption key={value} value={value}>
                          {value}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-end bg-transparent px-5 py-6 sm:px-8">
              <Button type="submit" disabled={busy}>
                {busy
                  ? "Saving…"
                  : workspace
                    ? "Continue to dashboard"
                    : "Create business"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </main>
    </div>
  );
}
