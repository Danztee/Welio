"use client";
import { Panel } from "@/components/platform/shared";
import type { BookingView } from "@/lib/bookings/contract";
import { formatMoney, formatWhen } from "./booking-format";
export function BookingDetails({ view }: { view: BookingView }) {
  return (
    <Panel title={view.serviceName} description={view.business}>
      <dl className="grid grid-cols-[90px_1fr] gap-4 text-sm">
        <dt>Status</dt>
        <dd className="capitalize">{view.status.replace("_", " ")}</dd>
        <dt>When</dt>
        <dd>
          {formatWhen(view.startsAt, view.timeZone)}
          <p className="text-xs text-muted-foreground">{view.timeZone}</p>
        </dd>
        <dt>Staff</dt>
        <dd>{view.staffName}</dd>
        <dt>Customer</dt>
        <dd>
          {view.name}
          <p className="text-xs">{view.email}</p>
        </dd>
        <dt>Address</dt>
        <dd className="break-words">{view.address}</dd>
        <dt>Price</dt>
        <dd>{formatMoney(view.priceMinor, view.currency)}</dd>
      </dl>
    </Panel>
  );
}
