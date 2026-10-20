"use client";
import { changeWorkspaceBookingAction } from "@/app/dashboard/booking-actions";
import { Confirm, Grid, Heading, Status } from "@/components/platform/shared";
import { ListControls, ListPagination, ListSearch } from "./list-controls";
import { Button } from "@/components/ui/button";
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
import { CalendarPlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { apiUrl } from "@/lib/api-url";
import { fromAPIContract } from "@/lib/api-contract";
import { formatMoney, formatWhen } from "./booking-format";
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
  view,
  rescheduling,
  command,
  onCreatingChange,
  onReschedulingChange,
  onCommandChange,
  onCloseDetails,
  onChange,
  onCreated,
}: {
  data: Data;
  catalog: Catalog;
  creating: boolean;
  view: BookingView | undefined;
  rescheduling: boolean;
  command: { action: "cancel" | "completed" | "no_show"; key: string } | null;
  onCreatingChange: (creating: boolean) => void;
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
      {view && (
        <Sheet open onOpenChange={(open) => !open && onCloseDetails()}>
          <SheetContent
            side="right"
            className={appointmentDetailsSheetClassName}
          >
            <SheetHeader>
              <SheetTitle>{view.name || "Appointment details"}</SheetTitle>
              <SheetDescription>
                {view.serviceName} · {view.status.replace("_", " ")}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
}: {
  data: Data;
  catalog: Catalog;
  searchQuery: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [command, setCommand] = useState<{
    action: "cancel" | "completed" | "no_show";
    key: string;
  } | null>(null);
  const selectedBooking = data.bookings.find(
    (booking) => booking.id === selected,
  );
  const view = selectedBooking
    ? toBookingView(data, selectedBooking)
    : undefined;

  async function change(input: ChangeInput) {
    if (!selectedBooking) return;

    await save(data.workspace.id, { id: selectedBooking.id, change: input });
    router.refresh();
  }

  function closeDetails() {
    setSelected("");
    setRescheduling(false);
    setCommand(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <Heading
        title="Appointments"
        action={
          <>
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
      <OwnerAppointmentTable
        data={data}
        searchQuery={searchQuery}
        onSelect={setSelected}
      />
      <AppointmentDialogs
        data={data}
        catalog={catalog}
        creating={creating}
        view={view}
        rescheduling={rescheduling}
        command={command}
        onCreatingChange={setCreating}
        onReschedulingChange={setRescheduling}
        onCommandChange={setCommand}
        onCloseDetails={closeDetails}
        onChange={change}
        onCreated={() => {
          setCreating(false);
          router.refresh();
        }}
      />
    </div>
  );
}
