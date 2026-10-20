import { z } from "zod";
import { proposalSchema } from "./booking-proposal";

export const chatStateSchema = z.object({
  turns: z.array(
    z.object({ key: z.uuid(), text: z.string(), reply: z.string() }),
  ),
  pending: proposalSchema.nullable(),
  receipt: z.uuid().nullable(),
  retry: z.object({ key: z.uuid(), text: z.string() }).nullable(),
});

export const chatSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  preview: z.string(),
  updatedAt: z.iso.datetime(),
});

export const chatStartResponseSchema = z.object({
  conversationId: z.uuid(),
  state: chatStateSchema,
  conversations: z.array(chatSummarySchema),
});

export const receptionistActivitySchema = z.enum([
  "thinking",
  "checking_services",
  "checking_availability",
  "preparing_booking",
  "writing",
]);

export type ReceptionistActivity = z.infer<typeof receptionistActivitySchema>;

export const receptionistStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({
    type: z.literal("activity"),
    activity: receptionistActivitySchema,
  }),
  z.object({ type: z.literal("complete"), data: z.unknown() }),
  z.object({ type: z.literal("error"), error: z.string() }),
]);

export type ChatState = z.infer<typeof chatStateSchema>;
export type ChatSummary = z.infer<typeof chatSummarySchema>;
