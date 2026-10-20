"use client";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Spinner } from "@/components/ui/spinner";
import type { AppointmentCalendarItem as APIAppointmentCalendarItem } from "@/lib/backend/generated/types.gen";
import type { CamelFields } from "@/lib/backend/contract";
import { fromAPIContract } from "@/lib/api-contract";
import { apiUrl } from "@/lib/api-url";
import { Temporal } from "@js-temporal/polyfill";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";

type CalendarAppointment = CamelFields<APIAppointmentCalendarItem>;

const calendarResponseSchema = z.object({
  appointments: z
    .array(
      z.object({
        id: z.uuid(),
        status: z.string(),
        startsAt: z.iso.datetime({ offset: true }),
        endsAt: z.iso.datetime({ offset: true }),
        customerName: z.string(),
        serviceName: z.string(),
        staffName: z.string(),
      }),
    )
    .nullable(),
});

const errorSchema = z.object({
  detail: z.string().optional(),
  title: z.string().optional(),
});

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function visibleMonth(month: string) {
  const yearMonth = Temporal.PlainYearMonth.from(month);
  const firstDay = yearMonth.toPlainDate({ day: 1 });
  const start = firstDay.subtract({ days: firstDay.dayOfWeek % 7 });
  const weekCount = Math.ceil(
    ((firstDay.dayOfWeek % 7) + yearMonth.daysInMonth) / 7,
  );
  const days = Array.from({ length: weekCount * 7 }, (_, index) =>
    start.add({ days: index }),
  );

  return {
    days,
    from: days[0].toString(),
    to: days[days.length - 1].toString(),
    monthStart: firstDay.toString(),
    monthEnd: yearMonth.toPlainDate({ day: yearMonth.daysInMonth }).toString(),
  };
}

function currentMonth(now: string, timeZone: string) {
  return Temporal.Instant.from(now)
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toPlainYearMonth()
    .toString();
}

function eventDate(startsAt: string, timeZone: string) {
  return Temporal.Instant.from(startsAt)
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();
}

function formatEventTime(startsAt: string, timeZone: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(startsAt));
}

function formatMonth(month: string) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00.000Z`));
}

function formatAgendaDate(date: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const instant = Temporal.PlainDate.from({ year, month, day })
    .toZonedDateTime({ timeZone, plainTime: "12:00" })
    .toInstant();
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(new Date(instant.epochMilliseconds));
}

function eventTone(status: string) {
  switch (status) {
    case "confirmed":
      return "border-primary/20 bg-primary/5 text-primary hover:bg-primary/10";
    case "completed":
      return "border-success-border bg-success-surface text-success-foreground hover:brightness-95";
    case "cancelled":
      return "border-danger-border bg-danger-surface text-danger-foreground hover:brightness-95";
    case "no_show":
      return "border-warning-border bg-warning-surface text-warning-foreground hover:brightness-95";
    default:
      return "border-border bg-muted text-muted-foreground hover:bg-muted/80";
  }
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

export function AppointmentCalendar({
  workspaceId,
  timeZone,
  now,
  active,
  search,
  status,
  filterFrom,
  filterTo,
  refreshKey,
  onSelect,
}: {
  workspaceId: string;
  timeZone: string;
  now: string;
  active: boolean;
  search: string;
  status: string;
  filterFrom: string;
  filterTo: string;
  refreshKey: number;
  onSelect: (appointmentId: string) => void;
}) {
  const [month, setMonth] = useState(() => currentMonth(now, timeZone));
  const [requestKey, setRequestKey] = useState(0);
  const [loadedResponse, setLoadedResponse] = useState<{
    key: string;
    appointments: CalendarAppointment[];
    error: string;
  } | null>(null);
  const [selectedDate, setSelectedDate] = useState(() =>
    Temporal.Instant.from(now)
      .toZonedDateTimeISO(timeZone)
      .toPlainDate()
      .toString(),
  );
  const [agendaOpen, setAgendaOpen] = useState(false);

  const range = visibleMonth(month);
  const from = filterFrom && filterFrom > range.from ? filterFrom : range.from;
  const to = filterTo && filterTo < range.to ? filterTo : range.to;
  const hasDateRange = from <= to;
  const normalizedSearch = search.trim();
  const requestSignature = JSON.stringify([
    active,
    workspaceId,
    month,
    from,
    to,
    normalizedSearch,
    status,
    refreshKey,
    requestKey,
  ]);
  const responseIsCurrent = loadedResponse?.key === requestSignature;
  const appointments =
    active && hasDateRange && responseIsCurrent
      ? (loadedResponse?.appointments ?? [])
      : [];
  const loading = active && hasDateRange && !responseIsCurrent;
  const error = responseIsCurrent ? (loadedResponse?.error ?? "") : "";
  const daysByDate = new Map<string, CalendarAppointment[]>();
  for (const appointment of appointments) {
    const date = eventDate(appointment.startsAt, timeZone);
    const day = daysByDate.get(date) ?? [];
    day.push(appointment);
    daysByDate.set(date, day);
  }
  const selectedAppointments = daysByDate.get(selectedDate) ?? [];

  useEffect(() => {
    if (!active || !hasDateRange) return;

    const controller = new AbortController();
    const query = new URLSearchParams({ from, to });
    if (normalizedSearch) query.set("search", normalizedSearch);
    if (status) query.set("status", status);

    void fetch(
      apiUrl(
        `/v1/workspaces/${workspaceId}/appointments/calendar?${query.toString()}`,
      ),
      {
        cache: "no-store",
        credentials: "include",
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) {
          const parsedError = errorSchema.safeParse(payload);
          throw Error(
            parsedError.success
              ? (parsedError.data.detail ??
                  parsedError.data.title ??
                  "Could not load appointments.")
              : "Could not load appointments.",
          );
        }
        return calendarResponseSchema.parse(fromAPIContract(payload));
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        setLoadedResponse({
          key: requestSignature,
          appointments: (result.appointments ?? []) as CalendarAppointment[],
          error: "",
        });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoadedResponse({
          key: requestSignature,
          appointments: [],
          error:
            cause instanceof Error
              ? cause.message
              : "Could not load appointments.",
        });
      });

    return () => controller.abort();
  }, [
    active,
    from,
    hasDateRange,
    requestSignature,
    normalizedSearch,
    workspaceId,
    status,
    to,
  ]);

  function changeMonth(nextMonth: string) {
    setMonth(nextMonth);
    setAgendaOpen(false);
    setSelectedDate(
      Temporal.PlainYearMonth.from(nextMonth)
        .toPlainDate({ day: 1 })
        .toString(),
    );
  }

  function retry() {
    setRequestKey((value) => value + 1);
  }

  const weeks = Array.from({ length: range.days.length / 7 }, (_, index) =>
    range.days.slice(index * 7, index * 7 + 7),
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-3 sm:px-4">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous month"
            onClick={() =>
              changeMonth(
                Temporal.PlainYearMonth.from(month)
                  .subtract({ months: 1 })
                  .toString(),
              )
            }
          >
            <ChevronLeftIcon />
          </Button>
          <h2 className="min-w-36 text-center text-sm font-semibold sm:text-base">
            {formatMonth(month)}
          </h2>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next month"
            onClick={() =>
              changeMonth(
                Temporal.PlainYearMonth.from(month)
                  .add({ months: 1 })
                  .toString(),
              )
            }
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <span
              className="flex items-center gap-2 text-xs text-muted-foreground"
              role="status"
            >
              <Spinner aria-hidden="true" />
              Loading appointments
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const today = Temporal.Instant.from(now)
                .toZonedDateTimeISO(timeZone)
                .toPlainDate();
              changeMonth(today.toPlainYearMonth().toString());
              setSelectedDate(today.toString());
              setAgendaOpen(false);
            }}
          >
            Today
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <Table
            className="table-fixed"
            aria-label={`Appointments for ${formatMonth(month)}`}
          >
            <TableHeader>
              <TableRow>
                {weekdayNames.map((weekday) => (
                  <TableHead
                    key={weekday}
                    className="h-10 px-1 text-center text-[11px] sm:px-2 sm:text-xs"
                  >
                    <span className="sm:hidden">{weekday.slice(0, 1)}</span>
                    <span className="hidden sm:inline">{weekday}</span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {weeks.map((week) => (
                <TableRow
                  key={week[0].toString()}
                  className="hover:bg-transparent"
                >
                  {week.map((date) => {
                    const key = date.toString();
                    const events = daysByDate.get(key) ?? [];
                    const inMonth =
                      key >= range.monthStart && key <= range.monthEnd;
                    const isSelected = key === selectedDate;
                    const visibleEvents = events.slice(0, 3);

                    return (
                      <TableCell
                        key={key}
                        className="h-auto min-w-0 border-r p-1 align-top whitespace-normal last:border-r-0 sm:p-1.5"
                      >
                        <div className="min-h-12 sm:min-h-24">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDate(key);
                              setAgendaOpen(true);
                            }}
                            aria-pressed={isSelected}
                            aria-label={`${formatAgendaDate(key, timeZone)}${events.length ? `, ${events.length} appointments` : ""}`}
                            className={`mb-1 flex size-6 items-center justify-center rounded-full text-xs tabular-nums transition-colors ${
                              isSelected
                                ? "bg-primary text-primary-foreground"
                                : inMonth
                                  ? "text-foreground hover:bg-muted"
                                  : "text-muted-foreground/60 hover:bg-muted"
                            }`}
                          >
                            {date.day}
                          </button>
                          <div className="hidden space-y-1 sm:block">
                            {visibleEvents.map((appointment) => (
                              <button
                                key={appointment.id}
                                type="button"
                                onClick={() => onSelect(appointment.id)}
                                title={`${formatEventTime(appointment.startsAt, timeZone)} · ${appointment.customerName || "Customer"} · ${appointment.serviceName} · ${formatStatus(appointment.status)}`}
                                className={`flex w-full min-w-0 flex-col items-start rounded-md border px-1.5 py-1 text-left text-[11px] leading-4 transition-colors ${eventTone(appointment.status)}`}
                              >
                                <span className="w-full truncate font-medium tabular-nums">
                                  {formatEventTime(
                                    appointment.startsAt,
                                    timeZone,
                                  )}
                                  {" · "}
                                  {appointment.customerName || "Customer"}
                                </span>
                                <span className="hidden w-full truncate opacity-75 lg:block">
                                  {appointment.serviceName}
                                </span>
                              </button>
                            ))}
                            {events.length > visibleEvents.length && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedDate(key);
                                  setAgendaOpen(true);
                                }}
                                className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                              >
                                +{events.length - visibleEvents.length} more
                              </button>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-0.5 sm:hidden">
                            {events.slice(0, 4).map((appointment) => (
                              <button
                                key={appointment.id}
                                type="button"
                                onClick={() => onSelect(appointment.id)}
                                title={`${formatEventTime(appointment.startsAt, timeZone)} · ${appointment.customerName || "Customer"} · ${appointment.serviceName}`}
                                aria-label={`${formatEventTime(appointment.startsAt, timeZone)} appointment for ${appointment.customerName || "Customer"}`}
                                className={`size-2.5 rounded-full border ${eventTone(appointment.status)}`}
                              />
                            ))}
                            {events.length > 4 && (
                              <span className="text-[9px] leading-3 text-muted-foreground">
                                +{events.length - 4}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {!loading && appointments.length === 0 && (
            <div className="border-t px-4 py-3 text-center text-xs text-muted-foreground">
              No appointments in this date range.
            </div>
          )}

          <section
            className={`border-t p-4 ${agendaOpen ? "" : "sm:hidden"}`}
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">
                {formatAgendaDate(selectedDate, timeZone)}
              </h3>
              {agendaOpen && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAgendaOpen(false)}
                >
                  Close day
                </Button>
              )}
            </div>
            {selectedAppointments.length ? (
              <ul className="mt-3 space-y-2">
                {selectedAppointments.map((appointment) => (
                  <li key={appointment.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(appointment.id)}
                      className={`flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left text-sm ${eventTone(appointment.status)}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {appointment.customerName || "Customer"}
                        </span>
                        <span className="mt-0.5 block truncate text-xs opacity-75">
                          {appointment.serviceName} · {appointment.staffName}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums">
                        {formatEventTime(appointment.startsAt, timeZone)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                No appointments on this day.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
