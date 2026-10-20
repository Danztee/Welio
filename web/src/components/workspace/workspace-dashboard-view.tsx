"use client";

import {
  Editor,
  Heading,
  Panel,
  type EditorField,
} from "@/components/platform/shared";
import { BookingNotifications } from "./booking-notifications";
import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui/spinner";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { saveBusinessAction } from "@/app/dashboard/workspace-actions";
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
import { useSearchParams } from "next/navigation";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { RealCustomers } from "./real-customers";
import { StaffEditor } from "./staff-editor";
import { TeamTimeOff } from "./team-time-off";
import { Notice } from "@/components/platform/notice";
import { WorkspaceSettingsPanel } from "./workspace-settings-panel";
import { WorkspaceTables } from "./workspace-tables";
import type { WorkspaceEditorKind as EditorKind } from "./workspace-editor-fields";
import { ListSearch } from "./list-controls";

function SectionLoading() {
  return (
    <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      Loading page…
    </div>
  );
}

const BusinessOverview = dynamic(
  () =>
    import("@/components/dashboard/business-overview").then(
      (module) => module.BusinessOverview,
    ),
  { loading: SectionLoading },
);
const OwnerAppointments = dynamic(
  () =>
    import("./owner-appointments").then((module) => module.OwnerAppointments),
  { loading: SectionLoading },
);
const ReceptionistControl = dynamic(
  () =>
    import("./receptionist-control").then(
      (module) => module.ReceptionistControl,
    ),
  { loading: SectionLoading },
);

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
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  const instant = Temporal.Instant.from(
    value instanceof Date ? value.toISOString() : new Date(value).toISOString(),
  );
  const date = instant.toZonedDateTimeISO(timeZone);
  if (options.hour)
    return `${String(date.hour).padStart(2, "0")}:${String(date.minute).padStart(2, "0")}`;

  if (options.dateStyle === "medium") {
    const months = [
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
    ];

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

export type WorkspaceRenderModel = {
  user: WorkspaceAppUser;
  data: Data;
  catalog: Catalog | null;
  section: DashboardSection;
  aiConfigured: boolean;
  now: string;
  publicAppOrigin: string;
  settingsTab: "business" | "booking-page" | "booking" | "security" | "profile";
  editor: EditorKind;
  setEditor: Dispatch<SetStateAction<EditorKind>>;
  recordId: string;
  w: Data["workspace"];
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
            variant="warning"
            nativeButton={false}
            render={<Link href={dashboardHref("Team", w.id)} />}
          >
            <PlusIcon data-icon="inline-start" />
            Add team member
          </Button>
        )}
        {!hasActiveService && (
          <Button
            variant="warning"
            nativeButton={false}
            render={<Link href={dashboardHref("Services", w.id)} />}
          >
            <PlusIcon data-icon="inline-start" />
            Add service
          </Button>
        )}
        {hasActiveStaff && hasActiveService && !hasAssignedActiveService && (
          <Button
            variant="warning"
            nativeButton={false}
            render={<Link href={dashboardHref("Services", w.id)} />}
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

  if (!owner) {
    return (
      <Panel
        title={w.name}
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
        date: formatDate(appointment.startsAt, w.timeZone, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }),
        time: formatDate(appointment.startsAt, w.timeZone, {
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
      today={formatDate(now, w.timeZone, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })}
      currency={w.currency}
      receptionistHref={dashboardHref("Receptionist", w.id)}
      appointmentsHref={dashboardHref("Appointments", w.id)}
      bookingHref={w.isPublished ? `/book/${w.slug}` : undefined}
      activity={data.overview.activity.map((item) => ({
        id: item.id,
        title: item.title,
        date: formatDate(item.createdAt, w.timeZone, {
          dateStyle: "medium",
        }),
      }))}
    />
  );
}

function SectionHeading({ model }: { model: WorkspaceRenderModel }) {
  const { section, owner, open } = model;
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

  const descriptions: Partial<Record<DashboardSection, string>> = {
    Receptionist: "Shape the customer conversation and test it before sharing.",
  };
  const searchable = [
    "Customers",
    "Services",
    "Team",
    "Notifications",
  ].includes(section);
  const headingAction =
    searchable || action ? (
      <>
        {searchable && <ListSearch data={model.data} section={section} />}
        {action}
      </>
    ) : undefined;

  return (
    <Heading
      title={section}
      description={descriptions[section]}
      action={headingAction}
    />
  );
}

function WorkspacePageContent({
  model,
  searchQuery,
}: {
  model: WorkspaceRenderModel;
  searchQuery: string;
}) {
  const { data, catalog, owner, section, money, open, resendInvite } = model;
  if (!owner && !["Overview", "Services", "Team"].includes(section)) {
    return <Notice>Your role does not have access to this section.</Notice>;
  }

  switch (section) {
    case "Overview": {
      const activeStaffIds = new Set(
        data.staff
          .filter((person) => person.isActive)
          .map((person) => person.id),
      );
      const activeServices = data.services.filter(
        (service) => service.isActive,
      );
      const hasAssignedActiveService = activeServices.some((service) =>
        data.assignments.some(
          (assignment) =>
            assignment.serviceId === service.id &&
            activeStaffIds.has(assignment.staffId),
        ),
      );
      return (
        <>
          <SetupAlert
            model={model}
            hasActiveStaff={activeStaffIds.size > 0}
            hasActiveService={activeServices.length > 0}
            hasAssignedActiveService={hasAssignedActiveService}
          />
          <DashboardOverview model={model} />
        </>
      );
    }
    case "Appointments":
      return catalog ? (
        <OwnerAppointments
          data={data}
          catalog={catalog}
          searchQuery={searchQuery}
          now={model.now}
        />
      ) : null;
    case "Customers":
      return <RealCustomers data={data} searchQuery={searchQuery} />;
    case "Receptionist":
      return (
        <ReceptionistControl data={data} aiConfigured={model.aiConfigured} />
      );
    case "Services":
    case "Team":
      return (
        <WorkspaceTables
          section={section}
          data={data}
          owner={owner}
          money={money}
          searchQuery={searchQuery}
          onOpen={open}
          onInvite={resendInvite}
        />
      );
    case "Time off":
      return <TeamTimeOff data={data} searchQuery={searchQuery} />;
    case "Notifications":
      return <BookingNotifications data={data} searchQuery={searchQuery} />;
    case "Settings":
      return (
        <WorkspaceSettingsPanel
          data={data}
          user={model.user}
          tab={model.settingsTab}
          publicAppOrigin={model.publicAppOrigin}
          onSaveBusiness={(input) =>
            model.mutate(saveBusinessAction, input).then(() => undefined)
          }
        />
      );
  }
}

function WorkspaceMain({ model }: { model: WorkspaceRenderModel }) {
  const { section } = model;
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("search") ?? "";
  const usesMainWorkspaceCard = [
    "Appointments",
    "Customers",
    "Services",
    "Team",
    "Time off",
    "Notifications",
    "Settings",
  ].includes(section);

  return (
    <main
      id="dashboard-main"
      tabIndex={-1}
      className={cn(
        "mx-auto my-3 flex min-h-0 w-[calc(100%-1.5rem)] max-w-[1600px] min-w-0 flex-1 flex-col overflow-hidden sm:my-0 sm:mb-4 sm:w-[calc(100%-1rem)]",
      )}
    >
      <div
        data-slot={usesMainWorkspaceCard ? "workspace-card" : undefined}
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          usesMainWorkspaceCard && "rounded-xl border border-border bg-card",
        )}
      >
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            section === "Settings"
              ? "overflow-hidden"
              : "gap-6 overflow-y-auto overscroll-contain [&>*]:shrink-0",
            section !== "Settings" &&
              (usesMainWorkspaceCard
                ? "p-4 sm:p-6"
                : "px-1 py-4 sm:px-2 sm:py-6"),
            section === "Overview" && "p-0",
          )}
          role="region"
          aria-label={`${section} content`}
          tabIndex={0}
        >
          {section === "Overview" && <h1 className="sr-only">Overview</h1>}
          <SectionHeading model={model} />
          <WorkspacePageContent model={model} searchQuery={searchQuery} />
        </div>
      </div>
    </main>
  );
}

function WorkspaceDialogLayers({ model }: { model: WorkspaceRenderModel }) {
  const { data, editor, setEditor, recordId, service, fields, save } = model;

  return (
    <>
      {editor === "staff" && (
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
    </>
  );
}

function editorTitle(
  editor: Exclude<EditorKind, null>,
  service: Data["services"][number] | undefined,
) {
  if (editor === "assignments") return "Assign team members";

  if (editor === "service") return service ? "Edit service" : "Add service";

  return "Edit profile";
}

function editorDescription(
  editor: Exclude<EditorKind, null>,
  service: Data["services"][number] | undefined,
) {
  if (editor === "assignments") {
    return `Choose who can take appointments for ${service?.name ?? "this service"}.`;
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
        .map((item) => ({ ...item, href: dashboardHref(item.name, w.id) }))}
      picker={picker}
      accountMenu={accountMenu}
      headerActions={bellPanel}
    >
      <WorkspaceMain model={model} />
      <WorkspaceDialogLayers model={model} />
    </DashboardShell>
  );
}
