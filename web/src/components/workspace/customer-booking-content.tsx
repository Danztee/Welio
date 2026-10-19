import { Confirm, Notice, Panel } from "@/components/platform/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import type {
  BookingView,
  ChangeInput,
  Slot,
} from "@/lib/domain/bookings/contract";
import { TextLink } from "@/components/ui/text-link";
import {
  ArrowRightIcon,
  CalendarClockIcon,
  CircleCheckIcon,
  CircleXIcon,
  MailIcon,
  PhoneIcon,
  XIcon,
} from "lucide-react";
import { BookingDetails } from "./booking-details";
import { RescheduleBooking } from "./reschedule-booking";

function BookingStatusHeader({ view }: { view: BookingView }) {
  const isConfirmed = view.status === "confirmed";
  const isCancelled = view.status === "cancelled";
  const statusTone = isConfirmed
    ? "success"
    : isCancelled
      ? "danger"
      : "neutral";
  const title =
    view.status === "confirmed"
      ? "Appointment confirmed"
      : view.status === "cancelled"
        ? "Appointment cancelled"
        : view.status === "completed"
          ? "Appointment complete"
          : "Your appointment";

  return (
    <header className="space-y-3">
      <Badge variant="outline" tone={statusTone} className="capitalize">
        {isConfirmed ? (
          <CircleCheckIcon data-icon="inline-start" aria-hidden="true" />
        ) : isCancelled ? (
          <CircleXIcon data-icon="inline-start" aria-hidden="true" />
        ) : null}
        {view.status.replaceAll("_", " ")}
      </Badge>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">
          {view.serviceName} <span aria-hidden="true">·</span> {view.business}
        </p>
      </div>
    </header>
  );
}

function BookingManagement({
  view,
  reschedule,
  cancel,
  onReschedule,
  onCancel,
  onChange,
  loadSlots,
}: {
  view: BookingView;
  reschedule: boolean;
  cancel: boolean;
  onReschedule: (open: boolean) => void;
  onCancel: (open: boolean) => void;
  onChange: (input: ChangeInput) => Promise<void>;
  loadSlots: (date: string) => Promise<Slot[]>;
}) {
  return (
    <>
      {view.canChange ? (
        <div className="flex flex-col gap-3 border-y py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">Need to make a change?</p>
            <p className="text-sm text-muted-foreground">
              Reschedule or cancel this appointment.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onReschedule(true)}>
              <CalendarClockIcon data-icon="inline-start" />
              Reschedule
            </Button>
            <Button variant="destructive" onClick={() => onCancel(true)}>
              <XIcon data-icon="inline-start" />
              Cancel appointment
            </Button>
          </div>
        </div>
      ) : (
        <Notice>
          {view.status === "confirmed"
            ? `This appointment is inside the ${view.cancelHours}-hour change window. Contact the business for help.`
            : "This appointment is closed."}
        </Notice>
      )}
      {reschedule && (
        <RescheduleBooking
          view={view}
          onClose={() => onReschedule(false)}
          loadSlots={loadSlots}
          change={onChange}
        />
      )}
      {cancel && (
        <Confirm
          title="Cancel appointment?"
          label="Cancel appointment"
          variant="destructive"
          onClose={() => onCancel(false)}
          onConfirm={() =>
            onChange({
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

function BookingContactFooter({ view }: { view: BookingView }) {
  const contact = view.contactEmail
    ? { value: view.contactEmail, href: `mailto:${view.contactEmail}` }
    : view.businessPhone
      ? { value: view.businessPhone, href: `tel:${view.businessPhone}` }
      : null;

  return (
    <footer className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        {view.contactEmail ? (
          <MailIcon className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <PhoneIcon className="size-4 shrink-0" aria-hidden="true" />
        )}
        <span className="truncate">
          Questions?{" "}
          {contact ? (
            <a
              className="text-foreground underline-offset-4 hover:underline"
              href={contact.href}
            >
              {contact.value}
            </a>
          ) : (
            "Contact the business for help."
          )}
        </span>
      </p>
      <TextLink
        className="inline-flex items-center gap-1.5 text-sm"
        href={`/book/${view.slug}`}
      >
        Book another service
        <ArrowRightIcon className="size-4" aria-hidden="true" />
      </TextLink>
    </footer>
  );
}

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
      <div
        role="status"
        className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"
      >
        <Spinner aria-hidden="true" />
        Opening your booking…
      </div>
    );

  if (error)
    return (
      <div className="flex flex-col items-start gap-4">
        <Notice error>{error}</Notice>
        <Button variant="outline" onClick={onReload}>
          Try again
        </Button>
      </div>
    );

  if (!view) return null;

  return (
    <div className="flex flex-col gap-6">
      <BookingStatusHeader view={view} />

      <BookingDetails view={view} />
      <BookingManagement
        view={view}
        reschedule={reschedule}
        cancel={cancel}
        onReschedule={onReschedule}
        onCancel={onCancel}
        onChange={change}
        loadSlots={loadSlots}
      />
      <BookingContactFooter view={view} />
    </div>
  );
}
