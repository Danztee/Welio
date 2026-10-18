import { BookingError } from "./errors";
import { instantFor, localDate, plusDays, weekday } from "./time";
import type { Slot } from "./contract";

type WorkspaceAvailabilityRules = {
  timeZone: string;
  horizonDays: number;
  leadHours: number;
  slotMinutes: number;
};

type ServiceDuration = {
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
};

type WorkerAvailability = {
  id: string;
  schedule: {
    start: string;
    end: string;
    breakStart: string;
    breakEnd: string;
    days: number[];
  };
};

type TimeOff = { staffId: string };

type OccupiedAppointment = {
  id: string;
  staffId: string;
  startsAt: Date;
  endsAt: Date;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
};

export function findAvailableSlots({
  workspace,
  service,
  date,
  staffId,
  excludeAppointmentId,
  now,
  workers,
  timeOff,
  appointments,
}: {
  workspace: WorkspaceAvailabilityRules;
  service: ServiceDuration;
  date: string;
  staffId?: string;
  excludeAppointmentId: string;
  now: Date;
  workers: WorkerAvailability[];
  timeOff: TimeOff[];
  appointments: OccupiedAppointment[];
}): Slot[] {
  const today = localDate(now, workspace.timeZone);
  if (date < today || date > plusDays(today, workspace.horizonDays))
    throw new BookingError(
      "Choose a date within the booking window.",
      "invalid",
    );

  const result: Slot[] = [];
  for (let minute = 0; minute < 1440; minute += workspace.slotMinutes) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    let start: Date;
    try {
      start = instantFor(date, time, workspace.timeZone);
    } catch {
      continue;
    }

    if (start.getTime() < now.getTime() + workspace.leadHours * 3_600_000)
      continue;

    const occupiedFrom = new Date(
      start.getTime() - service.bufferBeforeMinutes * 60_000,
    );
    const occupiedTo = new Date(
      start.getTime() +
        (service.durationMinutes + service.bufferAfterMinutes) * 60_000,
    );

    for (const worker of workers) {
      const schedule = worker.schedule;
      if (
        (staffId && worker.id !== staffId) ||
        !schedule.days.includes(weekday(date)) ||
        timeOff.some((leave) => leave.staffId === worker.id)
      )
        continue;

      let opens: Date;
      let closes: Date;
      try {
        opens = instantFor(date, schedule.start, workspace.timeZone);
        closes = instantFor(date, schedule.end, workspace.timeZone);
      } catch {
        continue;
      }

      if (occupiedFrom < opens || occupiedTo > closes) continue;

      if (schedule.breakStart && schedule.breakEnd) {
        try {
          const breakStart = instantFor(
            date,
            schedule.breakStart,
            workspace.timeZone,
          );
          const breakEnd = instantFor(
            date,
            schedule.breakEnd,
            workspace.timeZone,
          );
          if (occupiedFrom < breakEnd && occupiedTo > breakStart) continue;
        } catch {
          continue;
        }
      }

      const overlapsAppointment = appointments.some(
        (appointment) =>
          appointment.id !== excludeAppointmentId &&
          appointment.staffId === worker.id &&
          occupiedFrom.getTime() <
            appointment.endsAt.getTime() +
              appointment.bufferAfterMinutes * 60_000 &&
          occupiedTo.getTime() >
            appointment.startsAt.getTime() -
              appointment.bufferBeforeMinutes * 60_000,
      );
      if (overlapsAppointment) continue;

      result.push({
        time,
        staffId: worker.id,
        startsAt: start.toISOString(),
      });
    }
  }

  return result;
}
