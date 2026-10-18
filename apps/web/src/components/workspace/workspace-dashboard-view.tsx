"use client";

import {
  Confirm,
  Editor,
  Heading,
  Notice,
  Panel,
  type EditorField,
} from "@/components/platform/shared";
import { BusinessOverview } from "@/components/dashboard/business-overview";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import {
  revokeWorkspaceAccessAction,
  saveBusinessAction,
} from "@/app/dashboard/workspace-actions";
import { Button } from "@welio/ui/components/button";
import { buttonVariants } from "@welio/ui/components/button-variants";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@welio/ui/components/alert";
import { cn } from "@welio/ui/lib/utils";
import type { Catalog } from "@welio/domain/bookings/contract";
import { dashboardHref, type DashboardSection } from "@/lib/dashboard-routes";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { Temporal } from "@js-temporal/polyfill";
import {
  CalendarDaysIcon,
  LayoutDashboardIcon,
  MessageSquareTextIcon,
  PlusIcon,
  SettingsIcon,
  UsersIcon,
  WrenchIcon,
} from "lucide-react";
import Link from "next/link";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  OwnerAppointments,
  RealCustomers,
  StaffEditor,
  TeamTimeOff,
} from "./booking-operations";
import { ReceptionistControl } from "./receptionist-control";
import { WorkspaceSettingsPanel } from "./workspace-settings-panel";
import { WorkspaceTables } from "./workspace-tables";
import type { WorkspaceEditorKind as EditorKind } from "./workspace-editor-fields";

type Data = WorkspaceDashboardData;
export type WorkspaceAppUser = {
  id: string;
  name: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
};

function formatDate(
  value: string | Date,
  timeZone: string | undefined,
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  const instant = Temporal.Instant.from(
    value instanceof Date ? value.toISOString() : new Date(value).toISOString(),
  );
  const date = instant.toZonedDateTimeISO(timeZone ?? "UTC");
  if (options.hour)
    return `${String(date.hour).padStart(2, "0")}:${String(date.minute).padStart(2, "0")}`;

  if (options.dateStyle === "medium") {
    const months =
      locale === "en-GB"
        ? [
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
          ]
        : [];

    return `${months[date.month - 1]} ${date.day}, ${date.year}`;
  }

  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

const sections = [
  { name: "Overview", icon: LayoutDashboardIcon },
  { name: "Appointments", icon: CalendarDaysIcon },
  { name: "Customers", icon: UsersIcon },
  { name: "Receptionist", icon: MessageSquareTextIcon },
  { name: "Services", icon: WrenchIcon },
  { name: "Team", icon: UsersIcon },
  { name: "Time off", icon: CalendarDaysIcon },
  { name: "Settings", icon: SettingsIcon },
] as const;

export type RevokeTarget = {
  target: string;
  kind: "member" | "invitation";
} | null;

export type WorkspaceRenderModel = {
  user: WorkspaceAppUser;
  data: Data | null;
  catalog: Catalog | null;
  section: DashboardSection;
  aiConfigured: boolean;
  now: string;
  publicAppOrigin: string;
  settingsTab: "business" | "booking-page" | "booking" | "security" | "profile";
  matches: (...values: (string | null | undefined)[]) => boolean;
  searchToolbar: ReactNode;
  editor: EditorKind;
  setEditor: Dispatch<SetStateAction<EditorKind>>;
  recordId: string;
  revoke: RevokeTarget;
  setRevoke: Dispatch<SetStateAction<RevokeTarget>>;
  w: Data["workspace"] | undefined;
  owner: boolean;
  service: Data["services"][number] | undefined;
  open: (kind: Exclude<EditorKind, null>, id?: string) => void;
  mutate: (
    operation: (
      workspaceId: string,
      input: unknown,
    ) => Promise<{ ok: boolean; error?: string; id?: string }>,
    input: unknown,
  ) => Promise<string | undefined>;
  fields: EditorField[];
  save: (form: FormData) => Promise<void>;
  money: (value: number) => string;
  resendInvite: (email: string) => Promise<void>;
  accountMenu: ReactNode;
  picker: ReactNode;
  bellPanel: ReactNode;
};

export function WorkspaceDashboardView({
  model,
}: {
  model: WorkspaceRenderModel;
}) {
  const {
    user,
    data,
    catalog,
    section,
    aiConfigured,
    now,
    publicAppOrigin,
    settingsTab,
    matches,
    searchToolbar,
    editor,
    setEditor,
    recordId,
    revoke,
    setRevoke,
    w,
    owner,
    service,
    open,
    mutate,
    fields,
    save,
    money,
    resendInvite,
    accountMenu,
    picker,
    bellPanel,
  } = model;
  const activeStaffIds = new Set(
    data?.staff.filter((person) => person.isActive).map((person) => person.id),
  );
  const hasActiveStaff = activeStaffIds.size > 0;
  const hasActiveService = Boolean(
    data?.services.some((item) => item.isActive),
  );
  const hasAssignedActiveService = Boolean(
    data?.services.some(
      (item) =>
        item.isActive &&
        data.assignments.some(
          (assignment) =>
            assignment.serviceId === item.id &&
            activeStaffIds.has(assignment.staffId),
        ),
    ),
  );

  return (
    <DashboardShell
      section={section}
      navigation={sections
        .filter(
          (s) => owner || ["Overview", "Services", "Team"].includes(s.name),
        )
        .map((s) => ({ ...s, href: dashboardHref(s.name, w?.id) }))}
      picker={picker}
      accountMenu={accountMenu}
      headerActions={bellPanel}
    >
      <main
        id="dashboard-main"
        tabIndex={-1}
        className={cn(
          "mx-auto my-3 flex min-h-0 w-[calc(100%-1.5rem)] max-w-[1600px] min-w-0 flex-1 flex-col overflow-hidden sm:my-0 sm:mb-4 sm:w-[calc(100%-2rem)]",
          section !== "Overview" && "rounded-2xl border bg-card",
        )}
      >
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain p-4 sm:p-6 [&>*]:shrink-0",
            section === "Overview" && "p-0",
          )}
          role="region"
          aria-label={`${section} content`}
          tabIndex={0}
        >
          {section === "Overview" && <h1 className="sr-only">Overview</h1>}
          {section !== "Appointments" &&
            section !== "Overview" &&
            section !== "Time off" &&
            section !== "Settings" && (
              <Heading
                title={w ? section : "Welcome to Welio"}
                action={
                  owner && section === "Services" ? (
                    <Button onClick={() => open("service")}>
                      <PlusIcon data-icon="inline-start" />
                      Add service
                    </Button>
                  ) : owner && section === "Team" ? (
                    <Button onClick={() => open("staff")}>
                      <PlusIcon data-icon="inline-start" />
                      Add team member
                    </Button>
                  ) : undefined
                }
              />
            )}
          {data && (
            <>
              {section === "Overview" &&
                owner &&
                (!hasActiveStaff ||
                  !hasActiveService ||
                  !hasAssignedActiveService) && (
                  <Alert
                    role="status"
                    variant="warning"
                    className="gap-2 p-5 sm:p-6"
                  >
                    <AlertTitle className="text-base font-semibold">
                      Finish your booking setup
                    </AlertTitle>
                    <AlertDescription>
                      {!hasActiveStaff
                        ? "Add an active team member before publishing your booking page."
                        : !hasActiveService
                          ? "Add an active service before publishing your booking page."
                          : "Assign an active team member to an active service before publishing your booking page."}
                    </AlertDescription>
                    <div className="mt-4 flex flex-wrap gap-3">
                      {!hasActiveStaff && (
                        <Button
                          variant="outline"
                          render={<Link href={dashboardHref("Team", w?.id)} />}
                        >
                          <PlusIcon data-icon="inline-start" />
                          Add team member
                        </Button>
                      )}
                      {!hasActiveService && (
                        <Button
                          variant="outline"
                          render={
                            <Link href={dashboardHref("Services", w?.id)} />
                          }
                        >
                          <PlusIcon data-icon="inline-start" />
                          Add service
                        </Button>
                      )}
                      {hasActiveStaff &&
                        hasActiveService &&
                        !hasAssignedActiveService && (
                          <Button
                            variant="outline"
                            render={
                              <Link href={dashboardHref("Services", w?.id)} />
                            }
                          >
                            <UsersIcon data-icon="inline-start" />
                            Assign team members
                          </Button>
                        )}
                    </div>
                  </Alert>
                )}
              {section === "Overview" && owner && (
                <BusinessOverview
                  appointments={data.bookings.map((a) => ({
                    id: a.id,
                    customer: a.customerName,
                    service: a.serviceName,
                    date: formatDate(a.startsAt, w?.timeZone, "en-CA", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    }),
                    time: formatDate(a.startsAt, w?.timeZone, "en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                    status:
                      a.status === "completed"
                        ? "Completed"
                        : a.status === "cancelled"
                          ? "Cancelled"
                          : a.status === "confirmed"
                            ? "Confirmed"
                            : a.status,
                  }))}
                  customerCount={data.customers.length}
                  today={formatDate(now, w?.timeZone, "en-CA", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                  })}
                  currency={w?.currency ?? "NGN"}
                  receptionistHref={dashboardHref("Receptionist", w?.id)}
                  appointmentsHref={dashboardHref("Appointments", w?.id)}
                  bookingHref={w?.isPublished ? `/book/${w.slug}` : undefined}
                  activity={data.bookings
                    .slice(-4)
                    .reverse()
                    .map((a) => ({
                      id: a.id,
                      title: `${a.customerName} · ${a.serviceName}`,
                      date: formatDate(a.startsAt, w?.timeZone, "en-GB", {
                        dateStyle: "medium",
                      }),
                    }))}
                />
              )}
              {section === "Overview" && !owner && (
                <Panel
                  title={w?.name ?? "Your workspace"}
                  description="View your business’s services and team."
                >
                  <div className="flex flex-wrap gap-3">
                    <Link
                      className={buttonVariants({ variant: "outline" })}
                      href={dashboardHref("Services", w?.id)}
                    >
                      View services
                    </Link>
                    <Link
                      className={buttonVariants({ variant: "outline" })}
                      href={dashboardHref("Team", w?.id)}
                    >
                      View team
                    </Link>
                  </div>
                </Panel>
              )}
              {section === "Appointments" && owner && catalog && (
                <OwnerAppointments data={data} catalog={catalog} />
              )}
              {section === "Customers" && owner && (
                <RealCustomers data={data} />
              )}
              {section === "Receptionist" && owner && data && (
                <ReceptionistControl data={data} aiConfigured={aiConfigured} />
              )}
              {section === "Services" && (
                <WorkspaceTables
                  section="Services"
                  data={data}
                  owner={owner}
                  toolbar={searchToolbar}
                  matches={matches}
                  money={money}
                  onOpen={open}
                  onInvite={resendInvite}
                />
              )}
              {section === "Team" && (
                <WorkspaceTables
                  section="Team"
                  data={data}
                  owner={owner}
                  toolbar={searchToolbar}
                  matches={matches}
                  money={money}
                  onOpen={open}
                  onInvite={resendInvite}
                />
              )}
              {section === "Time off" && owner && <TeamTimeOff data={data} />}
              {section === "Members" && owner && (
                <Notice>Choose a section from the navigation.</Notice>
              )}
              {section === "Settings" && owner && data && (
                <WorkspaceSettingsPanel
                  data={data}
                  user={user}
                  tab={settingsTab}
                  publicAppOrigin={publicAppOrigin}
                  onSaveBusiness={(input) =>
                    mutate(saveBusinessAction, input).then(() => undefined)
                  }
                />
              )}
              {![
                "Overview",
                "Setup",
                "Services",
                "Team",
                "Time off",
                "Members",
                "Settings",
                "Appointments",
                "Customers",
                "Receptionist",
              ].includes(section) && (
                <Notice>Choose a section from the navigation.</Notice>
              )}
              {!owner &&
                !["Overview", "Services", "Team"].includes(section) && (
                  <Notice>
                    Your role does not have access to this section.
                  </Notice>
                )}
            </>
          )}
        </div>
      </main>
      {editor === "staff" && data && (
        <StaffEditor
          key={`staff-${recordId}`}
          data={data}
          staffId={recordId}
          onClose={() => setEditor(null)}
          onSave={save}
        />
      )}
      {editor && editor !== "staff" && (
        <Editor
          key={`${editor}-${recordId}`}
          title={
            editor === "assignments"
              ? "Assign team members"
              : editor === "service"
                ? service
                  ? "Edit service"
                  : "Add service"
                : editor === "invite"
                  ? "Invite staff member"
                  : "Edit profile"
          }
          description={
            editor === "assignments"
              ? `Choose who can take appointments for ${service?.name ?? "this service"}.`
              : editor === "invite"
                ? "An invitation will be emailed to this person. They must verify and sign in with that address."
                : editor === "service"
                  ? "Set the price, duration, and booking availability."
                  : undefined
          }
          fields={fields}
          onClose={() => setEditor(null)}
          onSave={save}
          successMessage={false}
        />
      )}
      {revoke && (
        <Confirm
          title="Revoke access?"
          label="Revoke access"
          variant="destructive"
          onClose={() => setRevoke(null)}
          onConfirm={async () => {
            await mutate(revokeWorkspaceAccessAction, revoke);
          }}
        >
          This person will no longer be able to access this workspace. You can
          invite them again later.
        </Confirm>
      )}
    </DashboardShell>
  );
}
