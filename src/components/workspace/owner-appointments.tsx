"use client";
import { bookingAction } from "@/app/dashboard/booking-actions";
import { Confirm, Grid, Heading, Status } from "@/components/platform/shared";
import { SearchField } from "@/components/platform/search-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  BookingView,
  Catalog,
  ChangeInput,
} from "@/lib/bookings/contract";
import { runServerAction } from "@/lib/run-server-action";
import type { workspaceDetail } from "@/lib/workspaces/repository";
import { CalendarPlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { formatMoney, formatWhen } from "./booking-format";
import {
  BookingDetails,
  RealBookingForm,
  RescheduleBooking,
} from "./booking-ui";
type Data = Awaited<ReturnType<typeof workspaceDetail>>;
async function save(workspaceId: string, action: string, input: unknown) {
  const result = await runServerAction(() =>
    bookingAction(action, workspaceId, input),
  );
  if (!result.ok) throw Error(result.error);
  return result;
}
const slotSchema = z.array(
  z.object({ time: z.string(), staffId: z.uuid(), startsAt: z.string() }),
);
export function OwnerAppointments({
  data,
  catalog,
}: {
  data: Data;
  catalog: Catalog;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [selected, setSelected] = useState(""),
    [creating, setCreating] = useState(false),
    [rescheduling, setRescheduling] = useState(false);
  const [command, setCommand] = useState<{
    action: "cancel" | "completed" | "no_show";
    key: string;
  } | null>(null);
  const a = data.bookings.find((a) => a.id === selected);
  const view: BookingView | undefined = a
    ? {
        workspaceId: data.workspace.id,
        id: a.id,
        version: a.version,
        status: a.status,
        serviceId: a.serviceId,
        staffId: a.staffId,
        serviceName: a.serviceName,
        staffName: data.staff.find((t) => t.id === a.staffId)?.name ?? "Staff",
        startsAt: new Date(a.startsAt).toISOString(),
        endsAt: new Date(a.endsAt).toISOString(),
        timeZone: a.timeZone,
        priceMinor: a.priceMinor,
        currency: a.currency,
        durationMinutes: a.durationMinutes,
        name: a.customerName,
        email: a.customerEmail,
        phone: a.customerPhone,
        address: a.serviceAddress ?? "",
        business: data.workspace.name,
        contactEmail: data.workspace.contactEmail,
        businessPhone: data.workspace.phone,
        canChange: a.status === "confirmed",
        cancelHours: data.workspace.cancelHours,
        slug: data.workspace.slug,
      }
    : undefined;
  async function change(input: ChangeInput) {
    if (!a) return;
    await save(data.workspace.id, "change", { id: a.id, change: input });
    router.refresh();
  }
  return (
    <div className="flex flex-col gap-6">
      <Heading
        title="Appointments"
        action={
          <Button
            disabled={!catalog.services.length}
            onClick={() => setCreating(true)}
          >
            <CalendarPlusIcon data-icon="inline-start" />
            New appointment
          </Button>
        }
      />
      <Grid
        toolbar={
          <>
            <SearchField
              label="Search appointments"
              value={query}
              onChange={setQuery}
            />
            <Select
              value={status}
              onValueChange={(value) => setStatus(value || "all")}
            >
              <SelectTrigger aria-label="Appointment status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {[
                    "all",
                    "confirmed",
                    "completed",
                    "cancelled",
                    "no_show",
                  ].map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "all" ? "All statuses" : s.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </>
        }
        empty={
          data.bookings.length ? "No appointments found" : "No appointments yet"
        }
        emptyDescription={
          data.bookings.length
            ? "Try another search or status."
            : "Appointments will appear here when they’re booked."
        }
        rows={data.bookings.filter(
          (a) =>
            (status === "all" || a.status === status) &&
            `${a.customerName} ${a.customerEmail} ${a.serviceName}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )}
        columns={[
          {
            label: "Customer",
            cell: (a) => (
              <Button
                variant="link"
                className="h-auto justify-start p-0"
                onClick={() => setSelected(a.id)}
              >
                {a.customerName || "Customer"}
              </Button>
            ),
          },
          { label: "Service", cell: (a) => a.serviceName },
          {
            label: "Date & time",
            cell: (a) => (
              <div>
                {formatWhen(a.startsAt, a.timeZone)}
                <p className="mt-1 text-xs text-muted-foreground">
                  {a.timeZone}
                </p>
              </div>
            ),
          },
          {
            label: "Staff",
            cell: (a) =>
              data.staff.find((t) => t.id === a.staffId)?.name ?? "—",
          },
          {
            label: "Status",
            cell: (a) => <Status value={a.status.replace("_", " ")} />,
          },
          {
            label: "Price",
            cell: (a) => formatMoney(a.priceMinor, a.currency),
          },
        ]}
      />
      {creating && (
        <Dialog open onOpenChange={setCreating}>
          <DialogContent size="wide">
            <DialogHeader>
              <DialogTitle>New appointment</DialogTitle>
              <DialogDescription>
                Choose a free time, add customer details, then confirm the
                booking.
              </DialogDescription>
            </DialogHeader>
            <RealBookingForm
              owner
              catalog={catalog}
              onDone={() => {
                setCreating(false);
                router.refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      )}
      {view && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v) setSelected("");
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Appointment details</DialogTitle>
              <DialogDescription>
                {view.id} ·{" "}
                {a?.source === "public" ? "Customer booking" : "Owner booking"}
              </DialogDescription>
            </DialogHeader>
            <BookingDetails view={view} />
            {view.status === "confirmed" && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setRescheduling(true)}>
                  Reschedule
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    setCommand({ action: "cancel", key: crypto.randomUUID() })
                  }
                >
                  Cancel appointment
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    setCommand({
                      action: "completed",
                      key: crypto.randomUUID(),
                    })
                  }
                >
                  Mark completed
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    setCommand({ action: "no_show", key: crypto.randomUUID() })
                  }
                >
                  Mark no-show
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
      {view && rescheduling && (
        <RescheduleBooking
          view={view}
          onClose={() => setRescheduling(false)}
          change={change}
          loadSlots={async (date) => {
            const r = await fetch(
              `/api/workspaces/${data.workspace.id}/availability?${new URLSearchParams({ appointmentId: view.id, date })}`,
              { cache: "no-store" },
            );
            const payload: unknown = await r.json();
            if (!r.ok) {
              const e = z.object({ error: z.string() }).safeParse(payload);
              throw Error(
                e.success ? e.data.error : "Could not load availability.",
              );
            }
            return slotSchema.parse(payload);
          }}
        />
      )}
      {view && command && (
        <Confirm
          title={
            command.action === "cancel"
              ? "Cancel appointment?"
              : "Update appointment status?"
          }
          label="Confirm change"
          variant={command.action === "cancel" ? "destructive" : "default"}
          onClose={() => setCommand(null)}
          onConfirm={() =>
            change({
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
    </div>
  );
}
