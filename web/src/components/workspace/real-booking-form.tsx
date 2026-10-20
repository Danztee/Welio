"use client";
import { createWorkspaceBookingAction } from "@/app/dashboard/booking-actions";
import { text } from "@/components/platform/form-utils";
import { Blank, Notice } from "@/components/platform/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import type {
  BookingInput,
  Catalog,
  Slot,
} from "@/lib/domain/bookings/contract";
import { runServerAction } from "@/lib/run-server-action";
import { TextLink } from "@/components/ui/text-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { toast } from "@/components/ui/toast";
import { z } from "zod";
import { formatWhen } from "./booking-format";
import { RealBookingAvailability } from "./real-booking-availability";
import {
  RealBookingDetailsForm,
  type BookingCustomerDetails,
} from "./real-booking-details-form";
import { RealBookingReview } from "./real-booking-review";
import { BookingLocation } from "@/lib/domain/workspaces/enums";
import { apiUrl } from "@/lib/api-url";
import { fromAPIContract, toAPIContract } from "@/lib/api-contract";

const slotsSchema = z.array(
  z.object({ time: z.string(), staffId: z.uuid(), startsAt: z.iso.datetime() }),
);
const receiptSchema = z.object({ id: z.uuid() });
const waitlistReceiptSchema = z.object({ joined: z.boolean() });
type BookingSelection = { serviceId: string; date: string; staffId: string };

async function responseData<T extends z.ZodType>(
  response: Response,
  schema: T,
): Promise<z.infer<T>> {
  const value: unknown = await response.json();
  if (!response.ok) {
    const parsed = z
      .object({ detail: z.string().optional(), title: z.string().optional() })
      .safeParse(value);
    throw Error(
      parsed.success
        ? (parsed.data.detail ??
            parsed.data.title ??
            "Could not complete this request. Try again.")
        : "Could not complete this request. Try again.",
    );
  }

  return schema.parse(fromAPIContract(value));
}

async function post<T extends z.ZodType>(
  url: string,
  body: unknown,
  schema: T,
) {
  return responseData(
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toAPIContract(body)),
      cache: "no-store",
    }),
    schema,
  );
}

function WaitlistJoinForm({
  catalog,
  selection,
}: {
  catalog: Catalog;
  selection: BookingSelection;
}) {
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || joined) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await post(
        apiUrl(`/v1/book/${catalog.slug}/waitlist`),
        {
          serviceId: selection.serviceId,
          requestDate: selection.date,
          ...(selection.staffId ? { staffId: selection.staffId } : {}),
          name: text(form, "name"),
          email: text(form, "email"),
        },
        waitlistReceiptSchema,
      );
      setJoined(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not join the waitlist.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-4 p-4">
      <CardHeader className="p-0">
        <CardTitle className="text-base">Join the waitlist</CardTitle>
        <CardDescription>
          We’ll email you if a time opens on this date. The email will link back
          here to book; it does not reserve a time.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-0">
        {joined ? (
          <Notice tone="success">
            You’re on the waitlist. Check your email if a time opens.
          </Notice>
        ) : (
          <form onSubmit={(event) => void join(event)}>
            <FieldGroup className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="waitlist-name">Name</FieldLabel>
                <Input
                  id="waitlist-name"
                  name="name"
                  autoComplete="name"
                  maxLength={100}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="waitlist-email">Email</FieldLabel>
                <Input
                  id="waitlist-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                />
              </Field>
              {error && (
                <div className="sm:col-span-2">
                  <Notice error>{error}</Notice>
                </div>
              )}
              <Button
                type="submit"
                disabled={busy}
                className="sm:col-span-2 sm:justify-self-start"
              >
                {busy ? "Joining…" : "Notify me if a time opens"}
              </Button>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function RealBookingForm({
  catalog,
  owner = false,
  onDone,
  initialSelection,
}: {
  catalog: Catalog;
  owner?: boolean;
  onDone?: (id: string) => void;
  initialSelection?: BookingSelection;
}) {
  const [step, setStep] = useState(1),
    [selectedServiceId, setService] = useState(
      initialSelection?.serviceId ?? "",
    ),
    [selectedDate, setDate] = useState(initialSelection?.date ?? ""),
    [staffId, setStaff] = useState(initialSelection?.staffId ?? "");
  const [slots, setSlots] = useState<Slot[]>([]),
    [selected, setSelected] = useState("");
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [details, setDetails] = useState<BookingCustomerDetails>({
    name: "",
    email: "",
    phone: "",
    address: "",
    serviceLocation:
      catalog.bookingLocation === BookingLocation.Both
        ? ""
        : catalog.bookingLocation,
  });
  const [receipt, setReceipt] = useState("");
  const requestRef = useRef<{ signature: string; key: string } | null>(null);
  const availabilityRequestRef = useRef(0);
  const initialLoadDone = useRef(false);
  const serviceId = selectedServiceId || catalog.services[0]?.id || "";
  const date = selectedDate;
  const service = catalog.services.find((s) => s.id === serviceId);
  const choice = slots.find((s) =>
    owner ? `${s.time}|${s.staffId}` === selected : s.time === selected,
  );

  function resetSlots() {
    availabilityRequestRef.current += 1;
    setSlots([]);
    setSelected("");
    setLoaded(false);
    setAvailabilityError("");
    setBusy(false);
  }

  const loadAvailability = useCallback(
    async (
      selection: { serviceId?: string; date?: string; staffId?: string } = {},
    ) => {
      const requestedServiceId = selection.serviceId ?? serviceId;
      const requestedDate = selection.date ?? date;
      const requestedStaffId = selection.staffId ?? staffId;
      if (!requestedDate) return;

      const requestVersion = ++availabilityRequestRef.current;
      setBusy(true);
      setAvailabilityError("");
      try {
        const q = new URLSearchParams({
          service_id: requestedServiceId,
          date: requestedDate,
          ...(requestedStaffId ? { staff_id: requestedStaffId } : {}),
        });
        const path = owner
          ? `/v1/workspaces/${catalog.id}/availability`
          : `/v1/book/${catalog.slug}/availability`;
        const available = await responseData(
          await fetch(apiUrl(`${path}?${q}`), {
            cache: "no-store",
            credentials: owner ? "include" : "omit",
          }),
          slotsSchema,
        );
        if (requestVersion !== availabilityRequestRef.current) return;

        setSlots(available);
        setLoaded(true);
        setSelected("");
      } catch (e) {
        if (requestVersion !== availabilityRequestRef.current) return;

        const message =
          e instanceof Error ? e.message : "Could not load availability.";
        setAvailabilityError(message);
        toast.add({ title: message, type: "error" });
      } finally {
        if (requestVersion === availabilityRequestRef.current) setBusy(false);
      }
    },
    [serviceId, date, staffId, owner, catalog.id, catalog.slug],
  );

  useEffect(() => {
    if (initialLoadDone.current || !initialSelection?.date) return;
    initialLoadDone.current = true;
    void loadAvailability(initialSelection);
  }, [initialSelection, loadAvailability]);

  function next(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setDetails({
      name: text(f, "name"),
      email: text(f, "email"),
      phone: text(f, "phone"),
      address: text(f, "address"),
      serviceLocation:
        catalog.bookingLocation === BookingLocation.Both
          ? (text(
              f,
              "serviceLocation",
            ) as BookingCustomerDetails["serviceLocation"])
          : catalog.bookingLocation,
    });
    setStep(3);
  }

  async function confirm() {
    if (!service || !choice || busy || !details.serviceLocation) return;

    setBusy(true);
    const input = {
      name: details.name,
      email: details.email,
      phone: details.phone,
      serviceLocation: details.serviceLocation,
      ...(details.serviceLocation === BookingLocation.CustomerAddress
        ? { address: details.address }
        : {}),
      serviceId: service.id,
      staffId: choice.staffId,
      date,
      time: choice.time,
      quote: service.quote,
      consent: true as const,
    };
    const signature = JSON.stringify(input);
    if (requestRef.current?.signature !== signature)
      requestRef.current = { signature, key: crypto.randomUUID() };

    const payload: BookingInput = { ...input, key: requestRef.current.key };
    try {
      let id: string;
      if (owner) {
        const result = await runServerAction(() =>
          createWorkspaceBookingAction(catalog.id, payload),
        );
        if (!result.ok) throw Error(result.error);

        id = result.id;
      } else {
        id = (
          await post(apiUrl(`/v1/book/${catalog.slug}`), payload, receiptSchema)
        ).id;
      }

      setReceipt(id);
      toast.add({ title: "Appointment booked.", type: "success" });
      onDone?.(id);
    } catch (e) {
      toast.add({
        title:
          e instanceof Error
            ? e.message
            : "Could not confirm your booking. Please retry.",
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  if (receipt)
    return (
      <div className="flex flex-col gap-5">
        <h2 className="text-lg font-medium">Appointment confirmed</h2>
        <p className="text-sm text-muted-foreground">
          Its details and private management link will be sent to{" "}
          {details.email}.
        </p>
        <p className="text-sm">
          {service?.name} ·{" "}
          {choice && formatWhen(choice.startsAt, catalog.timeZone)} ·{" "}
          {catalog.timeZone}
        </p>
        <p className="text-xs text-muted-foreground">
          Reference: {receipt}. If email delivery is delayed, contact{" "}
          {catalog.contactEmail ?? catalog.phone}.
        </p>
        <TextLink className="text-sm" href={`/booking/${receipt}`}>
          Booking help
        </TextLink>
      </div>
    );

  if (!service)
    return (
      <Blank
        title="No services available"
        description="Please contact the business for help."
      />
    );

  return (
    <BookingSteps
      catalog={catalog}
      owner={owner}
      serviceId={serviceId}
      date={date}
      staffId={staffId}
      slots={slots}
      selected={selected}
      loaded={loaded}
      busy={busy}
      availabilityError={availabilityError}
      step={step}
      choice={choice}
      details={details}
      onService={(value) => {
        setService(value);
        setStaff("");
        resetSlots();
        if (date) void loadAvailability({ serviceId: value, staffId: "" });
      }}
      onDate={(value) => {
        setDate(value);
        resetSlots();
        void loadAvailability({ date: value });
      }}
      onStaff={(value) => {
        setStaff(value);
        resetSlots();
        if (date) void loadAvailability({ staffId: value });
      }}
      onSelected={setSelected}
      onRetry={() => void loadAvailability()}
      onContinue={() => setStep(2)}
      onBackToAvailability={() => setStep(1)}
      onNext={next}
      onBackToDetails={() => setStep(2)}
      onConfirm={() => void confirm()}
    />
  );
}

function BookingSteps({
  catalog,
  owner,
  serviceId,
  date,
  staffId,
  slots,
  selected,
  loaded,
  busy,
  availabilityError,
  step,
  choice,
  details,
  onService,
  onDate,
  onStaff,
  onSelected,
  onRetry,
  onContinue,
  onBackToAvailability,
  onNext,
  onBackToDetails,
  onConfirm,
}: {
  catalog: Catalog;
  owner: boolean;
  serviceId: string;
  date: string;
  staffId: string;
  slots: Slot[];
  selected: string;
  loaded: boolean;
  busy: boolean;
  availabilityError: string;
  step: number;
  choice: Slot | undefined;
  details: BookingCustomerDetails;
  onService: (value: string) => void;
  onDate: (value: string) => void;
  onStaff: (value: string) => void;
  onSelected: (value: string) => void;
  onRetry: () => void;
  onContinue: () => void;
  onBackToAvailability: () => void;
  onNext: (event: FormEvent<HTMLFormElement>) => void;
  onBackToDetails: () => void;
  onConfirm: () => void;
}) {
  const showWaitlist =
    step === 1 &&
    !owner &&
    loaded &&
    !busy &&
    !availabilityError &&
    slots.length === 0 &&
    Boolean(date);

  return (
    <div className="flex flex-col gap-5">
      {step === 1 && (
        <RealBookingAvailability
          catalog={catalog}
          owner={owner}
          serviceId={serviceId}
          date={date}
          staffId={staffId}
          slots={slots}
          selected={selected}
          loaded={loaded}
          busy={busy}
          error={availabilityError}
          onService={onService}
          onDate={onDate}
          onStaff={onStaff}
          onSelected={onSelected}
          onRetry={onRetry}
          onContinue={onContinue}
        />
      )}
      {showWaitlist && (
        <WaitlistJoinForm
          key={`${serviceId}:${date}:${staffId}`}
          catalog={catalog}
          selection={{ serviceId, date, staffId }}
        />
      )}
      {step === 2 && (
        <RealBookingDetailsForm
          serviceArea={catalog.serviceArea}
          businessAddress={catalog.businessAddress}
          bookingLocation={catalog.bookingLocation}
          details={details}
          onBack={onBackToAvailability}
          onNext={onNext}
        />
      )}
      {step === 3 && choice && (
        <RealBookingReview
          catalog={catalog}
          serviceId={serviceId}
          choice={choice}
          details={details}
          owner={owner}
          busy={busy}
          onBack={onBackToDetails}
          onConfirm={onConfirm}
        />
      )}
    </div>
  );
}
