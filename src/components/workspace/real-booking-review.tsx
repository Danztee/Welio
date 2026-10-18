import { Panel } from "@/components/platform/shared";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import type { Catalog, Slot } from "@/lib/bookings/contract";
import { formatMoney, formatWhen } from "./booking-format";
import type { BookingCustomerDetails } from "./real-booking-details-form";

export function RealBookingReview({
  catalog,
  serviceId,
  choice,
  details,
  owner,
  busy,
  onBack,
  onConfirm,
}: {
  catalog: Catalog;
  serviceId: string;
  choice: Slot;
  details: BookingCustomerDetails;
  owner: boolean;
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const service = catalog.services.find((item) => item.id === serviceId)!;
  return (
    <>
      <Panel title="Appointment summary">
        <dl className="grid grid-cols-[90px_1fr] gap-4 text-sm">
          <dt>Service</dt>
          <dd>
            {service.name} · {service.durationMinutes} min
          </dd>
          <dt>When</dt>
          <dd>
            {formatWhen(choice.startsAt, catalog.timeZone)}
            <p className="text-xs text-muted-foreground">{catalog.timeZone}</p>
          </dd>
          {owner && (
            <>
              <dt>Staff</dt>
              <dd>
                {catalog.staff.find((item) => item.id === choice.staffId)?.name}
              </dd>
            </>
          )}
          <dt>Customer</dt>
          <dd>
            {details.name}
            <p className="text-xs">{details.email}</p>
          </dd>
          <dt>Address</dt>
          <dd className="break-words">{details.address}</dd>
          <dt>Price</dt>
          <dd>{formatMoney(service.priceMinor, catalog.currency)}</dd>
        </dl>
      </Panel>
      <p className="text-xs leading-5 text-muted-foreground">
        Changes and cancellations require {catalog.cancelHours} hours’ notice.
        No payment is collected during booking.
      </p>
      <DialogFooter className="justify-between">
        <Button disabled={busy} variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button disabled={busy} onClick={onConfirm}>
          {busy ? "Confirming…" : "Confirm booking"}
        </Button>
      </DialogFooter>
    </>
  );
}
