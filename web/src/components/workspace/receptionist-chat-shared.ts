import { type ChatState } from "@/lib/domain/receptionist/contract";

export const empty: ChatState = {
  turns: [],
  pending: null,
  receipt: null,
  retry: null,
};

export type SendAction = (action: Record<string, unknown>) => Promise<boolean>;
