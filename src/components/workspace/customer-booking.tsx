"use client";
import type { BookingView, ChangeInput } from "@/lib/bookings/contract";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { z } from "zod";
import { BookingShell } from "./booking-shell";
import { CustomerBookingContent } from "./customer-booking-content";
const slotsSchema = z.array(
  z.object({ time: z.string(), staffId: z.uuid(), startsAt: z.iso.datetime() }),
);
const receiptSchema = z.object({ id: z.uuid() });
const viewSchema = z.object({
  workspaceId: z.uuid(),
  id: z.uuid(),
  version: z.number(),
  status: z.string(),
  serviceId: z.uuid(),
  staffId: z.uuid(),
  serviceName: z.string(),
  staffName: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  timeZone: z.string(),
  priceMinor: z.number(),
  currency: z.string(),
  durationMinutes: z.number(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  address: z.string(),
  business: z.string(),
  contactEmail: z.string().nullable(),
  businessPhone: z.string(),
  canChange: z.boolean(),
  cancelHours: z.number(),
  slug: z.string(),
});
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

const subscribeHash = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
};
export function CustomerBooking({ id }: { id: string }) {
  const token = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.slice(1),
    () => "",
  );
  const [loadedToken, setLoadedToken] = useState("");
  const [view, setView] = useState<BookingView | null>(null),
    [error, setError] = useState(""),
    [reschedule, setReschedule] = useState(false),
    [cancel, setCancel] = useState(false);
  const loadVersion = useRef(0);
  const reload = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const value = await post(
        `/api/bookings/${id}`,
        { token, action: "view" },
        viewSchema,
      );
      if (version !== loadVersion.current) return;
      setView(value);
      setLoadedToken(token);
      setError("");
    } catch (e) {
      if (version !== loadVersion.current) return;
      setLoadedToken(token);
      setError(e instanceof Error ? e.message : "Could not open booking.");
    }
  }, [id, token]);
  useEffect(() => {
    if (!token) return;
    const timer = window.setTimeout(() => void reload(), 0);
    return () => {
      window.clearTimeout(timer);
      loadVersion.current += 1;
    };
  }, [token, reload]);
  async function change(input: ChangeInput) {
    await post(`/api/bookings/${id}`, { ...input, token }, receiptSchema);
    await reload();
  }
  return (
    <BookingShell>
      <h1 className="text-2xl font-medium">Your appointment</h1>
      <CustomerBookingContent
        token={token}
        loaded={loadedToken === token}
        error={error}
        view={view}
        reschedule={reschedule}
        cancel={cancel}
        onReload={() => void reload()}
        onReschedule={setReschedule}
        onCancel={setCancel}
        loadSlots={(date) =>
          post(
            `/api/bookings/${id}`,
            { token, action: "availability", date },
            slotsSchema,
          )
        }
        change={change}
      />
    </BookingShell>
  );
}
