"use client";
import { Notice } from "@/components/platform/shared";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { BookingView, ChangeInput, Slot } from "@/lib/bookings/contract";
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

function formatSelectedDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(parseDate(value));
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
    [busy, setBusy] = useState(false),
    [availabilityError, setAvailabilityError] = useState("");
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const availabilityRequest = useRef(0);
  const today = formatBookingDate(new Date(), view.timeZone);
  const firstDay = parseDate(today);

  async function findTimes(selectedDate: string) {
    if (!selectedDate) return;
    const version = ++availabilityRequest.current;
    setBusy(true);
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
      if (version === availabilityRequest.current) setBusy(false);
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
          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Choose a new date</CardTitle>
              <CardDescription>
                Times are shown in {view.timeZone}.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center px-2">
              <Calendar
                mode="single"
                required
                selected={date ? parseDate(date) : undefined}
                onSelect={(value) => chooseDate(formatDate(value))}
                defaultMonth={date ? parseDate(date) : firstDay}
                startMonth={firstDay}
                disabled={(value) => value < firstDay}
                showOutsideDays={false}
                className="w-full"
              />
            </CardContent>
          </Card>

          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Available times</CardTitle>
              <CardDescription>
                {date ? formatSelectedDate(date) : "Select a date to see times"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-48 flex-1 flex-col gap-3">
              {busy && (
                <div role="status" className="flex items-center gap-2 py-2">
                  <Spinner aria-hidden="true" />
                  <span className="text-sm text-muted-foreground">
                    Checking availability…
                  </span>
                </div>
              )}
              {!busy && availabilityError && (
                <div className="flex flex-col items-start gap-3">
                  <Notice error>{availabilityError}</Notice>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void findTimes(date)}
                  >
                    Try again
                  </Button>
                </div>
              )}
              {!busy && !availabilityError && !date && (
                <p className="py-2 text-sm text-muted-foreground">
                  Choose a day on the calendar to check its available times.
                </p>
              )}
              {!busy &&
                !availabilityError &&
                date &&
                loaded &&
                !slots.length && (
                  <p className="py-2 text-sm text-muted-foreground">
                    No times are available on this day. Choose another date.
                  </p>
                )}
              {!busy && !availabilityError && date && slots.length > 0 && (
                <div
                  aria-label="Available appointment times"
                  className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1"
                  role="group"
                >
                  {slots.map((slot) => {
                    const value = `${slot.time}|${slot.staffId}`;
                    const staffName =
                      slot.staffId === view.staffId
                        ? view.staffName
                        : "Available team member";
                    const isSelected = selection === value;
                    return (
                      <Button
                        key={value}
                        type="button"
                        variant={isSelected ? "default" : "outline"}
                        aria-pressed={isSelected}
                        className="h-auto min-h-10 min-w-0 flex-col px-2 py-2 text-center"
                        onClick={() => setSelection(value)}
                      >
                        <span>{slot.time}</span>
                        <span className="max-w-full truncate text-xs font-normal opacity-80">
                          {staffName}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              )}
            </CardContent>
            <CardFooter className="justify-end bg-transparent">
              <Button
                disabled={!selection || busy}
                onClick={async () => {
                  setBusy(true);
                  const [time, staffId] = selection.split("|");
                  const signature = JSON.stringify({
                    date,
                    time,
                    staffId,
                    version: view.version,
                  });
                  if (retry.current?.signature !== signature)
                    retry.current = { signature, key: crypto.randomUUID() };
                  try {
                    await change({
                      key: retry.current.key,
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
                      error instanceof Error
                        ? error.message
                        : "Could not reschedule.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Saving…" : "Confirm new time"}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
