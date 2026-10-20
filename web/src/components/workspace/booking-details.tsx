"use client";
import type { ReactNode } from "react";
import type { BookingView } from "@/lib/domain/bookings/contract";
import { formatMoney } from "./booking-format";
import { useMemo } from "react";
import {
  BanknoteIcon,
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
      <dl className="flex flex-col gap-4">
        <Detail label="Date and time" icon={CalendarDaysIcon}>
          <span className="block text-sm leading-5 font-semibold sm:text-base">
            {date}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 font-normal text-muted-foreground">
            <Clock3Icon className="size-3.5" aria-hidden="true" />
            <span>{time}</span>
            <span aria-hidden="true">·</span>
            <span>{view.timeZone}</span>
          </span>
        </Detail>
        <Detail label="Total" icon={BanknoteIcon}>
          <span className="text-sm leading-5 font-semibold sm:text-base">
            {formatMoney(view.priceMinor, view.currency)}
          </span>
          <span className="ml-2 font-normal text-muted-foreground">
            {view.durationMinutes} min
          </span>
        </Detail>
        <Detail label="Team member" icon={UserRoundIcon}>
          {view.staffName}
        </Detail>
        <Detail label="Booked for" icon={UserRoundIcon}>
          <span className="block">{view.name}</span>
          <span className="block font-normal text-muted-foreground">
            {view.email}
          </span>
        </Detail>
        <Detail label="Appointment location" icon={MapPinIcon}>
          {view.address}
        </Detail>
      </dl>
    </div>
  );
}
