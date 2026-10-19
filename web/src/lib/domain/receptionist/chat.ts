import { z } from "zod";
import { proposalSchema } from "./booking-proposal";
import type { Proposal } from "./booking-proposal";

export const chatSessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export const slugInput = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

export type ChatTurn = { key: string; text: string; reply: string };

export type StoredConversationMessage = {
  role: "assistant" | "user";
  content: unknown[];
  trackingId?: string;
  metadata?: unknown;
};

export type ChatRetry = { key: string; text: string };

export type ChatState = {
  turns: ChatTurn[];
  pending: Proposal | null;
  receipt: string | null;
  retry: ChatRetry | null;
};

export type ChatSummary = {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
};

export const chatStateSchema = z.object({
  turns: z.array(
    z.object({ key: z.uuid(), text: z.string(), reply: z.string() }),
  ),
  pending: proposalSchema.nullable(),
  receipt: z.uuid().nullable(),
  retry: z.object({ key: z.uuid(), text: z.string() }).nullable(),
});

export const chatSummarySchema: z.ZodType<ChatSummary> = z.object({
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

export const chatRequest = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("start"),
    conversationId: z.uuid().optional(),
  }),
  z.strictObject({ action: z.literal("new") }),
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({
    action: z.literal("open"),
    conversationId: z.uuid(),
  }),
  z.strictObject({
    action: z.literal("message"),
    conversationId: z.uuid(),
    key: z.uuid(),
    text: z.string().trim().min(1).max(1600),
  }),
  z.strictObject({
    action: z.literal("confirm"),
    conversationId: z.uuid(),
    proposalId: z.uuid(),
    consent: z.literal(true),
  }),
  z.strictObject({
    action: z.literal("reject"),
    conversationId: z.uuid(),
    proposalId: z.uuid(),
  }),
  z.strictObject({ action: z.literal("state"), conversationId: z.uuid() }),
]);

export type ReceptionistErrorCode =
  "conflict" | "not_found" | "rate_limited" | "unavailable" | "unprocessable";

export class ReceptionistError extends Error {
  constructor(
    message: string,
    public code: ReceptionistErrorCode = "conflict",
  ) {
    super(message);
  }
}
