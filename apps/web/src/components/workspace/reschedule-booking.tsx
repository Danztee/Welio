"use client";
import { Notice } from "@/components/platform/shared";
import { Button } from "@welio/ui/components/button";
import { Calendar } from "@welio/ui/components/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@welio/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@welio/ui/components/dialog";
import { Spinner } from "@welio/ui/components/spinner";
import type {
  BookingView,
  ChangeInput,
  Slot,
} from "@welio/domain/bookings/contract";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { formatBookingDate } from "./booking-format";

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  return new Date(year, month - 1, day);
}

function formatDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

const selectedDateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function formatSelectedDate(value: string) {
  if (!value) return "";

  return selectedDateFormatter.format(parseDate(value));
}

type RescheduleRetry = { signature: string; key: string };

function getRescheduleKey(
  retry: { current: RescheduleRetry | null },
  view: BookingView,
  date: string,
  time: string,
  staffId: string,
) {
  const signature = JSON.stringify({
    date,
    time,
    staffId,
    version: view.version,
  });
  if (retry.current?.signature !== signature) {
    retry.current = { signature, key: crypto.randomUUID() };
  }

  return retry.current.key;
}

async function submitReschedule({
  date,
  selection,
  view,
  change,
  retry,
  onClose,
  setSaving,
}: {
  date: string;
  selection: string;
  view: BookingView;
  change: (input: ChangeInput) => Promise<void>;
  retry: { current: RescheduleRetry | null };
  onClose: () => void;
  setSaving: (saving: boolean) => void;
}) {
  const [time, staffId] = selection.split("|");
  const key = getRescheduleKey(retry, view, date, time, staffId);
  setSaving(true);

  try {
    await change({
      key,
      version: view.version,
      action: "reschedule",
      date,
      time,
      staffId,
    });
    toast.success("Appointment rescheduled.");
    onClose();
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Could not reschedule.",
    );
  } finally {
    setSaving(false);
  }
}

function RescheduleDateCard({
  date,
  firstDay,
  timeZone,
  onDate,
}: {
  date: string;
  firstDay: Date;
  timeZone: string;
  onDate: (date: string) => void;
}) {
  const selectedDay = date ? parseDate(date) : undefined;

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Choose a new date</CardTitle>
        <CardDescription>Times are shown in {timeZone}.</CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center px-2">
        <Calendar
          mode="single"
          required
          selected={selectedDay}
          onSelect={(value) => onDate(formatDate(value))}
          defaultMonth={selectedDay ?? firstDay}
          startMonth={firstDay}
          disabled={(value) => value < firstDay}
          showOutsideDays={false}
          className="w-full"
        />
      </CardContent>
    </Card>
  );
}

function RescheduleTimeFeedback({
  date,
  loaded,
  busy,
  error,
  hasSlots,
  onRetry,
}: {
  date: string;
  loaded: boolean;
  busy: boolean;
  error: string;
  hasSlots: boolean;
  onRetry: () => void;
}) {
  if (busy) {
    return (
      <div role="status" className="flex items-center gap-2 py-2">
        <Spinner aria-hidden="true" />
        <span className="text-sm text-muted-foreground">
          Checking availability…
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Notice error>{error}</Notice>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (!date) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        Choose a day on the calendar to check its available times.
      </p>
    );
  }

  if (loaded && !hasSlots) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        No times are available on this day. Choose another date.
      </p>
    );
  }

  return null;
}

function RescheduleSlotList({
  slots,
  selection,
  currentStaffId,
  currentStaffName,
  onSelect,
}: {
  slots: Slot[];
  selection: string;
  currentStaffId: string;
  currentStaffName: string;
  onSelect: (selection: string) => void;
}) {
  return (
    <div
      aria-label="Available appointment times"
      className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1"
      role="group"
    >
      {slots.map((slot) => {
        const value = `${slot.time}|${slot.staffId}`;
        const staffName =
          slot.staffId === currentStaffId
            ? currentStaffName
            : "Available team member";
        const isSelected = selection === value;

        return (
          <Button
            key={value}
            type="button"
            variant={isSelected ? "default" : "outline"}
            aria-pressed={isSelected}
            className="h-auto min-h-10 min-w-0 flex-col px-2 py-2 text-center"
            onClick={() => onSelect(value)}
          >
            <span>{slot.time}</span>
            <span className="max-w-full truncate text-xs font-normal opacity-80">
              {staffName}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function RescheduleTimeCard({
  date,
  slots,
  selection,
  loaded,
  busy,
  error,
  currentStaffId,
  currentStaffName,
  onRetry,
  onSelect,
  onConfirm,
}: {
  date: string;
  slots: Slot[];
  selection: string;
  loaded: boolean;
  busy: boolean;
  error: string;
  currentStaffId: string;
  currentStaffName: string;
  onRetry: () => void;
  onSelect: (selection: string) => void;
  onConfirm: () => void;
}) {
  const hasSlots = slots.length > 0;
  const showSlots = !busy && !error && Boolean(date) && hasSlots;

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Available times</CardTitle>
        <CardDescription>
          {date ? formatSelectedDate(date) : "Select a date to see times"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-48 flex-1 flex-col gap-3">
        <RescheduleTimeFeedback
          date={date}
          loaded={loaded}
          busy={busy}
          error={error}
          hasSlots={hasSlots}
          onRetry={onRetry}
        />
        {showSlots && (
          <RescheduleSlotList
            slots={slots}
            selection={selection}
            currentStaffId={currentStaffId}
            currentStaffName={currentStaffName}
            onSelect={onSelect}
          />
        )}
      </CardContent>
      <CardFooter className="justify-end bg-transparent">
        <Button disabled={!selection || busy} onClick={onConfirm}>
          {busy ? "Saving…" : "Confirm new time"}
        </Button>
      </CardFooter>
    </Card>
  );
}

export function RescheduleBooking({
  view,
  loadSlots,
  change,
  onClose,
}: {
  view: BookingView;
  loadSlots: (date: string) => Promise<Slot[]>;
  change: (input: ChangeInput) => Promise<void>;
  onClose: () => void;
}) {
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]),
    [selection, setSelection] = useState(""),
    [loaded, setLoaded] = useState(false),
    [saving, setSaving] = useState(false),
    [loadingVersion, setLoadingVersion] = useState<number | null>(null),
    [availabilityError, setAvailabilityError] = useState("");
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const availabilityRequest = useRef(0);
  const busy = saving || loadingVersion !== null;
  const today = formatBookingDate(new Date(), view.timeZone);
  const firstDay = parseDate(today);

  async function findTimes(selectedDate: string) {
    if (!selectedDate) return;

    const version = ++availabilityRequest.current;
    setLoadingVersion(version);
    setAvailabilityError("");
    try {
      const available = await loadSlots(selectedDate);
      if (version !== availabilityRequest.current) return;

      setSlots(available);
      setLoaded(true);
      setSelection("");
    } catch (error) {
      if (version !== availabilityRequest.current) return;

      const message =
        error instanceof Error
          ? error.message
          : "Could not check availability.";
      setAvailabilityError(message);
      toast.error(message);
    } finally {
      setLoadingVersion((current) => (current === version ? null : current));
    }
  }

  function chooseDate(value: string) {
    availabilityRequest.current += 1;
    setDate(value);
    setSlots([]);
    setSelection("");
    setLoaded(false);
    setAvailabilityError("");
    void findTimes(value);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent size="wide" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Reschedule appointment</DialogTitle>
          <DialogDescription>
            Your original time stays booked until the new time is confirmed.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.85fr)]">
          <RescheduleDateCard
            date={date}
            firstDay={firstDay}
            timeZone={view.timeZone}
            onDate={chooseDate}
          />
          <RescheduleTimeCard
            date={date}
            slots={slots}
            selection={selection}
            loaded={loaded}
            busy={busy}
            error={availabilityError}
            currentStaffId={view.staffId}
            currentStaffName={view.staffName}
            onRetry={() => void findTimes(date)}
            onSelect={setSelection}
            onConfirm={() =>
              void submitReschedule({
                date,
                selection,
                view,
                change,
                retry,
                onClose,
                setSaving,
              })
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
