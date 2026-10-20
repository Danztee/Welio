"use client";
import type { ReactNode } from "react";
import type { BookingView } from "@/lib/domain/bookings/contract";
import { formatMoney } from "./booking-format";
import { useMemo } from "react";
import {
  CalendarDaysIcon,
  Clock3Icon,
  MapPinIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";

function Detail({
  label,
  children,
  icon: Icon,
}: {
  label: string;
  children: ReactNode;
  icon: LucideIcon;
}) {
  return (
    <div className="flex min-w-0 gap-3">
      <Icon
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm font-medium break-words">{children}</dd>
      </div>
    </div>
  );
}

export function BookingDetails({ view }: { view: BookingView }) {
  const { date, time } = useMemo(() => {
    const startsAt = new Date(view.startsAt);

    return {
      date: new Intl.DateTimeFormat("en-GB", {
        timeZone: view.timeZone,
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(startsAt),
      time: new Intl.DateTimeFormat("en-GB", {
        timeZone: view.timeZone,
        hour: "numeric",
        minute: "2-digit",
      }).format(startsAt),
    };
  }, [view.startsAt, view.timeZone]);

  return (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-4 border-b pb-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CalendarDaysIcon className="size-4" aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              Date and time
            </p>
            <p className="text-sm leading-5 font-semibold sm:text-base">
              {date}
            </p>
            <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              <Clock3Icon className="size-3.5" aria-hidden="true" />
              <span>{time}</span>
              <span aria-hidden="true">·</span>
              <span>{view.timeZone}</span>
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-base leading-5 font-semibold">
            {formatMoney(view.priceMinor, view.currency)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {view.durationMinutes} min
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-5 pt-4 sm:gap-x-6">
        <Detail label="Team member" icon={UserRoundIcon}>
          {view.staffName}
        </Detail>
        <Detail label="Booked for" icon={UserRoundIcon}>
          <span className="block">{view.name}</span>
          <span className="block font-normal text-muted-foreground">
            {view.email}
          </span>
        </Detail>
        <div className="col-span-2">
          <Detail label="Appointment location" icon={MapPinIcon}>
            {view.address}
          </Detail>
        </div>
      </dl>
    </div>
  );
}
