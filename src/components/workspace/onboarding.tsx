"use client";

import { toast } from "sonner";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { workspaceDetail } from "@/lib/workspaces/repository";
import { runServerAction } from "@/lib/run-server-action";
import { Textarea } from "@/components/ui/textarea";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Brand } from "@/components/brand";
import { workspaceAction } from "@/app/dashboard/actions";
import { SetupInput } from "./setup-input";

type Data = Awaited<ReturnType<typeof workspaceDetail>>;

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
  const slugEdited = useRef(Boolean(workspace));
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);

    try {
      const input = Object.fromEntries(new FormData(event.currentTarget));
      const result = await runServerAction(() =>
        workspaceAction(
          workspace ? "business" : "create",
          workspace?.id ?? "",
          input,
        ),
      );
      if (!result.ok) throw Error(result.error);

      if (workspace) {
        const finished = await runServerAction(() =>
          workspaceAction("finish", result.id, null),
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
                  placeholder="e.g. Maple Studio"
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
                  placeholder="your-business"
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
                    placeholder="you@example.com"
                    defaultValue={workspace?.contactEmail ?? user.email}
                    maxLength={254}
                    required
                  />
                  <SetupInput
                    label="Phone (optional)"
                    name="phone"
                    type="tel"
                    placeholder="+234 801 234 5678"
                    defaultValue={workspace?.phone ?? ""}
                    maxLength={40}
                  />
                </div>
                <Field>
                  <FieldLabel htmlFor="setup-serviceArea">
                    Service area or business address
                  </FieldLabel>
                  <Textarea
                    id="setup-serviceArea"
                    name="serviceArea"
                    placeholder="Street, area, and city"
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
