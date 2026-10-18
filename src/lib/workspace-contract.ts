import { z } from "zod";
const name = z.string().trim().min(2).max(100);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const workspaceInput = z.object({
  name,
  logo: z
    .string()
    .max(620_000)
    .regex(/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/)
    .nullable()
    .default(null),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  contactEmail: z.email().max(254),
  phone: z.string().trim().max(40),
  serviceArea: z.string().trim().min(2).max(200),
  timeZone: z.enum([
    "Africa/Lagos",
    "Europe/London",
    "America/New_York",
    "UTC",
  ]),
  currency: z.enum(["NGN", "USD", "GBP"]),
});
export const serviceInput = z.object({
  id: z.uuid().optional(),
  name,
  description: z.string().trim().max(2000),
  durationMinutes: z.coerce.number().int().min(15).max(480),
  price: z.coerce.number().min(0).max(10000000).multipleOf(0.01),
  bufferBeforeMinutes: z.coerce.number().int().min(0).max(180),
  bufferAfterMinutes: z.coerce.number().int().min(0).max(180),
  isActive: z.boolean(),
  staffIds: z.array(z.uuid()).max(100).optional(),
});
export const serviceStaffInput = z.object({
  serviceId: z.uuid(),
  staffIds: z.array(z.uuid()).max(100),
});
export const staffInput = z
  .object({
    id: z.uuid().optional(),
    name,
    email: z.email().max(254),
    jobTitle: z.string().trim().max(100),
    isActive: z.boolean(),
    schedule: z.object({
      start: time,
      end: time,
      breakStart: z.union([time, z.literal("")]),
      breakEnd: z.union([time, z.literal("")]),
      days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    }),
  })
  .superRefine((v, ctx) => {
    const s = v.schedule;
    if (
      s.start >= s.end ||
      Boolean(s.breakStart) !== Boolean(s.breakEnd) ||
      (s.breakStart &&
        (s.breakStart >= s.breakEnd ||
          s.breakStart < s.start ||
          s.breakEnd > s.end))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Working hours and break times must be in order, with the break inside working hours.",
      });
  });
export type WorkspaceInput = z.infer<typeof workspaceInput>;
export type ServiceInput = z.infer<typeof serviceInput>;
export type StaffInput = z.infer<typeof staffInput>;
