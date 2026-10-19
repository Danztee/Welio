"use client";

import {
  Confirm,
  Editor,
  Heading,
  Notice,
  Panel,
  type EditorField,
} from "@/components/platform/shared";
import { ListControls } from "./list-controls";
import { BookingNotifications } from "./booking-notifications";
import { BusinessOverview } from "@/components/dashboard/business-overview";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import {
  revokeWorkspaceAccessAction,
  saveBusinessAction,
} from "@/app/dashboard/workspace-actions";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { Catalog } from "@/lib/domain/bookings/contract";
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

function SetupAlert({
  model,
  hasActiveStaff,
  hasActiveService,
  hasAssignedActiveService,
}: {
  model: WorkspaceRenderModel;
  hasActiveStaff: boolean;
  hasActiveService: boolean;
  hasAssignedActiveService: boolean;
}) {
  const { section, owner, w } = model;
  if (
    section !== "Overview" ||
    !model.data ||
    !owner ||
    (hasActiveStaff && hasActiveService && hasAssignedActiveService)
  ) {
    return null;
  }

  const message = !hasActiveStaff
    ? "Add an active team member before publishing your booking page."
    : !hasActiveService
      ? "Add an active service before publishing your booking page."
      : "Assign an active team member to an active service before publishing your booking page.";

  return (
    <Alert role="status" variant="warning" className="gap-2 p-5 sm:p-6">
      <AlertTitle className="text-base font-semibold">
        Finish your booking setup
      </AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      <div className="mt-4 flex flex-wrap gap-3">
        {!hasActiveStaff && (
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={dashboardHref("Team", w?.id)} />}
          >
            <PlusIcon data-icon="inline-start" />
            Add team member
          </Button>
        )}
        {!hasActiveService && (
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={dashboardHref("Services", w?.id)} />}
          >
            <PlusIcon data-icon="inline-start" />
            Add service
          </Button>
        )}
        {hasActiveStaff && hasActiveService && !hasAssignedActiveService && (
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={dashboardHref("Services", w?.id)} />}
          >
            <UsersIcon data-icon="inline-start" />
            Assign team members
          </Button>
        )}
      </div>
    </Alert>
  );
}

function DashboardOverview({ model }: { model: WorkspaceRenderModel }) {
  const { data, owner, now, w } = model;
  if (!data || !w || model.section !== "Overview") return null;

  if (!owner) {
    return (
      <Panel
        title={w.name ?? "Your workspace"}
        description="View your business’s services and team."
      >
        <div className="flex flex-wrap gap-3">
          <Link
            className={buttonVariants({ variant: "outline" })}
            href={dashboardHref("Services", w.id)}
          >
            View services
          </Link>
          <Link
            className={buttonVariants({ variant: "outline" })}
            href={dashboardHref("Team", w.id)}
          >
            View team
          </Link>
        </div>
      </Panel>
    );
  }

  if (!data.overview) return null;
  return (
    <BusinessOverview
      appointments={data.bookings.map((appointment) => ({
        id: appointment.id,
        customer: appointment.customerName,
        service: appointment.serviceName,
        date: formatDate(appointment.startsAt, w.timeZone, "en-CA", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }),
        time: formatDate(appointment.startsAt, w.timeZone, "en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        status:
          appointment.status === "completed"
            ? "Completed"
            : appointment.status === "cancelled"
              ? "Cancelled"
              : appointment.status === "confirmed"
                ? "Confirmed"
                : appointment.status,
      }))}
      summary={data.overview}
      today={formatDate(now, w.timeZone, "en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })}
      currency={w.currency ?? "NGN"}
      receptionistHref={dashboardHref("Receptionist", w.id)}
      appointmentsHref={dashboardHref("Appointments", w.id)}
      bookingHref={w.isPublished ? `/book/${w.slug}` : undefined}
      activity={data.overview.activity.map((item) => ({
        id: item.id,
        title: item.title,
        date: formatDate(item.createdAt, w.timeZone, "en-GB", {
          dateStyle: "medium",
        }),
      }))}
    />
  );
}

function SectionHeading({ model }: { model: WorkspaceRenderModel }) {
  const { section, owner, w, open } = model;
  const usesSharedHeading = [
    "Appointments",
    "Overview",
    "Time off",
    "Settings",
  ].includes(section);
  if (usesSharedHeading) return null;

  const action =
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
    ) : undefined;

  return <Heading title={w ? section : "Welcome to Welio"} action={action} />;
}

function AppointmentSection({ model }: { model: WorkspaceRenderModel }) {
  const { data, catalog, owner, section } = model;
  if (section !== "Appointments" || !owner || !data || !catalog) return null;

  return <OwnerAppointments data={data} catalog={catalog} />;
}

function CustomerSection({ model }: { model: WorkspaceRenderModel }) {
  const { data, owner, section } = model;
  if (section !== "Customers" || !owner || !data) return null;

  return <RealCustomers data={data} />;
}

function ReceptionistSection({ model }: { model: WorkspaceRenderModel }) {
  const { data, owner, section, aiConfigured } = model;
  if (section !== "Receptionist" || !owner || !data) return null;

  return <ReceptionistControl data={data} aiConfigured={aiConfigured} />;
}

function TableSection({
  model,
  section,
}: {
  model: WorkspaceRenderModel;
  section: "Services" | "Team";
}) {
  const { data, owner, searchToolbar, matches, money, open, resendInvite } =
    model;
  if (model.section !== section || !data) return null;

  return (
    <WorkspaceTables
      section={section}
      data={data}
      owner={owner}
      toolbar={searchToolbar}
      matches={matches}
      money={money}
      onOpen={open}
      onInvite={resendInvite}
    />
  );
}

function TimeOffSection({ model }: { model: WorkspaceRenderModel }) {
  const { data, owner, section } = model;
  if (section !== "Time off" || !owner || !data) return null;

  return <TeamTimeOff data={data} />;
}

function SettingsSection({ model }: { model: WorkspaceRenderModel }) {
  const { data, user, owner, section, settingsTab, publicAppOrigin, mutate } =
    model;
  if (section !== "Settings" || !owner || !data) return null;

  return (
    <WorkspaceSettingsPanel
      data={data}
      user={user}
      tab={settingsTab}
      publicAppOrigin={publicAppOrigin}
      onSaveBusiness={(input) =>
        mutate(saveBusinessAction, input).then(() => undefined)
      }
    />
  );
}

function SectionNotices({ model }: { model: WorkspaceRenderModel }) {
  const { data, owner, section } = model;
  const knownSections = [
    "Overview",
    "Notifications",
    "Setup",
    "Services",
    "Team",
    "Time off",
    "Members",
    "Settings",
    "Appointments",
    "Customers",
    "Receptionist",
  ];

  return (
    <>
      {data && section === "Members" && owner && (
        <Notice>Choose a section from the navigation.</Notice>
      )}
      {data && !knownSections.includes(section) && (
        <Notice>Choose a section from the navigation.</Notice>
      )}
      {!owner && !["Overview", "Services", "Team"].includes(section) && (
        <Notice>Your role does not have access to this section.</Notice>
      )}
    </>
  );
}

function WorkspacePageContent({ model }: { model: WorkspaceRenderModel }) {
  const activeStaffIds = new Set(
    model.data?.staff
      .filter((person) => person.isActive)
      .map((person) => person.id),
  );
  const hasActiveStaff = activeStaffIds.size > 0;
  const hasActiveService = Boolean(
    model.data?.services.some((item) => item.isActive),
  );
  const hasAssignedActiveService = Boolean(
    model.data?.services.some(
      (item) =>
        item.isActive &&
        model.data?.assignments.some(
          (assignment) =>
            assignment.serviceId === item.id &&
            activeStaffIds.has(assignment.staffId),
        ),
    ),
  );

  return (
    <>
      <SetupAlert
        model={model}
        hasActiveStaff={hasActiveStaff}
        hasActiveService={hasActiveService}
        hasAssignedActiveService={hasAssignedActiveService}
      />
      <DashboardOverview model={model} />
      {model.data && <ListControls data={model.data} section={model.section} />}
      {model.section === "Notifications" && model.owner && model.data && (
        <BookingNotifications data={model.data} />
      )}
      <AppointmentSection model={model} />
      <CustomerSection model={model} />
      <ReceptionistSection model={model} />
      <TableSection model={model} section="Services" />
      <TableSection model={model} section="Team" />
      <TimeOffSection model={model} />
      <SettingsSection model={model} />
      <SectionNotices model={model} />
    </>
  );
}

function WorkspaceMain({ model }: { model: WorkspaceRenderModel }) {
  const { section } = model;

  return (
    <main
      id="dashboard-main"
      tabIndex={-1}
      className={cn(
        "mx-auto my-3 flex min-h-0 w-[calc(100%-1.5rem)] max-w-[1600px] min-w-0 flex-1 flex-col overflow-hidden sm:my-0 sm:mb-4 sm:w-[calc(100%-1rem)]",
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
        <SectionHeading model={model} />
        <WorkspacePageContent model={model} />
      </div>
    </main>
  );
}

function WorkspaceDialogLayers({ model }: { model: WorkspaceRenderModel }) {
  const {
    data,
    editor,
    setEditor,
    recordId,
    service,
    fields,
    save,
    revoke,
    setRevoke,
    mutate,
  } = model;

  return (
    <>
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
          title={editorTitle(editor, service)}
          description={editorDescription(editor, service)}
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
    </>
  );
}

function editorTitle(
  editor: Exclude<EditorKind, null>,
  service: Data["services"][number] | undefined,
) {
  if (editor === "assignments") return "Assign team members";

  if (editor === "service") return service ? "Edit service" : "Add service";

  if (editor === "invite") return "Invite staff member";

  return "Edit profile";
}

function editorDescription(
  editor: Exclude<EditorKind, null>,
  service: Data["services"][number] | undefined,
) {
  if (editor === "assignments") {
    return `Choose who can take appointments for ${service?.name ?? "this service"}.`;
  }

  if (editor === "invite") {
    return "An invitation will be emailed to this person. They must verify and sign in with that address.";
  }

  if (editor === "service") {
    return "Set the price, duration, and booking availability.";
  }

  return undefined;
}

export function WorkspaceDashboardView({
  model,
}: {
  model: WorkspaceRenderModel;
}) {
  const { section, w, owner, picker, accountMenu, bellPanel } = model;

  return (
    <DashboardShell
      section={section}
      navigation={sections
        .filter(
          (item) =>
            owner || ["Overview", "Services", "Team"].includes(item.name),
        )
        .map((item) => ({ ...item, href: dashboardHref(item.name, w?.id) }))}
      picker={picker}
      accountMenu={accountMenu}
      headerActions={bellPanel}
    >
      <WorkspaceMain model={model} />
      <WorkspaceDialogLayers model={model} />
    </DashboardShell>
  );
}
