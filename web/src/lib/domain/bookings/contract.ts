import { z } from "zod";
import type * as API from "@/lib/backend/generated/types.gen";
import type { CamelFields } from "@/lib/backend/contract";
import { BookingLocation } from "../workspaces/enums";

export const serviceLocationInput = z.enum([
  BookingLocation.CustomerAddress,
  BookingLocation.BusinessAddress,
]);

export type ServiceLocation = z.infer<typeof serviceLocationInput>;

export const dateInput = z.iso.date();

export const policyInput = z.object({
  leadHours: z.coerce.number().int().min(0).max(168),
  horizonDays: z.coerce.number().int().min(1).max(365),
  cancelHours: z.coerce.number().int().min(0).max(168),
  slotMinutes: z.coerce
    .number()
    .refine((v) => [15, 30, 60].includes(v), "Choose 15, 30, or 60 minutes."),
});

export const timeOffInput = z
  .object({
    staffId: z.uuid(),
    from: dateInput,
    to: dateInput,
    reason: z.string().trim().min(1).max(200),
  })
  .refine(
    (v) => v.from <= v.to,
    "End date must be on or after the start date.",
  );

export const serviceAddressInput = z.string().trim().min(3).max(500);

export const bookingInput = z.strictObject({
  key: z.uuid(),
  serviceId: z.uuid(),
  staffId: z.uuid(),
  date: dateInput,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  serviceLocation: serviceLocationInput.optional(),
  quote: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().trim().min(2).max(100),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  phone: z.string().trim().max(40),
  address: serviceAddressInput.optional(),
  consent: z.literal(true),
});

export const bookingProposalInput = bookingInput.extend({
  address: serviceAddressInput,
});

export const changeInput = z
  .object({
    key: z.uuid(),
    version: z.number().int().min(0),
    action: z.enum(["reschedule", "cancel", "completed", "no_show"]),
    date: dateInput.optional(),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    staffId: z.uuid().optional(),
  })
  .superRefine((v, c) => {
    if (v.action === "reschedule" && (!v.date || !v.time || !v.staffId))
      c.addIssue({
        code: "custom",
        message: "Choose a new date, time, and staff member.",
      });
  });

export type BookingInput = z.infer<typeof bookingInput>;

export type ChangeInput = z.infer<typeof changeInput>;

type CatalogResponse = CamelFields<API.Catalog>;
type CatalogService = CamelFields<API.CatalogEntry>;

export type Catalog = Omit<
  CatalogResponse,
  "bookingLocation" | "services" | "staff"
> & {
  bookingLocation: BookingLocation;
  services: (Omit<CatalogService, "staffIds"> & { staffIds: string[] })[];
  staff: NonNullable<CatalogResponse["staff"]>;
};

export type Slot = CamelFields<API.Slot>;

export type BookingView = CamelFields<API.BookingView>;
