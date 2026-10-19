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
import type { Catalog, Slot } from "@/lib/domain/bookings/contract";
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

const selectedDateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function formatSelectedDate(value: string) {
  if (!value) return "";

  return selectedDateFormatter.format(parseDate(value));
}

function BookingServiceFields({
  catalog,
  owner,
  service,
  serviceId,
  staffId,
  busy,
  onService,
  onStaff,
}: {
  catalog: Catalog;
  owner: boolean;
  service: Catalog["services"][number];
  serviceId: string;
  staffId: string;
  busy: boolean;
  onService: (value: string) => void;
  onStaff: (value: string) => void;
}) {
  const assignedStaff = new Set(service.staffIds);

  return (
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
              .filter((item) => assignedStaff.has(item.id))
              .map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.name}
                </NativeSelectOption>
              ))}
          </NativeSelect>
        </Field>
      )}
    </FieldGroup>
  );
}

function BookingDateCard({
  date,
  firstDay,
  lastDay,
  timeZone,
  onDate,
}: {
  date: string;
  firstDay: Date;
  lastDay: Date;
  timeZone: string;
  onDate: (value: string) => void;
}) {
  const selectedDay = date ? parseDate(date) : undefined;

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Choose a date</CardTitle>
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
          endMonth={lastDay}
          disabled={(value) => value < firstDay || value > lastDay}
          showOutsideDays={false}
          className="w-full"
        />
      </CardContent>
    </Card>
  );
}

function AvailabilityFeedback({
  busy,
  error,
  date,
  loaded,
  hasChoices,
  onRetry,
}: {
  busy: boolean;
  error: string;
  date: string;
  loaded: boolean;
  hasChoices: boolean;
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

  if (loaded && !hasChoices) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        No times are available on this day. Choose another date.
      </p>
    );
  }

  return null;
}

function AvailableSlotList({
  catalog,
  owner,
  choices,
  selected,
  onSelected,
}: {
  catalog: Catalog;
  owner: boolean;
  choices: Slot[];
  selected: string;
  onSelected: (value: string) => void;
}) {
  return (
    <div
      aria-label="Available appointment times"
      className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1"
      role="group"
    >
      {choices.map((slot) => {
        const value = owner ? `${slot.time}|${slot.staffId}` : slot.time;
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
  );
}

function AvailableTimes({
  catalog,
  owner,
  date,
  choices,
  selected,
  loaded,
  busy,
  error,
  hasChoice,
  onSelected,
  onRetry,
  onContinue,
}: {
  catalog: Catalog;
  owner: boolean;
  date: string;
  choices: Slot[];
  selected: string;
  loaded: boolean;
  busy: boolean;
  error: string;
  hasChoice: boolean;
  onSelected: (value: string) => void;
  onRetry: () => void;
  onContinue: () => void;
}) {
  const hasChoices = choices.length > 0;
  const showChoices = !busy && !error && Boolean(date) && hasChoices;

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Available times</CardTitle>
        <CardDescription>
          {date ? formatSelectedDate(date) : "Select a date to see times"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-48 flex-1 flex-col gap-3">
        <AvailabilityFeedback
          busy={busy}
          error={error}
          date={date}
          loaded={loaded}
          hasChoices={hasChoices}
          onRetry={onRetry}
        />
        {showChoices && (
          <AvailableSlotList
            catalog={catalog}
            owner={owner}
            choices={choices}
            selected={selected}
            onSelected={onSelected}
          />
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
  );
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
  const firstDay = parseDate(catalog.today);
  const lastDay = parseDate(catalog.maxDate);

  return (
    <div className="flex flex-col gap-5">
      <BookingServiceFields
        catalog={catalog}
        owner={owner}
        service={service}
        serviceId={serviceId}
        staffId={staffId}
        busy={busy}
        onService={onService}
        onStaff={onStaff}
      />

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.85fr)]">
        <BookingDateCard
          date={date}
          firstDay={firstDay}
          lastDay={lastDay}
          timeZone={catalog.timeZone}
          onDate={onDate}
        />
        <AvailableTimes
          catalog={catalog}
          owner={owner}
          date={date}
          choices={choices}
          selected={selected}
          loaded={loaded}
          busy={busy}
          error={error}
          hasChoice={hasChoice}
          onSelected={onSelected}
          onRetry={onRetry}
          onContinue={onContinue}
        />
      </div>
    </div>
  );
}
