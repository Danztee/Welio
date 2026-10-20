import { z } from "zod";
import { bookingProposalInput } from "../bookings/contract";

export const proposalSchema = z.object({
  id: z.uuid(),
  expiresAt: z.iso.datetime(),
  input: bookingProposalInput,
  service: z.string(),
  staff: z.string(),
  priceMinor: z.number().int().nonnegative(),
  currency: z.string(),
  timeZone: z.string(),
  cancelHours: z.number(),
});

export type Proposal = z.infer<typeof proposalSchema>;
