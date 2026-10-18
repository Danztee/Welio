import { z } from "zod";
import { bookingInput, slotInput } from "@/lib/bookings/contract";

export const slugInput = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export const proposalInput = bookingInput.omit({
  key: true,
  quote: true,
  consent: true,
});
export const availabilityInput = slotInput;
export type Proposal = {
  id: string;
  expiresAt: string;
  input: z.infer<typeof bookingInput>;
  service: string;
  staff: string;
  priceMinor: number;
  currency: string;
  timeZone: string;
  cancelHours: number;
};
export type ChatTurn = { key: string; text: string; reply: string };
export type ChatState = {
  turns: ChatTurn[];
  pending: Proposal | null;
  receipt: string | null;
};
export const proposalSchema: z.ZodType<Proposal> = z.object({
  id: z.uuid(),
  expiresAt: z.iso.datetime(),
  input: bookingInput,
  service: z.string(),
  staff: z.string(),
  priceMinor: z.number().int().nonnegative(),
  currency: z.string(),
  timeZone: z.string(),
  cancelHours: z.number(),
});
export const chatStateSchema = z.object({
  token: z.string().optional(),
  turns: z.array(
    z.object({ key: z.uuid(), text: z.string(), reply: z.string() }),
  ),
  pending: proposalSchema.nullable(),
  receipt: z.uuid().nullable(),
});
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const chatRequest = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start") }),
  z.strictObject({
    action: z.literal("message"),
    token,
    key: z.uuid(),
    text: z.string().trim().min(1).max(1600),
  }),
  z.strictObject({
    action: z.literal("confirm"),
    token,
    proposalId: z.uuid(),
    consent: z.literal(true),
  }),
  z.strictObject({
    action: z.literal("reject"),
    token,
    proposalId: z.uuid(),
  }),
  z.strictObject({ action: z.literal("state"), token }),
]);

export class ReceptionistError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
