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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import type { Catalog, Slot } from "@/lib/bookings/contract";
import { formatMoney } from "./booking-format";

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

export function RealBookingAvailability({
  catalog,
  owner,
  serviceId,
  date,
  staffId,
  slots,
  selected,
  loaded,
  busy,
  error,
  onService,
  onDate,
  onStaff,
  onSelected,
  onRetry,
  onContinue,
}: {
  catalog: Catalog;
  owner: boolean;
  serviceId: string;
  date: string;
  staffId: string;
  slots: Slot[];
  selected: string;
  loaded: boolean;
  busy: boolean;
  error: string;
  onService: (value: string) => void;
  onDate: (value: string) => void;
  onStaff: (value: string) => void;
  onSelected: (value: string) => void;
  onRetry: () => void;
  onContinue: () => void;
}) {
  const service = catalog.services.find((item) => item.id === serviceId)!;
  const staffIds = new Set(service.staffIds);
  const choices = owner
    ? slots
    : slots.filter(
        (slot, index, all) =>
          all.findIndex((candidate) => candidate.time === slot.time) === index,
      );
  const hasChoice = slots.some((slot) =>
    owner
      ? `${slot.time}|${slot.staffId}` === selected
      : slot.time === selected,
  );
  const selectedDay = date ? parseDate(date) : undefined;
  const firstDay = parseDate(catalog.today);
  const lastDay = parseDate(catalog.maxDate);

  return (
    <div className="flex flex-col gap-5">
      <FieldGroup className={owner ? "grid gap-4 sm:grid-cols-2" : undefined}>
        <Field>
          <FieldLabel htmlFor="real-service">Service</FieldLabel>
          <NativeSelect
            id="real-service"
            disabled={busy}
            value={serviceId}
            onChange={(event) => onService(event.target.value)}
          >
            {catalog.services.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.name} · {formatMoney(item.priceMinor, catalog.currency)} ·{" "}
                {item.durationMinutes} min
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {service.description && (
            <p className="text-xs leading-5 text-muted-foreground">
              {service.description}
            </p>
          )}
        </Field>
        {owner && (
          <Field>
            <FieldLabel htmlFor="real-staff">Team member</FieldLabel>
            <NativeSelect
              id="real-staff"
              disabled={busy}
              value={staffId}
              onChange={(event) => onStaff(event.target.value)}
            >
              <NativeSelectOption value="">Anyone available</NativeSelectOption>
              {catalog.staff
                .filter((item) => staffIds.has(item.id))
                .map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.name}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </Field>
        )}
      </FieldGroup>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.85fr)]">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle>Choose a date</CardTitle>
            <CardDescription>
              Times are shown in {catalog.timeZone}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center px-2">
            <Calendar
              mode="single"
              required
              selected={selectedDay}
              onSelect={(value) => onDate(formatDate(value))}
              defaultMonth={selectedDay ?? firstDay}
              startMonth={firstDay}
              endMonth={lastDay}
              disabled={(value) => value < firstDay || value > lastDay}
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
            {!busy && error && (
              <div className="flex flex-col items-start gap-3">
                <Notice error>{error}</Notice>
                <Button variant="outline" size="sm" onClick={onRetry}>
                  Try again
                </Button>
              </div>
            )}
            {!busy && !error && !date && (
              <p className="py-2 text-sm text-muted-foreground">
                Choose a day on the calendar to check its available times.
              </p>
            )}
            {!busy && !error && date && loaded && slots.length === 0 && (
              <p className="py-2 text-sm text-muted-foreground">
                No times are available on this day. Choose another date.
              </p>
            )}
            {!busy && !error && date && choices.length > 0 && (
              <div
                aria-label="Available appointment times"
                className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1"
                role="group"
              >
                {choices.map((slot) => {
                  const value = owner
                    ? `${slot.time}|${slot.staffId}`
                    : slot.time;
                  const isSelected = selected === value;
                  const staffName = catalog.staff.find(
                    (item) => item.id === slot.staffId,
                  )?.name;
                  return (
                    <Button
                      key={value}
                      type="button"
                      variant={isSelected ? "default" : "outline"}
                      aria-pressed={isSelected}
                      className="h-auto min-h-10 min-w-0 flex-col px-2 py-2 text-center"
                      onClick={() => onSelected(value)}
                    >
                      <span>{slot.time}</span>
                      {owner && staffName && (
                        <span className="max-w-full truncate text-xs font-normal opacity-80">
                          {staffName}
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>
            )}
          </CardContent>
          <CardFooter className="justify-end bg-transparent">
            <Button
              disabled={!hasChoice || busy}
              onClick={onContinue}
              type="button"
            >
              Continue to customer details
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
