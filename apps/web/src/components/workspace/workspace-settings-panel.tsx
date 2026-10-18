"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDaysIcon,
  GlobeIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from "lucide-react";
import { Button } from "@welio/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@welio/ui/components/field";
import { Input } from "@welio/ui/components/input";
import { cn } from "@welio/ui/lib/utils";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { dashboardHref } from "@/lib/dashboard-routes";
import { authClient } from "@/lib/auth-client";
import { accountNamesSchema } from "@/lib/auth/validation";
import { text } from "@/components/platform/form-utils";
import { BusinessSettings } from "./business-settings";
import { BookingPolicies, PublicBookingSettings } from "./booking-operations";
import { SessionSettings } from "./session-settings";
import { toast } from "sonner";

type SettingsTab =
  "business" | "booking-page" | "booking" | "security" | "profile";
type UserProfile = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
};

const groups = [
  {
    heading: "Personal",
    items: [
      { id: "profile", label: "Profile", icon: UserRoundIcon },
      { id: "security", label: "Authentication", icon: ShieldCheckIcon },
    ],
  },
  {
    heading: "Workspace",
    items: [
      { id: "business", label: "Business", icon: SettingsIcon },
      { id: "booking-page", label: "Booking page", icon: GlobeIcon },
      { id: "booking", label: "Booking & reminders", icon: CalendarDaysIcon },
    ],
  },
] as const;

export function WorkspaceSettingsPanel({
  data,
  user,
  tab,
  publicAppOrigin,
  onSaveBusiness,
}: {
  data: WorkspaceDashboardData;
  user: UserProfile;
  tab: SettingsTab;
  publicAppOrigin: string;
  onSaveBusiness: (input: unknown) => Promise<void>;
}) {
  const router = useRouter();
  const [savingProfile, setSavingProfile] = useState(false);
  const workspace = data.workspace;

  async function saveProfile(form: FormData) {
    const names = accountNamesSchema.safeParse({
      firstName: text(form, "firstName"),
      lastName: text(form, "lastName"),
    });
    if (!names.success) {
      toast.error(names.error.issues[0]?.message ?? "Check your name.");

      return;
    }

    setSavingProfile(true);
    try {
      const result = await authClient.updateUser(names.data);
      if (result.error) throw Error("Could not update your profile.");

      toast.success("Profile saved.");
      router.refresh();
    } catch {
      toast.error("Could not update your profile. Please try again.");
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
      <aside className="min-w-0" aria-label="Settings navigation">
        <h1 className="mb-5 text-lg font-semibold tracking-tight">Settings</h1>
        <nav aria-label="Settings" className="flex flex-col gap-6">
          {groups.map((group) => (
            <div key={group.heading} className="flex flex-col gap-2">
              <p className="px-2 text-xs font-medium text-muted-foreground">
                {group.heading}
              </p>
              <div className="grid grid-cols-2 gap-1 lg:grid-cols-1">
                {group.items.map(({ id, label, icon: Icon }) => (
                  <Link
                    key={id}
                    href={`${dashboardHref("Settings", workspace.id)}&tab=${id}`}
                    aria-current={tab === id ? "page" : undefined}
                    className={cn(
                      "flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/75 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      tab === id &&
                        "bg-accent font-medium text-accent-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <section
        className="max-w-3xl min-w-0"
        aria-labelledby="settings-section-title"
      >
        {tab === "profile" && (
          <>
            <h2 id="settings-section-title" className="text-lg font-semibold">
              Profile
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Update the name on your Welio account.
            </p>
            <form
              key={`${user.firstName}-${user.lastName}`}
              className="mt-8 max-w-2xl"
              action={saveProfile}
            >
              <FieldGroup>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="settings-first-name">
                      First name
                    </FieldLabel>
                    <Input
                      id="settings-first-name"
                      name="firstName"
                      placeholder="Jane"
                      defaultValue={user.firstName ?? ""}
                      autoComplete="given-name"
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="settings-last-name">
                      Last name
                    </FieldLabel>
                    <Input
                      id="settings-last-name"
                      name="lastName"
                      placeholder="Doe"
                      defaultValue={user.lastName ?? ""}
                      autoComplete="family-name"
                      required
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="settings-email">Email</FieldLabel>
                  <Input id="settings-email" value={user.email} readOnly />
                </Field>
                <Button
                  type="submit"
                  disabled={savingProfile}
                  className="self-start"
                >
                  {savingProfile ? "Saving…" : "Save changes"}
                </Button>
              </FieldGroup>
            </form>
          </>
        )}
        {tab === "security" && <SessionSettings />}
        {tab === "business" && (
          <BusinessSettings
            key={workspace.id}
            workspace={workspace}
            onSave={onSaveBusiness}
          />
        )}
        {tab === "booking" && (
          <>
            <h2 id="settings-section-title" className="text-lg font-semibold">
              Booking & reminders
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Set booking rules and appointment reminders.
            </p>
            <div className="mt-8 flex flex-col gap-6">
              <BookingPolicies data={data} />
            </div>
          </>
        )}
        {tab === "booking-page" && (
          <>
            <h2 id="settings-section-title" className="text-lg font-semibold">
              Booking page
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Publish and manage your customer booking link.
            </p>
            <div className="mt-8 max-w-2xl">
              <PublicBookingSettings
                data={data}
                publicAppOrigin={publicAppOrigin}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
