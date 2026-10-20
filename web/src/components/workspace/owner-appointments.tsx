"use client";
import { changeWorkspaceBookingAction } from "@/app/dashboard/booking-actions";
import { Confirm, Grid, Heading, Status } from "@/components/platform/shared";
import { ListControls, ListPagination, ListSearch } from "./list-controls";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  BookingView,
  Catalog,
  ChangeInput,
} from "@/lib/domain/bookings/contract";
import { runServerAction } from "@/lib/run-server-action";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { CalendarDaysIcon, CalendarPlusIcon, ListIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { z } from "zod";
import { apiUrl } from "@/lib/api-url";
import { fromAPIContract } from "@/lib/api-contract";
import { formatMoney, formatWhen } from "./booking-format";
import { AppointmentCalendar } from "./appointment-calendar";
import {
  BookingDetails,
  RealBookingForm,
  RescheduleBooking,
} from "./booking-ui";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { floatingSheetClassName } from "@/components/ui/sheet-styles";
import { EyeIcon, MoreHorizontalIcon } from "lucide-react";

type Data = WorkspaceDashboardData;

const appointmentDetailsSheetClassName = [
  floatingSheetClassName,
  "!top-1/2 !right-auto !bottom-auto !left-1/2 !h-auto !w-[calc(100vw-2rem)] !max-w-[400px] !-translate-x-1/2 !-translate-y-1/2",
  "sm:!inset-y-4 sm:!top-4 sm:!right-4 sm:!bottom-4 sm:!left-auto sm:!h-[calc(100%-2rem)] sm:!w-[400px] sm:!max-w-[calc(100vw-2rem)] sm:!translate-x-0 sm:!translate-y-0",
].join(" ");

async function save(workspaceId: string, input: unknown) {
  const result = await runServerAction(() =>
    changeWorkspaceBookingAction(workspaceId, input),
  );
  if (!result.ok) throw Error(result.error);

  return result;
}

const slotSchema = z.array(
  z.object({ time: z.string(), staffId: z.uuid(), startsAt: z.string() }),
);

const bookingViewSchema = z.object({
  workspaceId: z.uuid(),
  id: z.uuid(),
  version: z.number().int(),
  status: z.enum(["confirmed", "completed", "cancelled", "no_show"]),
  serviceId: z.uuid(),
  staffId: z.uuid(),
  serviceName: z.string(),
  staffName: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  timeZone: z.string(),
  priceMinor: z.number().int(),
  currency: z.string(),
  durationMinutes: z.number().int(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  address: z.string(),
  business: z.string(),
  contactEmail: z.string().nullable(),
  businessPhone: z.string(),
  canChange: z.boolean(),
  cancelHours: z.number().int(),
  slug: z.string(),
});

function toBookingView(
  data: Data,
  booking: Data["bookings"][number],
): BookingView {
  return {
    workspaceId: data.workspace.id,
    id: booking.id,
    version: booking.version,
    status: booking.status,
    serviceId: booking.serviceId,
    staffId: booking.staffId,
    serviceName: booking.serviceName,
    staffName:
      data.staff.find((member) => member.id === booking.staffId)?.name ??
      "Staff",
    startsAt: new Date(booking.startsAt).toISOString(),
    endsAt: new Date(booking.endsAt).toISOString(),
    timeZone: booking.timeZone,
    priceMinor: booking.priceMinor,
    currency: booking.currency,
    durationMinutes: booking.durationMinutes,
    name: booking.customerName,
    email: booking.customerEmail,
    phone: booking.customerPhone,
    address: booking.serviceAddress ?? "",
    business: data.workspace.name,
    contactEmail: data.workspace.contactEmail,
    businessPhone: data.workspace.phone,
    canChange: booking.status === "confirmed",
    cancelHours: data.workspace.cancelHours,
    slug: data.workspace.slug,
  };
}

async function loadAppointmentSlots(
  workspaceId: string,
  appointmentId: string,
  date: string,
) {
  const response = await fetch(
    apiUrl(
      `/v1/workspaces/${workspaceId}/availability?${new URLSearchParams({ appointment_id: appointmentId, date })}`,
    ),
    { cache: "no-store", credentials: "include" },
  );
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = z
      .object({ detail: z.string().optional(), title: z.string().optional() })
      .safeParse(payload);
    throw Error(
      error.success
        ? (error.data.detail ??
            error.data.title ??
            "Could not load availability.")
        : "Could not load availability.",
    );
  }

  return slotSchema.parse(fromAPIContract(payload));
}

async function loadAppointmentDetails(
  workspaceId: string,
  appointmentId: string,
) {
  const response = await fetch(
    apiUrl(`/v1/workspaces/${workspaceId}/appointments/${appointmentId}`),
    { cache: "no-store", credentials: "include" },
  );
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = z
      .object({ detail: z.string().optional(), title: z.string().optional() })
      .safeParse(payload);
    throw Error(
      error.success
        ? (error.data.detail ??
            error.data.title ??
            "Could not load appointment details.")
        : "Could not load appointment details.",
    );
  }

  return bookingViewSchema.parse(fromAPIContract<BookingView>(payload));
}

function OwnerAppointmentTable({
  data,
  searchQuery,
  onSelect,
}: {
  data: Data;
  searchQuery: string;
  onSelect: (bookingId: string) => void;
}) {
  return (
    <Grid
      externalSearch
      searchQuery={searchQuery}
      footer={<ListPagination data={data} section="Appointments" />}
      toolbar={<ListControls data={data} section="Appointments" />}
      empty={
        data.bookings.length ||
        data.pagination?.search ||
        data.pagination?.from ||
        data.pagination?.to ||
        data.pagination?.status
          ? "No appointments found"
          : "No appointments yet"
      }
      emptyDescription={
        data.bookings.length
          ? "Try another search or status."
          : "Appointments will appear here when they’re booked."
      }
      rows={data.bookings}
      columns={[
        {
          label: "Customer",
          cell: (booking) => booking.customerName || "Customer",
        },
        { label: "Service", cell: (booking) => booking.serviceName },
        {
          label: "Date & time",
          cell: (booking) => (
            <div>
              {formatWhen(booking.startsAt, booking.timeZone)}
              <p className="mt-1 text-xs text-muted-foreground">
                {booking.timeZone}
              </p>
            </div>
          ),
        },
        {
          label: "Staff",
          cell: (booking) =>
            data.staff.find((member) => member.id === booking.staffId)?.name ??
            "—",
        },
        {
          label: "Status",
          cell: (booking) => (
            <Status value={booking.status.replace("_", " ")} />
          ),
        },
        {
          label: "Price",
          cell: (booking) => formatMoney(booking.priceMinor, booking.currency),
        },
        {
          label: "Actions",
          cell: (booking) => (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Actions for ${booking.customerName || "appointment"}`}
                  />
                }
              >
                <MoreHorizontalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => onSelect(booking.id)}>
                    <EyeIcon />
                    View details
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
        },
      ]}
    />
  );
}

function AppointmentDialogs({
  data,
  catalog,
  creating,
  selected,
  view,
  detailsLoading,
  detailsError,
  rescheduling,
  command,
  onCreatingChange,
  onRetryDetails,
  onReschedulingChange,
  onCommandChange,
  onCloseDetails,
  onChange,
  onCreated,
}: {
  data: Data;
  catalog: Catalog;
  creating: boolean;
  selected: string;
  view: BookingView | undefined;
  detailsLoading: boolean;
  detailsError: string;
  rescheduling: boolean;
  command: { action: "cancel" | "completed" | "no_show"; key: string } | null;
  onCreatingChange: (creating: boolean) => void;
  onRetryDetails: () => void;
  onReschedulingChange: (rescheduling: boolean) => void;
  onCommandChange: (
    command: { action: "cancel" | "completed" | "no_show"; key: string } | null,
  ) => void;
  onCloseDetails: () => void;
  onChange: (input: ChangeInput) => Promise<void>;
  onCreated: () => void;
}) {
  return (
    <>
      {creating && (
        <Dialog open onOpenChange={onCreatingChange}>
          <DialogContent size="wide">
            <DialogHeader>
              <DialogTitle>New appointment</DialogTitle>
              <DialogDescription>
                Choose a free time, add customer details, then confirm the
                booking.
              </DialogDescription>
            </DialogHeader>
            <RealBookingForm owner catalog={catalog} onDone={onCreated} />
          </DialogContent>
        </Dialog>
      )}
      {selected && (
        <Sheet open onOpenChange={(open) => !open && onCloseDetails()}>
          <SheetContent
            side="right"
            className={appointmentDetailsSheetClassName}
          >
            <SheetHeader>
              <SheetTitle>
                {view?.name ||
                  (detailsLoading
                    ? "Loading appointment"
                    : "Appointment details")}
              </SheetTitle>
              <SheetDescription>
                {view?.serviceName ?? "Appointment details"}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {detailsLoading ? (
                <div
                  className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"
                  role="status"
                >
                  <Spinner aria-hidden="true" />
                  Loading appointment details…
                </div>
              ) : detailsError ? (
                <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
                  <p className="text-sm text-muted-foreground">
                    {detailsError}
                  </p>
                  <Button variant="outline" size="sm" onClick={onRetryDetails}>
                    Try again
                  </Button>
                </div>
              ) : view ? (
                <div className="flex flex-col gap-4">
                  <BookingDetails view={view} />
                  {view.status === "confirmed" && (
                    <div className="grid grid-cols-2 gap-2 border-t pt-4">
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => onReschedulingChange(true)}
                      >
                        Reschedule
                      </Button>
                      <Button
                        variant="destructive"
                        className="w-full"
                        onClick={() =>
                          onCommandChange({
                            action: "cancel",
                            key: crypto.randomUUID(),
                          })
                        }
                      >
                        Cancel appointment
                      </Button>
                      <Button
                        variant="success"
                        className="w-full"
                        onClick={() =>
                          onCommandChange({
                            action: "completed",
                            key: crypto.randomUUID(),
                          })
                        }
                      >
                        Mark completed
                      </Button>
                      <Button
                        variant="warning"
                        className="w-full"
                        onClick={() =>
                          onCommandChange({
                            action: "no_show",
                            key: crypto.randomUUID(),
                          })
                        }
                      >
                        Mark no-show
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </SheetContent>
        </Sheet>
      )}
      {view && rescheduling && (
        <RescheduleBooking
          view={view}
          onClose={() => onReschedulingChange(false)}
          change={onChange}
          loadSlots={(date) =>
            loadAppointmentSlots(data.workspace.id, view.id, date)
          }
        />
      )}
      {view && command && (
        <Confirm
          title={
            command.action === "cancel"
              ? "Cancel appointment?"
              : "Update appointment status?"
          }
          label={
            command.action === "cancel"
              ? "Cancel appointment"
              : command.action === "completed"
                ? "Mark completed"
                : "Mark no-show"
          }
          variant={
            command.action === "cancel"
              ? "destructive"
              : command.action === "completed"
                ? "success"
                : "warning"
          }
          onClose={() => onCommandChange(null)}
          onConfirm={() =>
            onChange({
              key: command.key,
              version: view.version,
              action: command.action,
            })
          }
        >
          {command.action === "cancel"
            ? "This releases the slot and queues a cancellation email. Owner actions can override the customer notice policy."
            : "This closes the appointment. Only use this status after the appointment starts."}
        </Confirm>
      )}
    </>
  );
}

export function OwnerAppointments({
  data,
  catalog,
  searchQuery,
  now,
}: {
  data: Data;
  catalog: Catalog;
  searchQuery: string;
  now: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [loadedView, setLoadedView] = useState<BookingView>();
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [creating, setCreating] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [rescheduling, setRescheduling] = useState(false);
  const [command, setCommand] = useState<{
    action: "cancel" | "completed" | "no_show";
    key: string;
  } | null>(null);
  const detailRequest = useRef(0);
  const selectedBooking = data.bookings.find(
    (booking) => booking.id === selected,
  );
  const view = selectedBooking
    ? toBookingView(data, selectedBooking)
    : loadedView;

  async function selectAppointment(bookingId: string) {
    detailRequest.current += 1;
    const request = detailRequest.current;
    setSelected(bookingId);
    setDetailsError("");
    const booking = data.bookings.find((item) => item.id === bookingId);
    if (booking) {
      setLoadedView(undefined);
      setDetailsLoading(false);
      return;
    }

    setLoadedView(undefined);
    setDetailsLoading(true);
    try {
      const appointment = await loadAppointmentDetails(
        data.workspace.id,
        bookingId,
      );
      if (request === detailRequest.current) setLoadedView(appointment);
    } catch (error) {
      if (request === detailRequest.current) {
        setDetailsError(
          error instanceof Error
            ? error.message
            : "Could not load appointment details.",
        );
      }
    } finally {
      if (request === detailRequest.current) setDetailsLoading(false);
    }
  }

  function retryAppointmentDetails() {
    if (selected) void selectAppointment(selected);
  }

  async function change(input: ChangeInput) {
    if (!view) return;

    await save(data.workspace.id, { id: view.id, change: input });
    setCalendarRefreshKey((key) => key + 1);
    if (!selectedBooking) {
      setLoadedView(await loadAppointmentDetails(data.workspace.id, view.id));
    }
    router.refresh();
  }

  function closeDetails() {
    detailRequest.current += 1;
    setSelected("");
    setLoadedView(undefined);
    setDetailsLoading(false);
    setDetailsError("");
    setRescheduling(false);
    setCommand(null);
  }

  const viewSwitcher = (
    <div
      className="inline-flex shrink-0 items-center rounded-lg border bg-muted/40 p-0.5"
      role="group"
      aria-label="Appointment view"
    >
      <Button
        type="button"
        variant={viewMode === "list" ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={viewMode === "list"}
        onClick={() => setViewMode("list")}
      >
        <ListIcon data-icon="inline-start" />
        List
      </Button>
      <Button
        type="button"
        variant={viewMode === "calendar" ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={viewMode === "calendar"}
        onClick={() => setViewMode("calendar")}
      >
        <CalendarDaysIcon data-icon="inline-start" />
        Calendar
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <Heading
        title="Appointments"
        action={
          <>
            {viewSwitcher}
            <ListSearch data={data} section="Appointments" />
            <Button
              disabled={!catalog.services.length}
              onClick={() => setCreating(true)}
            >
              <CalendarPlusIcon data-icon="inline-start" />
              New appointment
            </Button>
          </>
        }
      />
      <div hidden={viewMode !== "list"}>
        <OwnerAppointmentTable
          data={data}
          searchQuery={searchQuery}
          onSelect={selectAppointment}
        />
      </div>
      <div
        hidden={viewMode !== "calendar"}
        className="min-w-0 overflow-hidden rounded-xl border border-border bg-card"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-3 sm:px-4">
          <ListControls
            data={data}
            section="Appointments"
            idPrefix="calendar"
          />
        </div>
        <AppointmentCalendar
          workspaceId={data.workspace.id}
          timeZone={data.workspace.timeZone}
          now={now}
          active={viewMode === "calendar"}
          search={searchQuery}
          status={data.pagination?.status ?? ""}
          filterFrom={data.pagination?.from ?? ""}
          filterTo={data.pagination?.to ?? ""}
          refreshKey={calendarRefreshKey}
          onSelect={selectAppointment}
        />
      </div>
      <AppointmentDialogs
        data={data}
        catalog={catalog}
        creating={creating}
        selected={selected}
        view={view}
        detailsLoading={detailsLoading}
        detailsError={detailsError}
        rescheduling={rescheduling}
        command={command}
        onCreatingChange={setCreating}
        onRetryDetails={retryAppointmentDetails}
        onReschedulingChange={setRescheduling}
        onCommandChange={setCommand}
        onCloseDetails={closeDetails}
        onChange={change}
        onCreated={() => {
          setCreating(false);
          setCalendarRefreshKey((key) => key + 1);
          router.refresh();
        }}
      />
    </div>
  );
}
