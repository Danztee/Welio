import { Temporal } from "@js-temporal/polyfill";

export function localDate(now: Date, zone: string) {
  return Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .toString();
}

export function plusDays(date: string, days: number) {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

export function instantFor(date: string, time: string, zone: string) {
  const day = Temporal.PlainDate.from(date);
  const clock = Temporal.PlainTime.from(time);

  return new Date(
    Temporal.ZonedDateTime.from(
      {
        timeZone: zone,
        year: day.year,
        month: day.month,
        day: day.day,
        hour: clock.hour,
        minute: clock.minute,
      },
      { disambiguation: "reject" },
    ).epochMilliseconds,
  );
}

export function localTime(instant: Date, zone: string) {
  return Temporal.Instant.fromEpochMilliseconds(instant.getTime())
    .toZonedDateTimeISO(zone)
    .toPlainTime()
    .toString({ smallestUnit: "minute" });
}

export function weekday(date: string) {
  return Temporal.PlainDate.from(date).dayOfWeek % 7;
}

export const minutes = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
