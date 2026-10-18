import { Confirm, Notice, Panel } from "@/components/platform/shared";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { BookingView, ChangeInput, Slot } from "@/lib/bookings/contract";
import { TextLink } from "@/components/ui/text-link";
import { BookingDetails } from "./booking-details";
import { RescheduleBooking } from "./reschedule-booking";

export function CustomerBookingContent({
  token,
  loaded,
  error,
  view,
  reschedule,
  cancel,
  onReload,
  onReschedule,
  onCancel,
  loadSlots,
  change,
}: {
  token: string;
  loaded: boolean;
  error: string;
  view: BookingView | null;
  reschedule: boolean;
  cancel: boolean;
  onReload: () => void;
  onReschedule: (open: boolean) => void;
  onCancel: (open: boolean) => void;
  loadSlots: (date: string) => Promise<Slot[]>;
  change: (input: ChangeInput) => Promise<void>;
}) {
  if (!token)
    return (
      <Panel title="Check your email">
        <p className="text-sm leading-6 text-muted-foreground">
          For your privacy, appointment details are available only through the
          private management link in your confirmation email. If it hasn’t
          arrived, contact the business.
        </p>
      </Panel>
    );
  if (!loaded || (!view && !error))
    return (
      <div role="status" className="flex items-center gap-2">
        <Spinner aria-hidden="true" />
        Opening your booking…
      </div>
    );
  if (error)
    return (
      <>
        <Notice error>{error}</Notice>
        <Button variant="outline" onClick={onReload}>
          Try again
        </Button>
      </>
    );
  if (!view) return null;
  return (
    <>
      <BookingDetails view={view} />
      {view.canChange ? (
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => onReschedule(true)}>
            Reschedule
          </Button>
          <Button variant="outline" onClick={() => onCancel(true)}>
            Cancel appointment
          </Button>
        </div>
      ) : (
        <Notice>
          {view.status === "confirmed"
            ? `This appointment is inside the ${view.cancelHours}-hour change window. Contact the business for help.`
            : "This appointment is closed."}
        </Notice>
      )}
      <p className="text-sm text-muted-foreground">
        Contact: {view.contactEmail ?? view.businessPhone}
      </p>
      <TextLink className="text-sm" href={`/book/${view.slug}`}>
        Book another service
      </TextLink>
      {reschedule && (
        <RescheduleBooking
          view={view}
          onClose={() => onReschedule(false)}
          loadSlots={loadSlots}
          change={change}
        />
      )}
      {cancel && (
        <Confirm
          title="Cancel appointment?"
          label="Cancel appointment"
          variant="destructive"
          onClose={() => onCancel(false)}
          onConfirm={() =>
            change({
              key: crypto.randomUUID(),
              version: view.version,
              action: "cancel",
            })
          }
        >
          Your slot will become available again and a cancellation email will be
          queued.
        </Confirm>
      )}
    </>
  );
}
