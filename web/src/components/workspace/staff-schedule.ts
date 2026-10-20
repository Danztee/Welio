export const staffWeek = [
  { short: "Sun", long: "Sunday", value: 0 },
  { short: "Mon", long: "Monday", value: 1 },
  { short: "Tue", long: "Tuesday", value: 2 },
  { short: "Wed", long: "Wednesday", value: 3 },
  { short: "Thu", long: "Thursday", value: 4 },
  { short: "Fri", long: "Friday", value: 5 },
  { short: "Sat", long: "Saturday", value: 6 },
];

function summarizeDays(days: number[]) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return "every day";

  if (sorted.join(",") === "1,2,3,4,5") return "weekdays";

  if (sorted.join(",") === "0,6") return "weekends";

  return sorted
    .map((day) => staffWeek[day]?.short)
    .filter(Boolean)
    .join(", ");
}

export function scheduleAvailabilityMessage({
  isActive,
  days,
  start,
  end,
  breakStart,
  breakEnd,
}: {
  isActive: boolean;
  days: number[];
  start: string;
  end: string;
  breakStart: string;
  breakEnd: string;
}) {
  if (!isActive) return "Inactive team members do not receive booking slots.";

  if (!days.length)
    return "Select at least one day before this person can receive booking slots.";

  if (start >= end) return "End time must be later than the start time.";

  const breakText =
    breakStart && breakEnd
      ? `; break ${breakStart}–${breakEnd} excluded`
      : breakStart || breakEnd
        ? "; finish or clear both break times"
        : "";

  return `For assigned services, customers can book this person on ${summarizeDays(days)}, ${start}–${end}${breakText}. Time off and existing bookings block slots.`;
}
