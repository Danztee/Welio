"use client";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
      <div className="min-w-0 space-y-1">
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
        weekday: "long",
        day: "numeric",
        month: "long",
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
    <Card className="gap-0 border-border py-0">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarDaysIcon className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Date and time
              </p>
              <p className="text-base leading-6 font-semibold">{date}</p>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock3Icon className="size-3.5" aria-hidden="true" />
                {time} <span aria-hidden="true">·</span> {view.timeZone}
              </p>
            </div>
          </div>
          <div className="border-t pt-4 sm:border-0 sm:pt-0 sm:text-right">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-semibold">
              {formatMoney(view.priceMinor, view.currency)}
            </p>
            <p className="text-sm text-muted-foreground">
              {view.durationMinutes} minutes
            </p>
          </div>
        </div>
      </CardContent>
      <Separator />
      <CardContent className="p-5 sm:p-6">
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
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
      </CardContent>
    </Card>
  );
}
