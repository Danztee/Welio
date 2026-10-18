"use client";
import { workspaceAction } from "@/app/dashboard/actions";
import { AccountMenu } from "@/components/dashboard/account-menu";
import { BusinessOverview } from "@/components/dashboard/business-overview";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { WorkspaceSwitcher } from "@/components/dashboard/workspace-switcher";
import { boolOptions, number, text } from "@/components/platform/form-utils";
import { SearchField } from "@/components/platform/search-field";
import {
  Confirm,
  Editor,
  Grid,
  Heading,
  Notice,
  Panel,
  Status,
  type EditorField,
} from "@/components/platform/shared";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { floatingSheetClassName } from "@/components/ui/sheet-styles";
import { authClient } from "@/lib/auth-client";
import { accountNamesSchema } from "@/lib/auth/validation";
import type { Catalog } from "@/lib/bookings/contract";
import { dashboardHref, type DashboardSection } from "@/lib/dashboard-routes";
import { runServerAction } from "@/lib/run-server-action";
import { cn } from "@/lib/utils";
import type {
  listWorkspaces,
  workspaceDetail,
} from "@/lib/workspaces/repository";
import { Temporal } from "@js-temporal/polyfill";
import {
  BellIcon,
  CalendarDaysIcon,
  GlobeIcon,
  LayoutDashboardIcon,
  MessageSquareTextIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SendIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  UsersIcon,
  WrenchIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import {
  BookingPolicies,
  OwnerAppointments,
  PublicBookingSettings,
  RealCustomers,
  StaffEditor,
  TeamTimeOff,
} from "./booking-operations";
import { BusinessSettings } from "./business-settings";
import { ReceptionistControl } from "./receptionist-control";
import { SessionSettings } from "./session-settings";
type Data = Awaited<ReturnType<typeof workspaceDetail>>;
type List = Awaited<ReturnType<typeof listWorkspaces>>;
type User = {
  id: string;
  name: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
};
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

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
  }).format(value / 100);
}

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

function getEditorFields({
  editor,
  service,
  worker,
  workspace,
  data,
  recordId,
  user,
}: {
  editor: "service" | "staff" | "invite" | "account" | "assignments" | null;
  service: Data["services"][number] | undefined;
  worker: Data["staff"][number] | undefined;
  workspace: Data["workspace"] | undefined;
  data: Data | null;
  recordId: string;
  user: User;
}): EditorField[] {
  const assignmentField: EditorField = {
    name: "staff",
    label: "Team members",
    type: "multi",
    description: "Choose who can take appointments for this service.",
    emptyMessage:
      "Add an active team member in Team before assigning this service.",
    value:
      data?.assignments
        .filter((a) => a.serviceId === recordId)
        .map((a) => a.staffId) ?? [],
    options:
      data?.staff
        .filter((s) => s.isActive)
        .map((s) => ({ value: s.id, label: s.name })) ?? [],
  };
  return editor === "assignments"
    ? [assignmentField]
    : editor === "service"
      ? [
          {
            name: "name",
            label: "Service name",
            placeholder: "e.g. Consultation",
            required: true,
            value: service?.name,
          },
          {
            name: "description",
            label: "Description",
            type: "textarea",
            placeholder: "Describe what the service includes.",
            value: service?.description ?? "",
          },
          {
            name: "durationMinutes",
            label: "Duration (minutes)",
            type: "number",
            value: service?.durationMinutes ?? 60,
            required: true,
            min: 15,
            max: 480,
            step: 15,
          },
          {
            name: "price",
            label: `Price (${workspace?.currency})`,
            type: "number",
            value: (service?.priceMinor ?? 1500000) / 100,
            required: true,
            min: 0,
            max: 10000000,
            step: 0.01,
          },
          {
            name: "bufferBeforeMinutes",
            label: "Buffer before (minutes)",
            type: "number",
            value: service?.bufferBeforeMinutes ?? 0,
            min: 0,
            max: 180,
          },
          {
            name: "bufferAfterMinutes",
            label: "Buffer after (minutes)",
            type: "number",
            value: service?.bufferAfterMinutes ?? 0,
            min: 0,
            max: 180,
          },
          {
            name: "active",
            label: "Active",
            type: "select",
            value: String(service?.isActive ?? true),
            options: boolOptions,
          },
          ...(!recordId ? [assignmentField] : []),
        ]
      : editor === "staff"
        ? [
            {
              name: "name",
              label: "Full name",
              placeholder: "e.g. Amina Yusuf",
              required: true,
              value: worker?.name,
            },
            {
              name: "email",
              label: "Email",
              type: "email",
              placeholder: "you@example.com",
              required: true,
              value: worker?.email,
            },
            {
              name: "jobTitle",
              label: "Job title",
              placeholder: "e.g. Stylist",
              value: worker?.jobTitle ?? "Service specialist",
            },
            {
              name: "start",
              label: "Start time",
              type: "time",
              required: true,
              value: worker?.schedule.start ?? "09:00",
            },
            {
              name: "end",
              label: "End time",
              type: "time",
              required: true,
              value: worker?.schedule.end ?? "17:00",
            },
            {
              name: "breakStart",
              label: "Break starts (optional)",
              type: "time",
              value: worker?.schedule.breakStart ?? "",
            },
            {
              name: "breakEnd",
              label: "Break ends (optional)",
              type: "time",
              value: worker?.schedule.breakEnd ?? "",
            },
            {
              name: "days",
              label: "Working days",
              type: "multi",
              value: (worker?.schedule.days ?? [1, 2, 3, 4, 5]).map(String),
              options: [
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ].map((label, i) => ({ value: String(i), label })),
            },
            {
              name: "active",
              label: "Active",
              type: "select",
              value: String(worker?.isActive ?? true),
              options: boolOptions,
            },
          ]
        : editor === "invite"
          ? [
              {
                name: "email",
                label: "Team member email",
                type: "email",
                placeholder: "you@example.com",
                required: true,
              },
            ]
          : [
              {
                name: "firstName",
                label: "First name",
                placeholder: "Ada",
                value: user.firstName ?? "",
                required: true,
              },
              {
                name: "lastName",
                label: "Last name",
                placeholder: "Okafor",
                value: user.lastName ?? "",
                required: true,
              },
            ];
}

export function WorkspaceApp({
  user,
  list,
  data,
  catalog,
  section,
  aiConfigured,
  now,
}: {
  user: User;
  list: List;
  data: Data | null;
  catalog: Catalog | null;
  section: DashboardSection;
  aiConfigured: boolean;
  now: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const settingsTab =
    requestedTab === "business" ||
    requestedTab === "booking-page" ||
    requestedTab === "booking" ||
    requestedTab === "security"
      ? requestedTab
      : "profile";
  const [searches, setSearches] = useState<Record<string, string>>({});
  const query = searches[section] ?? "";
  const matches = (...values: (string | null | undefined)[]) =>
    values.join(" ").toLowerCase().includes(query.toLowerCase());
  const searchToolbar = (
    <SearchField
      label={`Search ${section.toLowerCase()}`}
      value={query}
      onChange={(value) =>
        setSearches((current) => ({
          ...current,
          [section]: value,
        }))
      }
    />
  );
  const [editor, setEditor] = useState<EditorKind>(null);
  const [recordId, setRecordId] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [revoke, setRevoke] = useState<{
    target: string;
    kind: "member" | "invitation";
  } | null>(null);
  const w = data?.workspace;
  const owner = data?.role === "owner";
  const service = data?.services.find((s) => s.id === recordId);
  const worker = data?.staff.find((s) => s.id === recordId);
  const nav = (name: DashboardSection, id = w?.id) => {
    router.push(dashboardHref(name, id));
  };
  const open = (kind: NonNullable<typeof editor>, id = "") => {
    setRecordId(id);
    setEditor(kind);
  };
  async function mutate(action: string, input: unknown) {
    const result = await runServerAction(() =>
      workspaceAction(action, w?.id ?? "", input),
    );
    if (!result.ok) throw Error(result.error);
    router.refresh();
    return result.id;
  }
  const fields = getEditorFields({
    editor,
    service,
    worker,
    workspace: w,
    data,
    recordId,
    user,
  });
  async function save(form: FormData) {
    if (editor === "account") {
      const names = accountNamesSchema.safeParse({
        firstName: text(form, "firstName"),
        lastName: text(form, "lastName"),
      });
      if (!names.success) throw Error(names.error.issues[0].message);
      const result = await authClient.updateUser(names.data);
      if (result.error) throw Error("Could not update your name.");
      router.refresh();
      return;
    }
    const kind = editor;
    if (!kind) return;
    let input: unknown;
    if (kind === "staff")
      input = {
        ...(recordId ? { id: recordId } : {}),
        name: text(form, "name"),
        email: text(form, "email"),
        jobTitle: text(form, "jobTitle"),
        isActive: text(form, "active") === "true",
        schedule: {
          start: text(form, "start"),
          end: text(form, "end"),
          breakStart: text(form, "breakStart"),
          breakEnd: text(form, "breakEnd"),
          days: form.getAll("days").map((v) => Number(v)),
        },
      };
    if (kind === "assignments")
      input = {
        serviceId: recordId,
        staffIds: form.getAll("staff").map(String),
      };
    if (kind === "service")
      input = {
        ...(recordId ? { id: recordId } : {}),
        name: text(form, "name"),
        description: text(form, "description"),
        durationMinutes: number(form, "durationMinutes"),
        price: number(form, "price"),
        bufferBeforeMinutes: number(form, "bufferBeforeMinutes"),
        bufferAfterMinutes: number(form, "bufferAfterMinutes"),
        isActive: text(form, "active") === "true",
        ...(!recordId ? { staffIds: form.getAll("staff").map(String) } : {}),
      };
    if (kind === "invite") input = text(form, "email").toLowerCase();
    await mutate(kind === "assignments" ? "assignServiceStaff" : kind, input);
    if (kind === "assignments") {
      toast.success("Team assignments saved.");
      return;
    }
    if (kind === "staff" && !recordId) {
      const email = text(form, "email").toLowerCase();
      if (
        email &&
        !data?.members.some((member) => member.email.toLowerCase() === email)
      ) {
        try {
          await mutate("invite", email);
          toast.success("Team member added. Dashboard invitation sent.");
        } catch {
          toast.warning(
            "Team member added, but the dashboard invitation could not be sent. Use the team member menu to retry.",
          );
        }
        return;
      }
      toast.success("Team member added with existing dashboard access.");
      return;
    }
    toast.success(
      kind === "invite"
        ? "Invitation sent. It expires in 7 days."
        : "Changes saved.",
    );
  }
  const money = (v: number) => formatCurrency(v, w?.currency ?? "NGN");
  const accessFor = (email: string) => {
    const normalized = email.toLowerCase();
    if (
      data?.members.some((member) => member.email.toLowerCase() === normalized)
    )
      return "Active";
    if (
      data?.invitations.some(
        (invite) =>
          invite.email.toLowerCase() === normalized &&
          !invite.revokedAt &&
          !invite.acceptedAt &&
          new Date(invite.expiresAt).getTime() > Date.now(),
      )
    )
      return "Invited";
    return "No access";
  };
  const accountMenu = (
    <AccountMenu
      name={user.name}
      email={user.email}
      onProfile={() => {
        if (owner)
          router.push(
            `${dashboardHref("Settings", w?.id)}${w?.id ? "&" : "?"}tab=profile`,
          );
        else open("account");
      }}
      onSignOut={async () => {
        const result = await authClient.signOut();
        if (result.error) {
          toast.error("Could not sign out. Try again.");
          return;
        }
        router.push("/sign-in");
        router.refresh();
      }}
    />
  );
  const picker = (
    <WorkspaceSwitcher
      workspaces={list.map((x) => x.workspace)}
      activeId={w?.id ?? ""}
      activeLogo={w?.logo ?? null}
      onSwitch={(id) => nav("Overview", id)}
      createHref="/onboarding?new=true"
    />
  );
  const bellPanel =
    owner && data ? (
      <Sheet>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="Notifications" />
          }
        >
          <BellIcon />
        </SheetTrigger>
        <SheetContent side="right" className={floatingSheetClassName}>
          <SheetHeader className="border-b px-4 py-3 pr-12">
            <SheetTitle>Notifications</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col divide-y">
              {data.notifications.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  No notifications yet.
                </p>
              ) : (
                data.notifications
                  .slice()
                  .reverse()
                  .slice(0, 20)
                  .map((n) => (
                    <div key={n.id} className="flex flex-col gap-1 px-4 py-3">
                      <p className="text-sm leading-snug font-medium">
                        {n.subject}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {n.recipient} ·{" "}
                        {n.kind === "reminder" ? "Reminder" : "Booking update"}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {n.status}
                        {n.attempts > 1 ? ` · ${n.attempts} attempts` : ""}
                      </p>
                    </div>
                  ))
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    ) : null;
  return renderWorkspaceApp({
    user,
    data,
    catalog,
    section,
    aiConfigured,
    now,
    settingsTab,
    matches,
    searchToolbar,
    editor,
    setEditor,
    recordId,
    savingProfile,
    setSavingProfile,
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
    accessFor,
    accountMenu,
    picker,
    bellPanel,
    router,
  });
}

type EditorKind =
  "service" | "staff" | "invite" | "account" | "assignments" | null;
type RevokeTarget = { target: string; kind: "member" | "invitation" } | null;
type WorkspaceRenderModel = {
  user: User;
  data: Data | null;
  catalog: Catalog | null;
  section: DashboardSection;
  aiConfigured: boolean;
  now: string;
  settingsTab: "business" | "booking-page" | "booking" | "security" | "profile";
  matches: (...values: (string | null | undefined)[]) => boolean;
  searchToolbar: ReactNode;
  editor: EditorKind;
  setEditor: Dispatch<SetStateAction<EditorKind>>;
  recordId: string;
  savingProfile: boolean;
  setSavingProfile: Dispatch<SetStateAction<boolean>>;
  revoke: RevokeTarget;
  setRevoke: Dispatch<SetStateAction<RevokeTarget>>;
  w: Data["workspace"] | undefined;
  owner: boolean;
  service: Data["services"][number] | undefined;
  open: (kind: Exclude<EditorKind, null>, id?: string) => void;
  mutate: (action: string, input: unknown) => Promise<string | undefined>;
  fields: EditorField[];
  save: (form: FormData) => Promise<void>;
  money: (value: number) => string;
  accessFor: (email: string) => "Active" | "Invited" | "No access";
  accountMenu: ReactNode;
  picker: ReactNode;
  bellPanel: ReactNode;
  router: ReturnType<typeof useRouter>;
};
function renderWorkspaceApp(model: WorkspaceRenderModel) {
  const {
    user,
    data,
    catalog,
    section,
    aiConfigured,
    now,
    settingsTab,
    matches,
    searchToolbar,
    editor,
    setEditor,
    recordId,
    savingProfile,
    setSavingProfile,
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
    accessFor,
    accountMenu,
    picker,
    bellPanel,
    router,
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
          "mx-3 my-3 flex min-h-0 max-w-[1600px] min-w-0 flex-1 flex-col overflow-hidden sm:mx-4 sm:mt-0 sm:mb-4",
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
                <>
                  <Grid
                    toolbar={searchToolbar}
                    empty={
                      data.services.length
                        ? "No services found"
                        : "No services yet"
                    }
                    emptyDescription={
                      data.services.length
                        ? "Try a different search."
                        : owner
                          ? "Add a service to start accepting bookings."
                          : "Services will appear here once they’re added."
                    }
                    rows={data.services.filter((service) =>
                      matches(service.name, service.description),
                    )}
                    columns={[
                      {
                        label: "Service",
                        cell: (s) => (
                          <div>
                            <p className="font-medium">{s.name}</p>
                            <p
                              title={s.description ?? undefined}
                              className="mt-1 max-w-64 truncate text-xs text-muted-foreground"
                            >
                              {s.description}
                            </p>
                          </div>
                        ),
                      },
                      {
                        label: "Duration",
                        cell: (s) => `${s.durationMinutes} min`,
                      },
                      { label: "Price", cell: (s) => money(s.priceMinor) },
                      {
                        label: "Assigned staff",
                        cell: (s) =>
                          data.staff
                            .filter(
                              (t) =>
                                t.isActive &&
                                data.assignments.some(
                                  (a) =>
                                    a.serviceId === s.id && a.staffId === t.id,
                                ),
                            )
                            .map((t) => t.name)
                            .join(", ") || "Unassigned",
                      },
                      {
                        label: "Status",
                        cell: (s) => (
                          <Status value={s.isActive ? "Active" : "Inactive"} />
                        ),
                      },
                      ...(owner
                        ? [
                            {
                              label: "Actions",
                              cell: (s: Data["services"][number]) => (
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    render={
                                      <Button
                                        size="icon-sm"
                                        variant="ghost"
                                        aria-label="Service actions"
                                      />
                                    }
                                  >
                                    <MoreHorizontalIcon />
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuGroup>
                                      <DropdownMenuItem
                                        onClick={() =>
                                          open("assignments", s.id)
                                        }
                                      >
                                        <UsersIcon />
                                        Assign team members
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => open("service", s.id)}
                                      >
                                        <PencilIcon />
                                        Edit service
                                      </DropdownMenuItem>
                                    </DropdownMenuGroup>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                </>
              )}
              {section === "Team" && (
                <Grid
                  toolbar={searchToolbar}
                  empty={
                    data.staff.length
                      ? "No team members found"
                      : "No team members yet"
                  }
                  emptyDescription={
                    data.staff.length
                      ? "Try a different search."
                      : owner
                        ? "Add a team member to start accepting bookings."
                        : "Team members will appear here once they’re added."
                  }
                  rows={data.staff.filter((staff) =>
                    matches(staff.name, staff.email, staff.jobTitle),
                  )}
                  columns={[
                    {
                      label: "Team member",
                      cell: (s) => (
                        <div>
                          <p className="font-medium">{s.name}</p>
                          {s.jobTitle !== "Owner" && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {s.jobTitle}
                            </p>
                          )}
                        </div>
                      ),
                    },
                    {
                      label: "Role",
                      cell: (s) =>
                        s.role === "owner" ? "Owner" : "Team member",
                    },
                    { label: "Email", cell: (s) => s.email || "—" },
                    {
                      label: "Hours",
                      cell: (s) => `${s.schedule.start}–${s.schedule.end}`,
                    },
                    {
                      label: "Working days",
                      cell: (s) =>
                        s.schedule.days
                          .map(
                            (d) =>
                              ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
                                d
                              ],
                          )
                          .join(", "),
                    },
                    {
                      label: "Status",
                      cell: (s) => (
                        <Status value={s.isActive ? "Active" : "Inactive"} />
                      ),
                    },
                    {
                      label: "Dashboard access",
                      cell: (s) => <Status value={accessFor(s.email)} />,
                    },
                    ...(owner
                      ? [
                          {
                            label: "Actions",
                            cell: (s: Data["staff"][number]) => (
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={
                                    <Button
                                      size="icon-sm"
                                      variant="ghost"
                                      aria-label="Team member actions"
                                    />
                                  }
                                >
                                  <MoreHorizontalIcon />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuGroup>
                                    <DropdownMenuItem
                                      onClick={() => open("staff", s.id)}
                                    >
                                      <PencilIcon />
                                      Edit member
                                    </DropdownMenuItem>
                                    {accessFor(s.email) !== "Active" && (
                                      <DropdownMenuItem
                                        onClick={async () => {
                                          try {
                                            await mutate(
                                              "invite",
                                              s.email.toLowerCase(),
                                            );
                                            toast.success(
                                              "Dashboard invitation sent.",
                                            );
                                          } catch (cause) {
                                            toast.error(
                                              cause instanceof Error
                                                ? cause.message
                                                : "Could not send the invitation.",
                                            );
                                          }
                                        }}
                                      >
                                        <SendIcon />
                                        {accessFor(s.email) === "Invited"
                                          ? "Resend invitation"
                                          : "Send dashboard invite"}
                                      </DropdownMenuItem>
                                    )}
                                  </DropdownMenuGroup>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
              )}
              {section === "Time off" && owner && <TeamTimeOff data={data} />}
              {section === "Members" && owner && (
                <Notice>Choose a section from the navigation.</Notice>
              )}
              {section === "Settings" && owner && (
                <div className="grid min-w-0 gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
                  <aside className="min-w-0" aria-label="Settings navigation">
                    <h1 className="mb-5 text-lg font-semibold tracking-tight">
                      Settings
                    </h1>
                    <nav aria-label="Settings" className="flex flex-col gap-6">
                      {[
                        {
                          heading: "Personal",
                          items: [
                            {
                              id: "profile",
                              label: "Profile",
                              icon: UserRoundIcon,
                            },
                            {
                              id: "security",
                              label: "Authentication",
                              icon: ShieldCheckIcon,
                            },
                          ],
                        },
                        {
                          heading: "Workspace",
                          items: [
                            {
                              id: "business",
                              label: "Business",
                              icon: SettingsIcon,
                            },
                            {
                              id: "booking-page",
                              label: "Booking page",
                              icon: GlobeIcon,
                            },
                            {
                              id: "booking",
                              label: "Booking & reminders",
                              icon: CalendarDaysIcon,
                            },
                          ],
                        },
                      ].map((group) => (
                        <div
                          key={group.heading}
                          className="flex flex-col gap-2"
                        >
                          <p className="px-2 text-xs font-medium text-muted-foreground">
                            {group.heading}
                          </p>
                          <div className="grid grid-cols-2 gap-1 lg:grid-cols-1">
                            {group.items.map(({ id, label, icon: Icon }) => (
                              <Link
                                key={id}
                                href={`${dashboardHref("Settings", w?.id)}${w?.id ? "&" : "?"}tab=${id}`}
                                aria-current={
                                  settingsTab === id ? "page" : undefined
                                }
                                className={cn(
                                  "flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/75 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                                  settingsTab === id &&
                                    "bg-accent font-medium text-accent-foreground",
                                )}
                              >
                                <Icon
                                  className="size-4 shrink-0"
                                  aria-hidden="true"
                                />
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
                    {settingsTab === "profile" && (
                      <>
                        <h2
                          id="settings-section-title"
                          className="text-lg font-semibold"
                        >
                          Profile
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Update the name on your Welio account.
                        </p>
                        <form
                          key={`${user.firstName}-${user.lastName}`}
                          className="mt-8 max-w-2xl"
                          action={async (form) => {
                            const names = accountNamesSchema.safeParse({
                              firstName: text(form, "firstName"),
                              lastName: text(form, "lastName"),
                            });
                            if (!names.success) {
                              toast.error(
                                names.error.issues[0]?.message ??
                                  "Check your name.",
                              );
                              return;
                            }
                            setSavingProfile(true);
                            try {
                              const result = await authClient.updateUser(
                                names.data,
                              );
                              if (result.error)
                                throw Error("Could not update your profile.");
                              toast.success("Profile saved.");
                              router.refresh();
                            } catch {
                              toast.error(
                                "Could not update your profile. Please try again.",
                              );
                            } finally {
                              setSavingProfile(false);
                            }
                          }}
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
                                  placeholder="Ada"
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
                                  placeholder="Okafor"
                                  defaultValue={user.lastName ?? ""}
                                  autoComplete="family-name"
                                  required
                                />
                              </Field>
                            </div>
                            <Field>
                              <FieldLabel htmlFor="settings-email">
                                Email
                              </FieldLabel>
                              <Input
                                id="settings-email"
                                value={user.email}
                                readOnly
                              />
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
                    {settingsTab === "security" && <SessionSettings />}
                    {settingsTab === "business" && w && (
                      <BusinessSettings
                        key={w.id}
                        workspace={w}
                        onSave={async (input) => {
                          await mutate("business", input);
                        }}
                      />
                    )}
                    {settingsTab === "booking" && (
                      <>
                        <h2
                          id="settings-section-title"
                          className="text-lg font-semibold"
                        >
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
                    {settingsTab === "booking-page" && (
                      <>
                        <h2
                          id="settings-section-title"
                          className="text-lg font-semibold"
                        >
                          Booking page
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Publish and manage your customer booking link.
                        </p>
                        <div className="mt-8 max-w-2xl">
                          <PublicBookingSettings data={data} />
                        </div>
                      </>
                    )}
                  </section>
                </div>
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
            await mutate("revoke", revoke);
          }}
        >
          This person will no longer be able to access this workspace. You can
          invite them again later.
        </Confirm>
      )}
    </DashboardShell>
  );
}
