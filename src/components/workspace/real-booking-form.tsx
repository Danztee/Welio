"use client";
import { bookingAction } from "@/app/dashboard/booking-actions";
import { text } from "@/components/platform/form-utils";
import { Blank } from "@/components/platform/shared";
import type { BookingInput, Catalog, Slot } from "@/lib/bookings/contract";
import { runServerAction } from "@/lib/run-server-action";
import { TextLink } from "@/components/ui/text-link";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { formatWhen } from "./booking-format";
import { RealBookingAvailability } from "./real-booking-availability";
import { RealBookingDetailsForm } from "./real-booking-details-form";
import { RealBookingReview } from "./real-booking-review";
const slotsSchema = z.array(
  z.object({ time: z.string(), staffId: z.uuid(), startsAt: z.iso.datetime() }),
);
const receiptSchema = z.object({ id: z.uuid() });
async function responseData<T extends z.ZodType>(
  response: Response,
  schema: T,
): Promise<z.infer<T>> {
  const value: unknown = await response.json();
  if (!response.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(value);
    throw Error(
      parsed.success
        ? parsed.data.error
        : "Could not complete this request. Try again.",
    );
  }
  return schema.parse(value);
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
      body: JSON.stringify(body),
      cache: "no-store",
    }),
    schema,
  );
}

export function RealBookingForm({
  catalog,
  owner = false,
  onDone,
}: {
  catalog: Catalog;
  owner?: boolean;
  onDone?: (id: string) => void;
}) {
  const [step, setStep] = useState(1),
    [selectedServiceId, setService] = useState(""),
    [selectedDate, setDate] = useState(""),
    [staffId, setStaff] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]),
    [selected, setSelected] = useState("");
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [details, setDetails] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
  });
  const [receipt, setReceipt] = useState("");
  const requestRef = useRef<{ signature: string; key: string } | null>(null);
  const availabilityRequestRef = useRef(0);
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
  async function loadAvailability(
    selection: { serviceId?: string; date?: string; staffId?: string } = {},
  ) {
    const requestedServiceId = selection.serviceId ?? serviceId;
    const requestedDate = selection.date ?? date;
    const requestedStaffId = selection.staffId ?? staffId;
    if (!requestedDate) return;
    const requestVersion = ++availabilityRequestRef.current;
    setBusy(true);
    setAvailabilityError("");
    try {
      const q = new URLSearchParams({
        serviceId: requestedServiceId,
        date: requestedDate,
        ...(requestedStaffId ? { staffId: requestedStaffId } : {}),
      });
      const path = owner
        ? `/api/workspaces/${catalog.id}/availability`
        : `/api/book/${catalog.slug}/availability`;
      const available = await responseData(
        await fetch(`${path}?${q}`, { cache: "no-store" }),
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
      toast.error(message);
    } finally {
      if (requestVersion === availabilityRequestRef.current) setBusy(false);
    }
  }
  function next(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setDetails({
      name: text(f, "name"),
      email: text(f, "email"),
      phone: text(f, "phone"),
      address: text(f, "address"),
    });
    setStep(3);
  }
  async function confirm() {
    if (!service || !choice || busy) return;
    setBusy(true);
    const input = {
      ...details,
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
          bookingAction("book", catalog.id, payload),
        );
        if (!result.ok) throw Error(result.error);
        id = result.id;
      } else {
        id = (await post(`/api/book/${catalog.slug}`, payload, receiptSchema))
          .id;
      }
      setReceipt(id);
      toast.success("Appointment booked.");
      onDone?.(id);
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : "Could not confirm your booking. Please retry.",
      );
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
        />
      )}
      {step === 2 && (
        <RealBookingDetailsForm
          serviceArea={catalog.serviceArea}
          details={details}
          onBack={() => setStep(1)}
          onNext={next}
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
          onBack={() => setStep(2)}
          onConfirm={() => void confirm()}
        />
      )}
    </div>
  );
}
